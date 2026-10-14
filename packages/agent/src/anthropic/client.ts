import Anthropic from '@anthropic-ai/sdk';
import type {
	BetaContentBlock,
	BetaContentBlockParam,
	BetaMessage,
	BetaMessageParam,
	BetaMessageStreamParams,
	BetaRawMessageStreamEvent,
	BetaToolResultBlockParam
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { gatewayBase, gatewayFetch, type Gateway, type Metadata } from '../gateway.ts';
import { ModelError, retryAfter } from '../model-error.ts';
import type { ModelClient, ModelEvent, ToolCall, Turn, Usage } from '../types.ts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AnthropicModelOptions {
	gateway: Gateway;
	model: string;
	effort?: Effort;
	metadata?: Metadata;
	maxRetries?: number;
	// Input tokens past which the server compacts the context into a summary block.
	compactThreshold?: number;
	resolveImage?: (url: string) => Promise<string>;
}

const cache = { type: 'ephemeral' } as const;

export function anthropicModel({
	gateway,
	model,
	effort = 'medium',
	metadata,
	maxRetries = 0,
	compactThreshold,
	resolveImage = async (url) => url
}: AnthropicModelOptions): ModelClient {
	const client = new Anthropic({
		apiKey: 'ai-gateway',
		baseURL: gatewayBase,
		fetch: gatewayFetch(gateway, 'anthropic', metadata),
		maxRetries
	});

	return {
		async *respond({ instructions, history, tools }, signal) {
			const params: BetaMessageStreamParams = {
				model,
				max_tokens: 64_000,
				system: [{ type: 'text', text: instructions, cache_control: cache }],
				messages: withBreakpoint(await toMessages(sinceCompaction(history), resolveImage)),
				tools: tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					input_schema: { type: 'object', ...tool.parameters }
				})),
				tool_choice: { type: 'auto' },
				// Progress notes between tool calls come back as thinking summaries; the reasoning stays hidden.
				thinking: {
					type: 'adaptive',
					display: 'updates',
					block_binding: { prefix_mismatch_behavior: 'drop_block' }
				},
				output_config: { effort },
				fallbacks: 'default',
				betas: [
					'server-side-fallback-2026-07-01',
					'thinking-display-updates-2026-08-18',
					'thinking-binding-controls-2026-08-01',
					...(compactThreshold ? ['compact-2026-01-12'] : [])
				],
				...(compactThreshold && {
					context_management: {
						edits: [
							{
								type: 'compact_20260112',
								trigger: { type: 'input_tokens', value: compactThreshold }
							}
						]
					}
				})
			};
			try {
				const stream = client.beta.messages.stream(params, { signal });
				const reader = new BlockReader();
				let stopped = false;
				for await (const event of stream) {
					if (event.type === 'message_stop') stopped = true;
					yield* reader.read(event);
				}
				if (!stopped)
					throw new ModelError('The model stream ended early', undefined, 'stream_ended');
				yield* finish(await stream.finalMessage());
			} catch (error) {
				if (error instanceof Anthropic.APIUserAbortError || error instanceof ModelError)
					throw error;
				if (error instanceof Anthropic.APIConnectionError) {
					throw new ModelError(error.message, undefined, 'connection_error');
				}
				if (error instanceof Anthropic.APIError) {
					const body = error.error as { error?: { message?: string } } | undefined;
					throw new ModelError(
						body?.error?.message || `The model request failed with ${error.status}`,
						error.status,
						error.type ?? undefined,
						retryAfter(error.headers)
					);
				}
				throw error;
			}
		}
	};
}

// The response's content blocks, kept verbatim so thinking replays exactly as it was produced.
interface Replay {
	anthropic: BetaContentBlock[];
}

function* finish(message: BetaMessage): Generator<ModelEvent> {
	const { stop_reason: reason, stop_details: details } = message;
	if (reason === 'refusal') {
		throw new ModelError(
			`The model declined to continue${details?.explanation ? `: ${details.explanation}` : ''}`,
			undefined,
			'refusal'
		);
	}
	if (reason === 'max_tokens' || reason === 'model_context_window_exceeded') {
		throw new ModelError(`The model response was incomplete: ${reason}`);
	}
	const replay: Replay = { anthropic: message.content };
	yield { type: 'reasoning', data: JSON.stringify(replay) };
	const compaction = message.content.find((block) => block.type === 'compaction');
	if (compaction) yield { type: 'compaction', data: JSON.stringify(compaction) };
	yield { type: 'done', usage: usage(message) };
}

// Compaction runs as its own iteration, billed on top of the reply's usage.
function usage({ usage }: BetaMessage): Usage {
	const parts = usage.iterations?.length ? usage.iterations : [usage];
	const sum = (pick: (part: (typeof parts)[number]) => number | null | undefined) =>
		parts.reduce((total, part) => total + (pick(part) ?? 0), 0);
	const cachedInputTokens = sum((part) => part.cache_read_input_tokens);
	const cacheWriteTokens = sum((part) => part.cache_creation_input_tokens);
	return {
		inputTokens: sum((part) => part.input_tokens) + cachedInputTokens + cacheWriteTokens,
		cachedInputTokens,
		cacheWriteTokens,
		outputTokens: sum((part) => part.output_tokens)
	};
}

class BlockReader {
	#calls = new Map<number, ToolCall>();
	#wrote = false;
	#separate = false;

	*read(event: BetaRawMessageStreamEvent): Generator<ModelEvent> {
		switch (event.type) {
			case 'content_block_start': {
				const block = event.content_block;
				if (block.type === 'compaction') yield { type: 'compacting' };
				else if (block.type === 'tool_use')
					this.#calls.set(event.index, { id: block.id, name: block.name, arguments: '' });
				this.#separate = this.#wrote;
				break;
			}
			case 'content_block_delta': {
				const { delta } = event;
				if (delta.type === 'text_delta') yield* this.#text(delta.text);
				else if (delta.type === 'thinking_delta') yield* this.#text(delta.thinking);
				else if (delta.type === 'input_json_delta') {
					const call = this.#calls.get(event.index);
					if (call) call.arguments += delta.partial_json;
				}
				break;
			}
			case 'content_block_stop': {
				const call = this.#calls.get(event.index);
				if (call) yield { type: 'call', call: { ...call, arguments: call.arguments || '{}' } };
				break;
			}
		}
	}

	*#text(delta: string): Generator<ModelEvent> {
		if (!delta) return;
		if (this.#separate) yield { type: 'text', delta: '\n\n' };
		this.#separate = false;
		this.#wrote = true;
		yield { type: 'text', delta };
	}
}

// The latest compaction block stands in for everything before its reply.
function sinceCompaction(history: Turn[]) {
	const from = history.findLastIndex((turn) => turn.role === 'assistant' && !!turn.compaction);
	return from > 0 ? history.slice(from) : history;
}

function replayed(turn: Extract<Turn, { role: 'assistant' }>) {
	for (const item of turn.reasoning ?? []) {
		const parsed = JSON.parse(item) as Partial<Replay>;
		if (parsed.anthropic) return parsed.anthropic as BetaContentBlockParam[];
	}
	return null;
}

async function toMessages(
	history: Turn[],
	resolveImage: (url: string) => Promise<string>
): Promise<BetaMessageParam[]> {
	const messages: BetaMessageParam[] = [];
	const push = (role: 'user' | 'assistant', content: BetaContentBlockParam[]) => {
		const last = messages.at(-1);
		if (last?.role === role) (last.content as BetaContentBlockParam[]).push(...content);
		else messages.push({ role, content });
	};
	for (const turn of history) {
		switch (turn.role) {
			case 'user':
				push('user', [{ type: 'text', text: turn.text }]);
				break;
			case 'notification':
				push('user', [
					{ type: 'text', text: `<system-notification>\n${turn.text}\n</system-notification>` }
				]);
				break;
			case 'assistant':
				push(
					'assistant',
					replayed(turn) ?? [
						...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
						...turn.calls.map((call) => ({
							type: 'tool_use' as const,
							id: call.id,
							name: call.name,
							input: JSON.parse(call.arguments || '{}') as unknown
						}))
					]
				);
				break;
			case 'tool':
				push(
					'user',
					await Promise.all(
						turn.results.map(async (result): Promise<BetaToolResultBlockParam> => ({
							type: 'tool_result',
							tool_use_id: result.callId,
							content: result.imageUrl
								? [
										image(await resolveImage(result.imageUrl)),
										{ type: 'text', text: result.output }
									]
								: result.output
						}))
					)
				);
				break;
		}
	}
	return messages;
}

function image(url: string) {
	const data = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(url);
	return data
		? ({
				type: 'image',
				source: {
					type: 'base64',
					media_type: data[1] as 'image/png',
					data: data[2]!
				}
			} as const)
		: ({ type: 'image', source: { type: 'url', url } } as const);
}

function withBreakpoint(messages: BetaMessageParam[]) {
	const content = messages.at(-1)?.content;
	if (!Array.isArray(content)) return messages;
	const index = content.length - 1;
	const block = content[index];
	if (block && block.type !== 'thinking' && block.type !== 'redacted_thinking')
		content[index] = { ...block, cache_control: cache } as BetaContentBlockParam;
	return messages;
}

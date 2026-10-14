import OpenAI from 'openai';
import type {
	ResponseInputItem,
	ResponseInputText,
	ResponseStreamEvent
} from 'openai/resources/responses/responses';
import type { ModelClient, ModelEvent, Turn } from '../types.ts';
import { gatewayBase, gatewayFetch, type Gateway, type Metadata } from '../gateway.ts';
import { ModelError, retryAfter } from '../model-error.ts';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAIModelOptions {
	gateway: Gateway;
	model: string;
	sessionId: string;
	effort?: ReasoningEffort;
	metadata?: Metadata;
	maxRetries?: number;
	// Input tokens past which the server compacts the context into a summary item.
	compactThreshold?: number;
	resolveImage?: (url: string) => Promise<string>;
}

const breakpoint = { mode: 'explicit' } as const;

// TODO: switch to the Responses WebSocket transport so each step only sends new items, once AI Gateway's binding supports it
export function openaiModel({
	gateway,
	model,
	sessionId,
	effort = 'medium',
	metadata,
	maxRetries = 0,
	compactThreshold,
	resolveImage = async (url) => url
}: OpenAIModelOptions): ModelClient {
	let compacting = compactThreshold !== undefined;
	if (sessionId.length > 64) throw new Error(`Session ids are at most 64 characters: ${sessionId}`);
	const client = new OpenAI({
		apiKey: 'ai-gateway',
		baseURL: gatewayBase,
		fetch: gatewayFetch(gateway, 'openai', metadata),
		maxRetries
	});

	return {
		async *respond({ instructions, history, tools }, signal) {
			const window = sinceCompaction(history);
			const input: ResponseInputItem[] = [
				{ type: 'message', role: 'developer', content: [cached(instructions)] },
				...withBreakpoint(
					(await Promise.all(window.map((turn) => toInput(turn, resolveImage)))).flat()
				)
			];
			const create = () =>
				client.responses.create(
					{
						model,
						stream: true,
						store: false,
						input,
						tools: tools.map((tool) => ({ type: 'function', strict: false, ...tool })),
						tool_choice: 'auto',
						parallel_tool_calls: true,
						reasoning: { effort },
						include: ['reasoning.encrypted_content'],
						prompt_cache_key: sessionId,
						...(compacting && {
							context_management: [{ type: 'compaction', compact_threshold: compactThreshold }]
						})
					},
					{ signal }
				);
			try {
				let stream;
				try {
					stream = await create();
				} catch (error) {
					if (!compacting || !rejectsCompaction(error)) throw error;
					// TODO: compact with the standalone /responses/compact endpoint for models without server-side compaction
					compacting = false;
					stream = await create();
				}
				let completed = false;
				for await (const event of stream) {
					if (event.type === 'response.completed') completed = true;
					yield* fromEvent(event);
				}
				if (!completed)
					throw new ModelError('The model stream ended early', undefined, 'stream_ended');
			} catch (error) {
				if (error instanceof OpenAI.APIUserAbortError) throw error;
				if (error instanceof OpenAI.APIConnectionError) {
					throw new ModelError(error.message, undefined, 'connection_error');
				}
				if (error instanceof OpenAI.APIError) {
					const body = error.error as { message?: string } | string | undefined;
					throw new ModelError(
						(typeof body === 'object' && body.message) ||
							`The model request failed with ${error.status}`,
						error.status,
						error.code ?? error.type ?? undefined,
						retryAfter(error.headers)
					);
				}
				throw error;
			}
		}
	};
}

// The latest compaction item stands in for everything before its reply.
function sinceCompaction(history: Turn[]) {
	const from = history.findLastIndex((turn) => turn.role === 'assistant' && !!turn.compaction);
	return from > 0 ? history.slice(from) : history;
}

function rejectsCompaction(error: unknown) {
	return (
		error instanceof OpenAI.APIError &&
		error.status === 400 &&
		/context_management|compact/i.test(error.message)
	);
}

function cached(text: string): ResponseInputText {
	return { type: 'input_text', text, prompt_cache_breakpoint: breakpoint };
}

function withBreakpoint(items: ResponseInputItem[]) {
	const last = items.at(-1);
	if (last?.type === 'function_call_output' && typeof last.output === 'string') {
		items[items.length - 1] = { ...last, output: [cached(last.output)] };
	} else if (last?.type === 'function_call_output' && Array.isArray(last.output)) {
		const output = [...last.output];
		const text = output.at(-1);
		if (text?.type === 'input_text') output[output.length - 1] = cached(text.text);
		items[items.length - 1] = { ...last, output };
	} else if (last?.type === 'message' && last.role === 'user' && typeof last.content !== 'string') {
		const content = [...last.content];
		const text = content.at(-1);
		if (text?.type === 'input_text') content[content.length - 1] = cached(text.text);
		items[items.length - 1] = { ...last, content } as ResponseInputItem;
	}
	return items;
}

async function toInput(
	turn: Turn,
	resolveImage: (url: string) => Promise<string>
): Promise<ResponseInputItem[]> {
	switch (turn.role) {
		case 'user':
			return [
				{ type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.text }] }
			];
		case 'notification':
			return [
				{
					type: 'message',
					role: 'user',
					content: [
						{
							type: 'input_text',
							text: `<system-notification>\n${turn.text}\n</system-notification>`
						}
					]
				}
			];
		case 'assistant':
			return [
				...(turn.compaction ? [JSON.parse(turn.compaction) as ResponseInputItem] : []),
				...(turn.reasoning ?? []).map((item) => JSON.parse(item) as ResponseInputItem),
				...(turn.text
					? [{ type: 'message' as const, role: 'assistant' as const, content: turn.text }]
					: []),
				...turn.calls.map((call) => ({
					type: 'function_call' as const,
					call_id: call.id,
					name: call.name,
					arguments: call.arguments
				}))
			];
		case 'tool':
			return Promise.all(
				turn.results.map(async (result): Promise<ResponseInputItem> => ({
					type: 'function_call_output' as const,
					call_id: result.callId,
					output: result.imageUrl
						? [
								{
									type: 'input_image',
									image_url: await resolveImage(result.imageUrl),
									detail: 'auto'
								},
								{ type: 'input_text', text: result.output }
							]
						: result.output
				}))
			);
	}
}

function* fromEvent(event: ResponseStreamEvent): Generator<ModelEvent> {
	switch (event.type) {
		case 'response.output_text.delta':
			yield { type: 'text', delta: event.delta };
			break;
		case 'response.output_item.done':
			if (event.item.type === 'function_call') {
				const { call_id, name, arguments: args } = event.item;
				yield { type: 'call', call: { id: call_id, name, arguments: args } };
			} else if (event.item.type === 'reasoning') {
				yield { type: 'reasoning', data: JSON.stringify(event.item) };
			} else if (event.item.type === 'compaction') {
				yield { type: 'compaction', data: JSON.stringify(event.item) };
			}
			break;
		case 'response.compaction.compacting':
			yield { type: 'compacting' };
			break;
		case 'response.completed': {
			const usage = event.response.usage;
			const details = usage?.input_tokens_details as
				{ cached_tokens: number; cache_write_tokens?: number } | undefined;
			yield {
				type: 'done',
				usage: {
					inputTokens: usage?.input_tokens ?? 0,
					cachedInputTokens: details?.cached_tokens ?? 0,
					cacheWriteTokens: details?.cache_write_tokens ?? 0,
					outputTokens: usage?.output_tokens ?? 0
				}
			};
			break;
		}
		case 'response.failed': {
			const error = event.response.error;
			throw new ModelError(error?.message ?? 'The model response failed', undefined, error?.code);
		}
		case 'response.incomplete':
			throw new ModelError(
				`The model response was incomplete: ${event.response.incomplete_details?.reason}`
			);
		case 'error':
			throw new ModelError(event.message, undefined, event.code ?? undefined);
	}
}

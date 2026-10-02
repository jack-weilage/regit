import OpenAI from 'openai';
import type { ResponseInputItem, ResponseStreamEvent } from 'openai/resources/responses/responses';
import type { ModelClient, ModelEvent, Turn } from '../types.ts';
import type { TokenSource } from './auth.ts';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ChatGPTOptions {
	auth: TokenSource;
	model: string;
	sessionId: string;
	effort?: ReasoningEffort;
	originator?: string;
	maxRetries?: number;
	fetch?: typeof fetch;
}

export class ModelError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: string
	) {
		super(message);
		this.name = 'ModelError';
	}
}

export function chatgptModel({
	auth,
	model,
	sessionId,
	effort = 'medium',
	originator = 'regit',
	maxRetries,
	fetch
}: ChatGPTOptions): ModelClient {
	// TODO: set prompt cache breakpoints when moving to the API; GPT-5.6+ only caches at explicit breakpoints, and an uncached run costs about 3x
	// TODO: switch to the Responses WebSocket transport so each step only sends new items (needs a fetch-based socket, since the SDK's runs on `ws`)
	const client = new OpenAI({
		apiKey: 'chatgpt',
		baseURL: 'https://chatgpt.com/backend-api/codex',
		defaultHeaders: { originator, 'session-id': sessionId },
		maxRetries,
		fetch
	});

	return {
		async *respond({ instructions, history, tools }, signal) {
			const create = async (refreshed = false) => {
				const tokens = await (refreshed ? auth.refresh() : auth.tokens());
				return client.responses.create(
					{
						model,
						stream: true,
						store: false,
						instructions,
						input: history.flatMap(toInput),
						tools: tools.map((tool) => ({ type: 'function', strict: false, ...tool })),
						tool_choice: 'auto',
						parallel_tool_calls: true,
						reasoning: { effort },
						include: ['reasoning.encrypted_content'],
						prompt_cache_key: sessionId
					},
					{
						signal,
						headers: {
							Authorization: `Bearer ${tokens.accessToken}`,
							'ChatGPT-Account-ID': tokens.accountId
						}
					}
				);
			};

			try {
				const stream = await create().catch((error: unknown) => {
					if (error instanceof OpenAI.AuthenticationError) return create(true);
					throw error;
				});
				for await (const event of stream) yield* fromEvent(event);
			} catch (error) {
				if (error instanceof OpenAI.APIError) {
					const body = error.error as { message?: string } | string | undefined;
					throw new ModelError(
						(typeof body === 'object' && body.message) ||
							`The model request failed with ${error.status}`,
						error.status,
						error.type ?? error.code ?? undefined
					);
				}
				throw error;
			}
		}
	};
}

function toInput(turn: Turn): ResponseInputItem[] {
	switch (turn.role) {
		case 'user':
			return [
				{ type: 'message', role: 'user', content: [{ type: 'input_text', text: turn.text }] }
			];
		case 'assistant':
			return [
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
			return turn.results.map((result) => ({
				type: 'function_call_output' as const,
				call_id: result.callId,
				output: result.output
			}));
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
			}
			break;
		case 'response.completed': {
			const usage = event.response.usage;
			yield {
				type: 'done',
				usage: {
					inputTokens: usage?.input_tokens ?? 0,
					cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
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

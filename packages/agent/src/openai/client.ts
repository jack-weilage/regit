import OpenAI from 'openai';
import type {
	ResponseInputItem,
	ResponseInputText,
	ResponseStreamEvent
} from 'openai/resources/responses/responses';
import type { ModelClient, ModelEvent, Turn } from '../types.ts';
import { gatewayFetch, type Gateway, type Metadata } from './gateway.ts';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface OpenAIModelOptions {
	gateway: Gateway;
	model: string;
	sessionId: string;
	effort?: ReasoningEffort;
	metadata?: Metadata;
	maxRetries?: number;
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

const breakpoint = { mode: 'explicit' } as const;

// TODO: switch to the Responses WebSocket transport so each step only sends new items, once AI Gateway's binding supports it
export function openaiModel({
	gateway,
	model,
	sessionId,
	effort = 'medium',
	metadata,
	maxRetries
}: OpenAIModelOptions): ModelClient {
	const client = new OpenAI({
		apiKey: 'ai-gateway',
		baseURL: 'https://ai-gateway.invalid/v1',
		fetch: gatewayFetch(gateway, 'openai', metadata),
		maxRetries
	});

	return {
		async *respond({ instructions, history, tools }, signal) {
			try {
				const stream = await client.responses.create(
					{
						model,
						stream: true,
						store: false,
						input: [
							{ type: 'message', role: 'developer', content: [cached(instructions)] },
							...withBreakpoint(history.flatMap(toInput))
						],
						tools: tools.map((tool) => ({ type: 'function', strict: false, ...tool })),
						tool_choice: 'auto',
						parallel_tool_calls: true,
						reasoning: { effort },
						include: ['reasoning.encrypted_content'],
						prompt_cache_key: sessionId
					},
					{ signal }
				);
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

function cached(text: string): ResponseInputText {
	return { type: 'input_text', text, prompt_cache_breakpoint: breakpoint };
}

function withBreakpoint(items: ResponseInputItem[]) {
	const last = items.at(-1);
	if (last?.type === 'function_call_output' && typeof last.output === 'string') {
		items[items.length - 1] = { ...last, output: [cached(last.output)] };
	} else if (last?.type === 'message' && last.role === 'user' && typeof last.content !== 'string') {
		const content = [...last.content];
		const text = content.at(-1);
		if (text?.type === 'input_text') content[content.length - 1] = cached(text.text);
		items[items.length - 1] = { ...last, content } as ResponseInputItem;
	}
	return items;
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

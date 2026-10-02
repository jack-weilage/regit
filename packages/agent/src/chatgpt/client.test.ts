import { describe, expect, test } from 'vitest';
import type { ModelEvent, ModelRequest } from '../types.ts';
import { ChatGPTAuth } from './auth.ts';
import { chatgptModel, ModelError } from './client.ts';
import { eventStream, fakeFetch, memoryStore } from './testing.ts';

const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', accountId: 'account' };
const completed = {
	type: 'response.completed',
	response: {
		usage: { input_tokens: 120, output_tokens: 30, input_tokens_details: { cached_tokens: 100 } }
	}
};
const request: ModelRequest = {
	instructions: 'Be brief',
	history: [{ role: 'user', text: 'Read a.ts' }],
	tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }]
};

function setup(...responses: Parameters<typeof fakeFetch>) {
	const { fetch, requests } = fakeFetch(...responses);
	const auth = new ChatGPTAuth(memoryStore(tokens), { fetch });
	const model = chatgptModel({
		auth,
		model: 'gpt-5.5',
		sessionId: 'session-1',
		fetch,
		maxRetries: 0
	});
	const respond = (req = request) => Array.fromAsync(model.respond(req)) as Promise<ModelEvent[]>;
	return { respond, requests };
}

describe('chatgptModel', () => {
	test('sends a Responses API request with ChatGPT auth headers', async () => {
		const { respond, requests } = setup(eventStream([completed]));
		await respond();

		const { url, init, body } = requests[0]!;
		expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
		const headers = new Headers(init.headers);
		expect(headers.get('authorization')).toBe('Bearer access-1');
		expect(headers.get('chatgpt-account-id')).toBe('account');
		expect(headers.get('session-id')).toBe('session-1');
		expect(headers.get('originator')).toBe('regit');
		expect(body).toMatchObject({
			model: 'gpt-5.5',
			stream: true,
			store: false,
			instructions: 'Be brief',
			input: [
				{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Read a.ts' }] }
			],
			tools: [
				{ type: 'function', name: 'read_file', strict: false, parameters: { type: 'object' } }
			],
			prompt_cache_key: 'session-1'
		});
	});

	test('streams text, tool calls, reasoning and usage', async () => {
		const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
		const { respond } = setup(
			eventStream([
				{ type: 'response.created', response: { id: 'resp_1' } },
				{ type: 'response.output_item.done', item: reasoning },
				{ type: 'response.output_text.delta', delta: 'Reading' },
				{ type: 'response.function_call_arguments.delta', delta: '{"pa' },
				{
					type: 'response.output_item.done',
					item: {
						type: 'function_call',
						call_id: 'call_1',
						name: 'read_file',
						arguments: '{"path":"a.ts"}'
					}
				},
				completed
			])
		);

		expect(await respond()).toEqual([
			{ type: 'reasoning', data: JSON.stringify(reasoning) },
			{ type: 'text', delta: 'Reading' },
			{ type: 'call', call: { id: 'call_1', name: 'read_file', arguments: '{"path":"a.ts"}' } },
			{ type: 'done', usage: { inputTokens: 120, cachedInputTokens: 100, outputTokens: 30 } }
		]);
	});

	test('replays the whole conversation as input items', async () => {
		const { respond, requests } = setup(eventStream([completed]));
		await respond({
			...request,
			history: [
				{ role: 'user', text: 'Read a.ts' },
				{
					role: 'assistant',
					text: 'Reading',
					calls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }],
					reasoning: [JSON.stringify({ type: 'reasoning', id: 'rs_1' })]
				},
				{ role: 'tool', results: [{ callId: 'call_1', output: 'export {}' }] }
			]
		});

		expect(requests[0]!.body.input.slice(1)).toEqual([
			{ type: 'reasoning', id: 'rs_1' },
			{ type: 'message', role: 'assistant', content: 'Reading' },
			{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}' },
			{ type: 'function_call_output', call_id: 'call_1', output: 'export {}' }
		]);
	});

	test('refreshes the token once after a 401', async () => {
		const { respond, requests } = setup(
			new Response(null, { status: 401 }),
			Response.json({ access_token: 'access-2' }),
			eventStream([completed])
		);
		await respond();

		expect(requests.map((r) => r.url)).toEqual([
			'https://chatgpt.com/backend-api/codex/responses',
			'https://auth.openai.com/oauth/token',
			'https://chatgpt.com/backend-api/codex/responses'
		]);
		expect(new Headers(requests[2]!.init.headers).get('authorization')).toBe('Bearer access-2');
	});

	test('surfaces usage limits as model errors', async () => {
		const { respond } = setup(
			Response.json(
				{ error: { type: 'usage_limit_reached', message: 'Limit reached' } },
				{ status: 429 }
			)
		);

		const error = await respond().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ModelError);
		expect(error).toMatchObject({
			status: 429,
			code: 'usage_limit_reached',
			message: 'Limit reached'
		});
	});

	test('keeps non-JSON error pages out of the message', async () => {
		const { respond } = setup(
			new Response('<html>Unable to load site</html>', {
				status: 403,
				headers: { 'Content-Type': 'text/html' }
			})
		);

		await expect(respond()).rejects.toMatchObject({
			status: 403,
			message: 'The model request failed with 403'
		});
	});

	test('surfaces failed responses mid-stream', async () => {
		const { respond } = setup(
			eventStream([
				{
					type: 'response.failed',
					response: { error: { code: 'context_length_exceeded', message: 'Too long' } }
				}
			])
		);

		await expect(respond()).rejects.toMatchObject({
			code: 'context_length_exceeded',
			message: 'Too long'
		});
	});
});

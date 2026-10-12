import { describe, expect, test } from 'vitest';
import type { ModelEvent, ModelRequest } from '../types.ts';
import { ModelError, openaiModel } from './client.ts';
import { completed, eventStream, fakeGateway } from './testing.ts';
import { runAgent } from '../loop.ts';

const request: ModelRequest = {
	instructions: 'Be brief',
	history: [{ role: 'user', text: 'Read a.ts' }],
	tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }]
};

function setup(...responses: Response[]) {
	const { gateway, requests } = fakeGateway(...responses);
	const model = openaiModel({
		gateway,
		model: 'gpt-6-luna',
		sessionId: 'session-1',
		metadata: { thread: 'thread-1' },
		maxRetries: 0
	});
	const respond = (req = request) => Array.fromAsync(model.respond(req)) as Promise<ModelEvent[]>;
	return { respond, requests };
}

const breakpoint = { mode: 'explicit' };

describe('openaiModel', () => {
	test('sends tool images as pixels with the call ID and preserves replayable references', async () => {
		const dataUrl = 'data:image/png;base64,aW1hZ2U=';
		const url = '/demo/images/00000000-0000-0000-0000-000000000001';
		const { gateway, requests } = fakeGateway(
			eventStream([
				{
					type: 'response.output_item.done',
					item: {
						type: 'function_call',
						call_id: 'image-1',
						name: 'view_image',
						arguments: '{"path":"capture.png"}'
					}
				},
				completed
			]),
			eventStream([completed])
		);
		const model = openaiModel({
			gateway,
			model: 'gpt-6-luna',
			sessionId: 'images',
			resolveImage: async (ref) => {
				expect(ref).toBe(url);
				return dataUrl;
			}
		});
		const events = await Array.fromAsync(
			runAgent({
				model,
				instructions: '',
				history: [],
				tools: {
					specs: [{ name: 'view_image', description: '', parameters: {} }],
					execute: async () => ({ text: 'Captured page', imageUrl: url })
				}
			})
		);
		expect((requests[1]!.query as { input: unknown[] }).input.at(-1)).toEqual({
			type: 'function_call_output',
			call_id: 'image-1',
			output: [
				{ type: 'input_image', image_url: dataUrl, detail: 'auto' },
				{ type: 'input_text', text: 'Captured page', prompt_cache_breakpoint: breakpoint }
			]
		});
		expect(events).toContainEqual({
			type: 'result',
			result: { callId: 'image-1', output: 'Captured page', imageUrl: url }
		});
		expect(JSON.stringify(events)).not.toContain(dataUrl);
	});

	test('sends Responses requests through the gateway with metadata and no key', async () => {
		const { respond, requests } = setup(eventStream([completed]));
		await respond();

		const [sent] = requests;
		expect(sent).toMatchObject({
			provider: 'openai',
			endpoint: 'responses',
			headers: { 'cf-aig-metadata': { thread: 'thread-1' } }
		});
		expect(JSON.stringify(sent!.headers)).not.toMatch(/authorization/i);
		expect(sent!.query).toMatchObject({
			model: 'gpt-6-luna',
			stream: true,
			store: false,
			tools: [{ type: 'function', name: 'read_file', strict: false }],
			prompt_cache_key: 'session-1'
		});
	});

	test('restricts callable tools without changing the cached tool list', async () => {
		const { respond, requests } = setup(eventStream([completed]), eventStream([completed]));
		await respond();
		await respond({ ...request, allowedTools: ['read_file'] });

		expect(requests[0]!.query).toMatchObject({ tool_choice: 'auto' });
		expect(requests[1]!.query).toMatchObject({
			tools: [{ type: 'function', name: 'read_file', strict: false }],
			tool_choice: {
				type: 'allowed_tools',
				mode: 'auto',
				tools: [{ type: 'function', name: 'read_file' }]
			}
		});
	});

	test('caches the instructions and everything up to the newest item', async () => {
		const { respond, requests } = setup(eventStream([completed]), eventStream([completed]));
		await respond();
		await respond({
			...request,
			history: [
				...request.history,
				{
					role: 'assistant',
					text: '',
					calls: [{ id: 'call_1', name: 'read_file', arguments: '{}' }]
				},
				{ role: 'tool', results: [{ callId: 'call_1', output: 'export {}' }] }
			]
		});

		const [first, second] = requests.map((r) => (r.query as { input: unknown[] }).input);
		expect(first).toEqual([
			{
				type: 'message',
				role: 'developer',
				content: [{ type: 'input_text', text: 'Be brief', prompt_cache_breakpoint: breakpoint }]
			},
			{
				type: 'message',
				role: 'user',
				content: [{ type: 'input_text', text: 'Read a.ts', prompt_cache_breakpoint: breakpoint }]
			}
		]);
		expect(second!.at(-1)).toEqual({
			type: 'function_call_output',
			call_id: 'call_1',
			output: [{ type: 'input_text', text: 'export {}', prompt_cache_breakpoint: breakpoint }]
		});
		expect(second![1]).toEqual({
			type: 'message',
			role: 'user',
			content: [{ type: 'input_text', text: 'Read a.ts' }]
		});
	});

	test('streams text, tool calls, reasoning and usage', async () => {
		const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
		const { respond } = setup(
			eventStream([
				{ type: 'response.created', response: { id: 'resp_1' } },
				{ type: 'response.output_item.done', item: reasoning },
				{ type: 'response.output_text.delta', delta: 'Reading' },
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
			{
				type: 'done',
				usage: { inputTokens: 120, cachedInputTokens: 100, cacheWriteTokens: 20, outputTokens: 30 }
			}
		]);
	});

	test('replays reasoning, replies and tool calls as input items', async () => {
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
				{ role: 'user', text: 'Thanks' }
			]
		});

		expect((requests[0]!.query as { input: unknown[] }).input.slice(2, 5)).toEqual([
			{ type: 'reasoning', id: 'rs_1' },
			{ type: 'message', role: 'assistant', content: 'Reading' },
			{ type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}' }
		]);
	});

	test('surfaces HTTP errors as model errors', async () => {
		const { respond } = setup(
			Response.json(
				{ error: { type: 'rate_limit_exceeded', message: 'Slow down' } },
				{ status: 429 }
			)
		);

		const error = await respond().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ModelError);
		expect(error).toMatchObject({ status: 429, code: 'rate_limit_exceeded', message: 'Slow down' });
	});

	test('keeps non-JSON error pages out of the message', async () => {
		const { respond } = setup(new Response('<html>Bad gateway</html>', { status: 502 }));
		await expect(respond()).rejects.toMatchObject({
			status: 502,
			message: 'The model request failed with 502'
		});
	});

	test('surfaces failed responses mid-stream', async () => {
		const { respond } = setup(
			eventStream([
				{
					type: 'response.failed',
					response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
				}
			])
		);
		await expect(respond()).rejects.toMatchObject({
			code: 'credit_balance_exhausted',
			message: 'No credits'
		});
	});
});

test('rejects session ids longer than prompt caching allows', () => {
	expect(() =>
		openaiModel({ gateway: { run: () => Promise.reject() }, model: 'm', sessionId: 'x'.repeat(65) })
	).toThrow('at most 64 characters');
});

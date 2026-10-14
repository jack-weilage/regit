import { describe, expect, test } from 'bun:test';
import type { ModelEvent, ModelRequest, Turn } from '../types.ts';
import { anthropicModel } from './client.ts';
import { messageEvents, reply, sse } from './testing.ts';
import { fakeGateway } from '../testing.ts';
import { ModelError } from '../model-error.ts';
import { runAgent } from '../loop.ts';
import { isTransient } from '../transient.ts';

const request: ModelRequest = {
	instructions: 'Be brief',
	history: [{ role: 'user', text: 'Read a.ts' }],
	tools: [{ name: 'read_file', description: 'Read a file', parameters: { type: 'object' } }]
};

function setup(...responses: Response[]) {
	const { gateway, requests } = fakeGateway(...responses);
	const model = anthropicModel({
		gateway,
		model: 'claude-opus-5-5',
		metadata: { thread: 'thread-1' }
	});
	const respond = (req = request) => Array.fromAsync(model.respond(req)) as Promise<ModelEvent[]>;
	const body = (index = 0) => requests[index]!.query as Record<string, unknown>;
	return { respond, requests, body };
}

const cache = { type: 'ephemeral' };

describe('anthropicModel', () => {
	test('sends Messages requests through the gateway with beta headers and no key', async () => {
		const { respond, requests, body } = setup(reply([{ type: 'text', text: 'Hi' }]));
		await respond();

		const [sent] = requests;
		expect(sent).toMatchObject({
			provider: 'anthropic',
			endpoint: 'v1/messages',
			headers: { 'cf-aig-metadata': { thread: 'thread-1' }, 'anthropic-version': '2023-06-01' }
		});
		expect(JSON.stringify(sent!.headers)).not.toContain('x-api-key');
		const betas = String(sent!.headers['anthropic-beta']).split(',');
		expect(betas).toContain('server-side-fallback-2026-07-01');
		expect(betas).toContain('thinking-display-updates-2026-08-18');
		expect(betas).toContain('thinking-binding-controls-2026-08-01');
		expect(body()).toMatchObject({
			model: 'claude-opus-5-5',
			stream: true,
			system: [{ type: 'text', text: 'Be brief', cache_control: cache }],
			messages: [
				{ role: 'user', content: [{ type: 'text', text: 'Read a.ts', cache_control: cache }] }
			],
			tools: [{ name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } }],
			tool_choice: { type: 'auto' },
			thinking: {
				type: 'adaptive',
				display: 'updates',
				block_binding: { prefix_mismatch_behavior: 'drop_block' }
			},
			output_config: { effort: 'medium' },
			fallbacks: 'default'
		});
		expect(body().context_management).toBeUndefined();
	});

	test('streams text, progress notes, tool calls, the replayable reply and usage', async () => {
		const { respond } = setup(
			reply(
				[
					{ type: 'thinking', thinking: '', signature: 'sig-1' },
					{ type: 'text', text: 'Looking.' },
					{ type: 'thinking', thinking: 'Reading the file next.', signature: 'sig-2' },
					{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.ts' } }
				],
				{
					usage: {
						input_tokens: 20,
						output_tokens: 30,
						iterations: [
							{
								type: 'compaction',
								input_tokens: 1000,
								cache_read_input_tokens: 0,
								cache_creation_input_tokens: 0,
								output_tokens: 200
							},
							{
								type: 'message',
								input_tokens: 20,
								cache_read_input_tokens: 100,
								cache_creation_input_tokens: 10,
								output_tokens: 30
							}
						]
					}
				}
			)
		);
		const events = await respond();

		expect(events.filter((event) => event.type === 'text')).toEqual([
			{ type: 'text', delta: 'Looking.' },
			{ type: 'text', delta: '\n\n' },
			{ type: 'text', delta: 'Reading the file next.' }
		]);
		expect(events).toContainEqual({
			type: 'call',
			call: { id: 'toolu_1', name: 'read_file', arguments: '{"path":"a.ts"}' }
		});
		const reasoning = events.find((event) => event.type === 'reasoning');
		expect(
			JSON.parse(reasoning!.data).anthropic.map((block: { type: string }) => block.type)
		).toEqual(['thinking', 'text', 'thinking', 'tool_use']);
		expect(events.at(-1)).toEqual({
			type: 'done',
			usage: { inputTokens: 1130, cachedInputTokens: 100, cacheWriteTokens: 10, outputTokens: 230 }
		});
	});

	test('replays replies verbatim and merges tool results with notifications', async () => {
		const { gateway, requests } = fakeGateway(
			reply([
				{ type: 'thinking', thinking: '', signature: 'sig-1' },
				{ type: 'tool_use', id: 'toolu_1', name: 'view_image', input: { path: 'a.png' } }
			]),
			reply([{ type: 'text', text: 'A cat.' }])
		);
		const model = anthropicModel({
			gateway,
			model: 'claude-opus-5-5',
			resolveImage: async () => 'data:image/png;base64,aW1hZ2U='
		});
		let notified = false;
		await Array.fromAsync(
			runAgent({
				model,
				instructions: '',
				history: [{ role: 'user', text: 'What is in a.png?' }],
				tools: {
					specs: [{ name: 'view_image', description: '', parameters: {} }],
					execute: async () => ({ text: 'Captured', imageUrl: '/demo/images/1' })
				},
				steer: () =>
					notified ? [] : ((notified = true), [{ role: 'notification', text: 'Main moved' }])
			})
		);

		const { messages } = requests[1]!.query as { messages: unknown[] };
		expect(messages).toEqual([
			{ role: 'user', content: [{ type: 'text', text: 'What is in a.png?' }] },
			{
				role: 'assistant',
				content: [
					{ type: 'thinking', thinking: '', signature: 'sig-1' },
					{ type: 'tool_use', id: 'toolu_1', name: 'view_image', input: { path: 'a.png' } }
				]
			},
			{
				role: 'user',
				content: [
					{
						type: 'tool_result',
						tool_use_id: 'toolu_1',
						content: [
							{
								type: 'image',
								source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' }
							},
							{ type: 'text', text: 'Captured' }
						]
					},
					{
						type: 'text',
						text: '<system-notification>\nMain moved\n</system-notification>',
						cache_control: cache
					}
				]
			}
		]);
	});

	test('rebuilds replies it did not produce from their text and calls', async () => {
		const { respond, body } = setup(reply([{ type: 'text', text: 'Done' }]));
		const history: Turn[] = [
			{ role: 'user', text: 'Read a.ts' },
			{
				role: 'assistant',
				text: 'Reading.',
				calls: [{ id: 'call-1', name: 'read_file', arguments: '{"path":"a.ts"}' }]
			},
			{ role: 'tool', results: [{ callId: 'call-1', output: 'export {}' }] }
		];
		await respond({ ...request, history });

		expect((body().messages as unknown[])[1]).toEqual({
			role: 'assistant',
			content: [
				{ type: 'text', text: 'Reading.' },
				{ type: 'tool_use', id: 'call-1', name: 'read_file', input: { path: 'a.ts' } }
			]
		});
	});

	test('asks the server to compact only when given a threshold', async () => {
		const { gateway, requests } = fakeGateway(reply([{ type: 'text', text: 'Hi' }]));
		const model = anthropicModel({ gateway, model: 'claude-opus-5-5', compactThreshold: 800_000 });
		await Array.fromAsync(model.respond(request));

		expect(String(requests[0]!.headers['anthropic-beta'])).toContain('compact-2026-01-12');
		expect((requests[0]!.query as Record<string, unknown>).context_management).toEqual({
			edits: [{ type: 'compact_20260112', trigger: { type: 'input_tokens', value: 800_000 } }]
		});
	});

	test('streams compaction and sends only what follows the latest one', async () => {
		const { gateway, requests } = fakeGateway(
			reply([
				{ type: 'compaction', content: 'Summary' },
				{ type: 'text', text: 'Carrying on.' }
			]),
			reply([{ type: 'text', text: 'Next' }])
		);
		const model = anthropicModel({ gateway, model: 'claude-opus-5-5', compactThreshold: 800_000 });
		const events = await Array.fromAsync(
			runAgent({
				model,
				instructions: '',
				history: [
					{ role: 'user', text: 'Long work' },
					{ role: 'assistant', text: 'Earlier', calls: [] },
					{ role: 'user', text: 'More' }
				],
				tools: { specs: [], execute: async () => '' },
				steer: (() => {
					let asked = false;
					return () => (asked ? [] : ((asked = true), [{ role: 'user' as const, text: 'Again' }]));
				})()
			})
		);

		expect(events).toContainEqual({ type: 'compacting' });
		const { messages } = requests[1]!.query as { messages: { role: string; content: unknown[] }[] };
		expect(messages[0]).toEqual({
			role: 'assistant',
			content: [
				{ type: 'compaction', content: 'Summary' },
				{ type: 'text', text: 'Carrying on.' }
			]
		});
		expect(messages).toHaveLength(2);
	});

	test('fails refusals and cut-off replies without retrying', async () => {
		const refused = setup(
			reply([], {
				stop_reason: 'refusal',
				stop_details: { type: 'refusal', category: 'cyber', explanation: 'Not this one' }
			})
		);
		const error = await refused.respond().catch((error: unknown) => error);
		expect(error).toBeInstanceOf(ModelError);
		expect(error).toMatchObject({
			code: 'refusal',
			message: 'The model declined to continue: Not this one'
		});
		expect(isTransient(error)).toBe(false);

		const cut = setup(reply([{ type: 'text', text: 'Partial' }], { stop_reason: 'max_tokens' }));
		await expect(cut.respond()).rejects.toThrow('The model response was incomplete: max_tokens');
	});

	test('surfaces HTTP errors with their type and requested wait', async () => {
		const { respond } = setup(
			Response.json(
				{ type: 'error', error: { type: 'rate_limit_error', message: 'Slow down' } },
				{ status: 429, headers: { 'retry-after': '7' } }
			)
		);
		const error = await respond().catch((error: unknown) => error);
		expect(error).toMatchObject({
			name: 'ModelError',
			message: 'Slow down',
			status: 429,
			code: 'rate_limit_error',
			retryAfterMs: 7000
		});
		expect(isTransient(error)).toBe(true);
	});

	test('treats an overloaded stream or one that ends early as transient', async () => {
		const overloaded = setup(
			sse([
				...messageEvents([{ type: 'text', text: 'Hi' }]).slice(0, 2),
				{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
			])
		);
		const error = await overloaded.respond().catch((error: unknown) => error);
		expect(error).toMatchObject({ name: 'ModelError', code: 'overloaded_error' });
		expect(isTransient(error)).toBe(true);

		const ended = setup(sse(messageEvents([{ type: 'text', text: 'Hi' }]).slice(0, -2)));
		const early = await ended.respond().catch((error: unknown) => error);
		expect(early).toMatchObject({ code: 'stream_ended' });
		expect(isTransient(early)).toBe(true);
	});
});

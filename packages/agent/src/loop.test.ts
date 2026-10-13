import { describe, expect, test } from 'bun:test';
import { runAgent, type AgentOutcome } from './loop.ts';
import { fakeTools, scriptedModel } from './testing.ts';
import { SandboxUnavailableError } from './transient.ts';
import type { AgentEvent } from './types.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
const outage = Object.assign(new Error('Service unavailable'), { status: 503 });
const noWait = async () => {};
const call = (id: string, name: string, args: object) =>
	({ type: 'call', call: { id, name, arguments: JSON.stringify(args) } }) as const;

async function collect(run: AsyncGenerator<AgentEvent, AgentOutcome>) {
	const events: AgentEvent[] = [];
	let next = await run.next();
	while (!next.done) {
		events.push(next.value);
		next = await run.next();
	}
	return { events, outcome: next.value };
}

describe('runAgent', () => {
	test('finishes when the model replies without calling tools', async () => {
		const { model } = scriptedModel([
			[
				{ type: 'text', delta: 'All ' },
				{ type: 'text', delta: 'done' },
				{ type: 'done', usage }
			]
		]);
		const { tools } = fakeTools({});
		const { events, outcome } = await collect(
			runAgent({ model, tools, instructions: '', history: [{ role: 'user', text: 'Hi' }] })
		);

		expect(outcome).toBe('finished');
		expect(events.at(-1)).toEqual({
			type: 'step',
			turns: [{ role: 'assistant', text: 'All done', calls: [] }],
			usage
		});
	});

	test('runs tool calls and sends their results back to the model', async () => {
		const { model, requests } = scriptedModel([
			[call('c1', 'read_file', { path: 'a.ts' }), { type: 'done', usage }],
			[
				{ type: 'text', delta: 'Read it' },
				{ type: 'done', usage }
			]
		]);
		const { tools, calls } = fakeTools({ read_file: ({ path }) => `contents of ${path}` });
		const { outcome } = await collect(
			runAgent({ model, tools, instructions: '', history: [{ role: 'user', text: 'Read a.ts' }] })
		);

		expect(outcome).toBe('finished');
		expect(calls.map((c) => c.name)).toEqual(['read_file']);
		expect(requests[1]!.history.at(-1)).toEqual({
			role: 'tool',
			results: [{ callId: 'c1', output: 'contents of a.ts' }]
		});
	});

	test('keeps reasoning on the assistant turn so it can be replayed', async () => {
		const { model, requests } = scriptedModel([
			[
				{ type: 'reasoning', data: '{"id":"rs_1"}' },
				call('c1', 'run', {}),
				{ type: 'done', usage }
			],
			[{ type: 'done', usage }]
		]);
		const { tools } = fakeTools({ run: () => 'ok' });
		await collect(runAgent({ model, tools, instructions: '', history: [] }));

		expect(requests[1]!.history[0]).toMatchObject({
			role: 'assistant',
			reasoning: ['{"id":"rs_1"}']
		});
	});

	test('reports tool failures to the model instead of stopping', async () => {
		const { model, requests } = scriptedModel([
			[call('c1', 'run', { command: 'false' }), { type: 'done', usage }],
			[{ type: 'done', usage }]
		]);
		const { tools } = fakeTools({
			run: () => {
				throw new Error('exit code 1');
			}
		});
		await collect(runAgent({ model, tools, instructions: '', history: [] }));

		expect(requests[1]!.history.at(-1)).toEqual({
			role: 'tool',
			results: [{ callId: 'c1', output: 'Error: exit code 1' }]
		});
	});

	test('stops at the step limit', async () => {
		const { model } = scriptedModel(
			Array.from({ length: 3 }, (_, i) => [call(`c${i}`, 'run', {}), { type: 'done', usage }])
		);
		const { tools } = fakeTools({ run: () => 'ok' });
		const { outcome } = await collect(
			runAgent({ model, tools, instructions: '', history: [], maxSteps: 3 })
		);

		expect(outcome).toBe('step-limit');
	});

	test('stops when aborted', async () => {
		const controller = new AbortController();
		const { model } = scriptedModel([[call('c1', 'run', {}), { type: 'done', usage }]]);
		const { tools } = fakeTools({
			run: () => {
				controller.abort();
				return 'ok';
			}
		});
		const { outcome } = await collect(
			runAgent({ model, tools, instructions: '', history: [], signal: controller.signal })
		);

		expect(outcome).toBe('aborted');
	});

	test('reads steering messages after each tool call', async () => {
		const { model, requests } = scriptedModel([
			[call('c1', 'read_file', { path: 'a.ts' }), { type: 'done', usage }],
			[
				{ type: 'text', delta: 'Done.' },
				{ type: 'done', usage }
			]
		]);
		const { tools } = fakeTools({ read_file: () => 'contents' });
		const inbox = [[{ role: 'user', text: 'Sam: use b.ts instead' }] as const];

		const { events, outcome } = await collect(
			runAgent({
				model,
				tools,
				instructions: '',
				history: [{ role: 'user', text: 'Fix a.ts' }],
				steer: () => [...(inbox.shift() ?? [])]
			})
		);

		expect(outcome).toBe('finished');
		expect(requests[1]!.history.at(-1)).toEqual({ role: 'user', text: 'Sam: use b.ts instead' });
		const steps = events.filter((event) => event.type === 'step');
		expect(steps[0]!.turns.map((turn) => turn.role)).toEqual(['assistant', 'tool', 'user']);
	});

	test('keeps going when a steering message arrives as the agent finishes', async () => {
		const { model, requests } = scriptedModel([
			[
				{ type: 'text', delta: 'All done.' },
				{ type: 'done', usage }
			],
			[
				{ type: 'text', delta: 'Renamed it too.' },
				{ type: 'done', usage }
			]
		]);
		const { tools } = fakeTools({});
		const inbox = [[{ role: 'user', text: 'Sam: also rename it' }] as const];

		const { outcome } = await collect(
			runAgent({
				model,
				tools,
				instructions: '',
				history: [{ role: 'user', text: 'Fix it' }],
				steer: () => [...(inbox.shift() ?? [])]
			})
		);

		expect(outcome).toBe('finished');
		expect(requests).toHaveLength(2);
		expect(requests[1]!.history.slice(-2)).toEqual([
			{ role: 'assistant', text: 'All done.', calls: [] },
			{ role: 'user', text: 'Sam: also rename it' }
		]);
	});

	test('retries transient model failures, discarding what the failed attempt streamed', async () => {
		const { model, requests } = scriptedModel([
			[{ type: 'text', delta: 'Half' }, outage],
			[outage],
			[
				{ type: 'text', delta: 'Whole' },
				{ type: 'done', usage }
			]
		]);
		const waits: number[] = [];
		const { tools } = fakeTools({});
		const { events, outcome } = await collect(
			runAgent({
				model,
				tools,
				instructions: '',
				history: [{ role: 'user', text: 'Hi' }],
				retries: { limit: 5, baseMs: 1000, maxMs: 10_000 },
				wait: async (ms) => void waits.push(ms)
			})
		);

		expect(outcome).toBe('finished');
		expect(requests).toHaveLength(3);
		expect(events.filter((event) => event.type === 'retry')).toMatchObject([
			{ label: 'Model request', error: 'Service unavailable', attempt: 2, limit: 5 },
			{ attempt: 3, limit: 5 }
		]);
		expect(waits[1]).toBeGreaterThan(waits[0]!);
		expect(events.at(-1)).toMatchObject({ turns: [{ role: 'assistant', text: 'Whole' }] });
	});

	test('gives up after the retry limit', async () => {
		const { model } = scriptedModel([[outage], [outage], [outage]]);
		const { tools } = fakeTools({});
		const run = collect(
			runAgent({
				model,
				tools,
				instructions: '',
				history: [],
				retries: { limit: 3, baseMs: 1, maxMs: 1 },
				wait: noWait
			})
		);
		await expect(run).rejects.toThrow('Service unavailable');
	});

	test('does not retry permanent model failures', async () => {
		const { model, requests } = scriptedModel([
			[Object.assign(new Error('Context too long'), { status: 400 })]
		]);
		const { tools } = fakeTools({});
		const run = collect(runAgent({ model, tools, instructions: '', history: [], wait: noWait }));
		await expect(run).rejects.toThrow('Context too long');
		expect(requests).toHaveLength(1);
	});

	test('stops instead of telling the model when the sandbox is unreachable', async () => {
		const { model, requests } = scriptedModel([[call('c1', 'run', {}), { type: 'done', usage }]]);
		const { tools } = fakeTools({
			run: () => {
				throw new SandboxUnavailableError('The sandbox is unreachable');
			}
		});
		const run = collect(runAgent({ model, tools, instructions: '', history: [] }));
		await expect(run).rejects.toBeInstanceOf(SandboxUnavailableError);
		expect(requests).toHaveLength(1);
	});

	test('keeps the compaction on the reply and passes compacting on', async () => {
		const { model } = scriptedModel([
			[
				{ type: 'compacting' },
				{ type: 'compaction', data: '{"type":"compaction"}' },
				{ type: 'text', delta: 'Carrying on' },
				{ type: 'done', usage }
			]
		]);
		const { tools } = fakeTools({});
		const { events } = await collect(
			runAgent({ model, tools, instructions: '', history: [{ role: 'user', text: 'Hi' }] })
		);

		expect(events[0]).toEqual({ type: 'compacting' });
		expect(events.at(-1)).toMatchObject({
			turns: [{ role: 'assistant', text: 'Carrying on', compaction: '{"type":"compaction"}' }]
		});
	});
});

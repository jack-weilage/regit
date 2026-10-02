import { describe, expect, test } from 'vitest';
import { runAgent, type AgentOutcome } from './loop.ts';
import { fakeTools, scriptedModel } from './testing.ts';
import type { AgentEvent } from './types.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
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
});

import { describe, expect, test } from 'vitest';
import { runAttempt, type Checkpoints } from './attempt.ts';
import type { CommitRequest, PushRequest } from './sandbox/protocol.ts';
import { fakeTools, scriptedModel } from './testing.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
const author = { name: 'ReGit', email: 'agent@regit.dev' };
const push = { token: 'token', ref: 'main' };

function fakeCheckpoints(shas: (string | null)[]) {
	const commits: CommitRequest[] = [];
	const pushes: PushRequest[] = [];
	const checkpoints: Checkpoints = {
		async commit(request) {
			commits.push(request);
			return shas.shift() ?? null;
		},
		async push(request) {
			pushes.push(request);
		}
	};
	return { checkpoints, commits, pushes };
}

describe('runAttempt', () => {
	test('commits and pushes a checkpoint after each step that changed files', async () => {
		const { model } = scriptedModel([
			[
				{ type: 'text', delta: 'Rename the greeting\nThen check it' },
				{ type: 'call', call: { id: 'c1', name: 'edit', arguments: '{}' } },
				{ type: 'done', usage }
			],
			[
				{ type: 'call', call: { id: 'c2', name: 'edit', arguments: '{}' } },
				{ type: 'done', usage }
			],
			[
				{ type: 'text', delta: 'Done' },
				{ type: 'done', usage }
			]
		]);
		const { tools } = fakeTools({ edit: () => 'ok' });
		const { checkpoints, commits, pushes } = fakeCheckpoints(['a'.repeat(40), null]);

		const steps = [];
		const run = runAttempt({
			model,
			tools,
			checkpoints,
			author,
			push,
			instructions: '',
			history: []
		});
		let next = await run.next();
		while (!next.done) {
			if (next.value.type === 'step') steps.push(next.value);
			next = await run.next();
		}

		expect(next.value).toBe('finished');
		expect(commits.map((c) => c.message)).toEqual(['Rename the greeting', 'Checkpoint']);
		expect(pushes).toEqual([push]);
		expect(steps.map((s) => s.checkpoint)).toEqual(['a'.repeat(40), undefined, undefined]);
	});

	test('stops the agent when the caller stops listening', async () => {
		const { model, requests } = scriptedModel([
			[
				{ type: 'call', call: { id: 'c1', name: 'edit', arguments: '{}' } },
				{ type: 'done', usage }
			],
			[{ type: 'done', usage }]
		]);
		const { tools } = fakeTools({ edit: () => 'ok' });
		const { checkpoints } = fakeCheckpoints([]);

		for await (const event of runAttempt({
			model,
			tools,
			checkpoints,
			author,
			push,
			instructions: '',
			history: []
		})) {
			if (event.type === 'step') break;
		}
		expect(requests).toHaveLength(1);
	});
});

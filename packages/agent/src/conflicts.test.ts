import { expect, test } from 'vitest';
import { resolveConflicts } from './conflicts.ts';
import { fakeTools, scriptedModel } from './testing.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };

test('edits the conflicted files and reports how it resolved them', async () => {
	const { model, requests } = scriptedModel([
		[
			{
				type: 'call',
				call: { id: 'c1', name: 'run', arguments: '{"command":"cat notes.md"}' }
			},
			{ type: 'done', usage }
		],
		[
			{ type: 'text', delta: 'Kept both titles' },
			{ type: 'text', delta: ' in one heading.' },
			{ type: 'done', usage }
		]
	]);
	const { tools, calls } = fakeTools({ run: () => 'exit code 0\n<<<<<<< HEAD' });

	const result = await resolveConflicts({
		model,
		tools,
		intent: { headline: 'docs: add a title', purpose: 'Readers need a title.', doneWhen: [] },
		base: 'main',
		files: ['notes.md', 'README.md']
	});

	expect(result).toEqual({
		outcome: 'finished',
		summary: 'Kept both titles in one heading.',
		usage: [usage, usage]
	});
	expect(calls.map((call) => call.name)).toEqual(['run']);
	expect(requests[0]!.history[0]).toMatchObject({
		role: 'user',
		text: expect.stringContaining('It conflicts with the latest main in:\n- notes.md\n- README.md')
	});
});

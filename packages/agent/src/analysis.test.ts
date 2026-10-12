import { expect, test } from 'vitest';
import { analyzeThread, recordTools } from './analysis.ts';
import { fakeTools, scriptedModel } from './testing.ts';

const usage = { inputTokens: 100, cachedInputTokens: 90, cacheWriteTokens: 0, outputTokens: 10 };
const intent = {
	headline: 'docs: add a title',
	purpose: 'Readers need a title.',
	doneWhen: ['notes.md starts with a title']
};
const call = (id: string, name: string, args: object) =>
	({ type: 'call', call: { id, name, arguments: JSON.stringify(args) } }) as const;

test("forks the agent's context, allowing only the record tools", async () => {
	const { tools, calls } = fakeTools({
		write_file: () => 'Wrote it',
		update_intent: () => 'Recorded the intent.',
		suggest_thread: () => 'Suggested.'
	});
	const { model, requests } = scriptedModel([
		[
			call('i', 'update_intent', intent),
			call('w', 'write_file', { path: 'notes.md' }),
			{ type: 'done', usage }
		]
	]);
	const history = [
		{ role: 'user' as const, text: 'Sam: The notes need a title.' },
		{ role: 'assistant' as const, text: 'Adding one.', calls: [] }
	];

	const result = await analyzeThread({
		model,
		instructions: 'You are the thread agent.',
		tools,
		history,
		records: { suggestions: ['fix(audit): query only the last entry'] }
	});

	expect(result).toEqual({ usage: [usage] });
	expect(calls.map((call) => call.name)).toEqual(['update_intent']);
	expect(requests).toHaveLength(1);
	const [request] = requests;
	expect(request!.instructions).toBe('You are the thread agent.');
	expect(request!.tools.map((tool) => tool.name)).toEqual([
		'write_file',
		'update_intent',
		'suggest_thread'
	]);
	expect(request!.allowedTools).toEqual(recordTools);
	expect(request!.history.slice(0, 2)).toEqual(history);
	const asked = request!.history.at(-1);
	expect(asked).toMatchObject({
		role: 'user',
		text: expect.stringContaining('No intent is recorded yet.')
	});
	expect(asked).toMatchObject({
		text: expect.stringContaining(
			'Separate work already suggested: fix(audit): query only the last entry.'
		)
	});
});

test('tells the model which intent is already recorded', async () => {
	const { tools } = fakeTools({ update_intent: () => '', suggest_thread: () => '' });
	const { model, requests } = scriptedModel([
		[
			{ type: 'text', delta: 'No change.' },
			{ type: 'done', usage }
		]
	]);

	await analyzeThread({
		model,
		instructions: '',
		tools,
		history: [],
		records: { intent, suggestions: [] }
	});

	expect(requests[0]!.history.at(-1)).toMatchObject({
		text: expect.stringContaining(
			'The recorded intent is "docs: add a title": Readers need a title. Done when: notes.md starts with a title'
		)
	});
});

import { expect, test } from 'vitest';
import { describeTask, draftIntent } from './intent.ts';
import { scriptedModel } from './testing.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
const proposal = {
	headline: ' fix(settings): load members lazily ',
	purpose: 'Settings load slowly.',
	doneWhen: ['Settings render in under a second ']
};

test('drafts an intent from the conversation', async () => {
	const { model, requests } = scriptedModel([
		[
			{
				type: 'call',
				call: { id: 'c1', name: 'propose_intent', arguments: JSON.stringify(proposal) }
			},
			{ type: 'done', usage }
		]
	]);
	const { intent, usage: reported } = await draftIntent(model, [
		{ author: 'Sam', text: 'Settings take forever.' },
		{ author: 'Lin', text: 'Only for big orgs.' }
	]);

	expect(intent).toEqual({
		headline: 'fix(settings): load members lazily',
		purpose: 'Settings load slowly.',
		doneWhen: ['Settings render in under a second']
	});
	expect(reported).toEqual(usage);
	expect(requests[0]!.history).toEqual([
		{ role: 'user', text: 'Sam: Settings take forever.\n\nLin: Only for big orgs.' }
	]);
	expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(['propose_intent']);
});

test('fails when the model does not propose an intent', async () => {
	const { model } = scriptedModel([
		[
			{ type: 'text', delta: 'Sure!' },
			{ type: 'done', usage }
		]
	]);
	await expect(draftIntent(model, [{ author: 'Sam', text: 'Hi' }])).rejects.toThrow(
		'did not propose an intent'
	);
});

test('describes the task for the coding agent', () => {
	expect(
		describeTask({ headline: 'fix: x', purpose: 'Why.', doneWhen: ['A', 'B'] }, [
			{ author: 'Sam', text: 'Do x' }
		])
	).toBe('fix: x\n\nWhy.\n\nDone when:\n- A\n- B\n\nConversation:\nSam: Do x');
});

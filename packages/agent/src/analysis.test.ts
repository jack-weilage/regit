import { expect, test } from 'vitest';
import { analyzeThread } from './analysis.ts';
import type { Intent } from './intent.ts';
import { scriptedModel } from './testing.ts';

const usage = { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 };
const intent = {
	headline: 'docs: add a title',
	purpose: 'Readers need a title.',
	doneWhen: ['notes.md starts with a title']
};

test('records the intent it derives from the digest in a single request', async () => {
	const intents: Intent[] = [];
	const { model, requests } = scriptedModel([
		[
			{ type: 'call', call: { id: 'i', name: 'update_intent', arguments: JSON.stringify(intent) } },
			{ type: 'done', usage }
		]
	]);

	const result = await analyzeThread({
		model,
		digest: 'Recent history:\n#1 of 1: Sam: The notes need a title.',
		onIntent: (next) => void intents.push(next)
	});

	expect(intents).toEqual([intent]);
	expect(result).toEqual({ usage: [usage] });
	expect(requests).toHaveLength(1);
	expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(['update_intent']);
	expect(requests[0]!.history).toEqual([
		{ role: 'user', text: 'Recent history:\n#1 of 1: Sam: The notes need a title.' }
	]);
});

test('leaves the intent alone when the model sees no change', async () => {
	const intents: Intent[] = [];
	const { model } = scriptedModel([
		[
			{ type: 'text', delta: 'No change.' },
			{ type: 'done', usage }
		]
	]);

	await analyzeThread({
		model,
		digest: 'Sam: How does auth work?',
		onIntent: (next) => void intents.push(next)
	});

	expect(intents).toEqual([]);
});

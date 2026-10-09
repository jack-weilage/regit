import { expect, test } from 'vitest';
import { describeTask, intentTools, type Intent } from './intent.ts';
import { fakeTools } from './testing.ts';
import { combineTools } from './tools.ts';

const proposal = {
	headline: ' fix(settings): load members lazily ',
	purpose: 'Settings load slowly. ',
	doneWhen: ['Settings render in under a second ', ' ']
};

test('proposes and updates intents, trimming what the model wrote', async () => {
	const intents: Intent[] = [];
	const tools = intentTools((intent) => void intents.push(intent));
	const args = JSON.stringify(proposal);

	expect(await tools.execute({ id: 'c1', name: 'propose_intent', arguments: args })).toMatch(
		'Proposed'
	);
	expect(await tools.execute({ id: 'c2', name: 'update_intent', arguments: args })).toBe(
		'Proposed the revised intent. The accepted intent for this run is unchanged.'
	);
	expect(intents).toEqual([
		{
			headline: 'fix(settings): load members lazily',
			purpose: 'Settings load slowly.',
			doneWhen: ['Settings render in under a second']
		},
		expect.anything()
	]);
	expect(tools.specs.map((spec) => spec.name)).toEqual(['propose_intent', 'update_intent']);
	expect(intentTools(() => {}, ['update_intent']).specs.map((spec) => spec.name)).toEqual([
		'update_intent'
	]);
});

test('combines tool sets, routing each call to its owner', async () => {
	const { tools: sandbox } = fakeTools({ read_file: () => 'contents' });
	const tools = combineTools(
		sandbox,
		intentTools(() => {})
	);

	expect(tools.specs.map((spec) => spec.name)).toEqual([
		'read_file',
		'propose_intent',
		'update_intent'
	]);
	expect(await tools.execute({ id: 'c1', name: 'read_file', arguments: '{}' })).toBe('contents');
	expect(() => tools.execute({ id: 'c2', name: 'write_file', arguments: '{}' })).toThrow(
		'Unknown tool write_file'
	);
});

test('describes the task for the coding agent', () => {
	const task = describeTask({ headline: 'fix: x', purpose: 'Because.', doneWhen: ['It works'] }, [
		{ author: 'Sam', text: 'Please fix x' }
	]);
	expect(task).toBe(
		'fix: x\n\nBecause.\n\nDone when:\n- It works\n\nConversation:\nSam: Please fix x'
	);
});

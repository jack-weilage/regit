import { expect, test } from 'bun:test';
import { intentTools, type Intent } from './intent.ts';
import { fakeTools } from './testing.ts';
import { combineTools } from './tools.ts';

const proposal = {
	headline: ' fix(settings): load members lazily ',
	purpose: 'Settings load slowly. ',
	doneWhen: ['Settings render in under a second ', ' ']
};

test('records intents, trimming what the model wrote', async () => {
	const intents: Intent[] = [];
	const tools = intentTools((intent) => void intents.push(intent));

	expect(
		await tools.execute({ id: 'c1', name: 'update_intent', arguments: JSON.stringify(proposal) })
	).toBe('Recorded the intent.');
	expect(intents).toEqual([
		{
			headline: 'fix(settings): load members lazily',
			purpose: 'Settings load slowly.',
			doneWhen: ['Settings render in under a second']
		}
	]);
	expect(tools.specs.map((spec) => spec.name)).toEqual(['update_intent']);
});

test('combines tool sets, routing each call to its owner', async () => {
	const { tools: sandbox } = fakeTools({ read_file: () => 'contents' });
	const tools = combineTools(
		sandbox,
		intentTools(() => {})
	);

	expect(tools.specs.map((spec) => spec.name)).toEqual(['read_file', 'update_intent']);
	expect(await tools.execute({ id: 'c1', name: 'read_file', arguments: '{}' })).toBe('contents');
	expect(() => tools.execute({ id: 'c2', name: 'write_file', arguments: '{}' })).toThrow(
		'Unknown tool write_file'
	);
});

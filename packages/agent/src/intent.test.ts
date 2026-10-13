import { expect, test } from 'bun:test';
import { intentTools, type DoneWhenReport, type Intent } from './intent.ts';
import { fakeTools } from './testing.ts';
import { combineTools } from './tools.ts';

const proposal = {
	headline: ' fix(settings): load members lazily ',
	purpose: 'Settings load slowly. ',
	doneWhen: ['Settings render in under a second ', ' ']
};

test('records intents, trimming what the model wrote', async () => {
	const intents: Intent[] = [];
	const tools = intentTools({ update: (intent) => void intents.push(intent), record: () => '' });

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
	expect(tools.specs.map((spec) => spec.name)).toEqual(['update_intent', 'record_done_when']);
});

test('records done-when results, refusing unknown statuses', async () => {
	const recorded: DoneWhenReport[][] = [];
	const tools = intentTools({
		update: () => {},
		record: (results) => (recorded.push(results), 'Recorded.')
	});
	const call = (results: unknown) =>
		tools.execute({ id: 'c1', name: 'record_done_when', arguments: JSON.stringify({ results }) });

	expect(
		await call([
			{ check: 1, status: 'met', evidence: ' bun test: 12 passed ' },
			{ check: 2, status: 'unverified', evidence: 'x'.repeat(600) }
		])
	).toBe('Recorded.');
	expect(recorded).toEqual([
		[
			{ check: 1, status: 'met', evidence: 'bun test: 12 passed' },
			{ check: 2, status: 'unverified', evidence: 'x'.repeat(500) }
		]
	]);
	expect(await call([{ check: 1, status: 'done', evidence: '' }])).toBe(
		'Error: status must be one of met, unmet, unverified'
	);
	expect(recorded).toHaveLength(1);
});

test('combines tool sets, routing each call to its owner', async () => {
	const { tools: sandbox } = fakeTools({ read_file: () => 'contents' });
	const tools = combineTools(sandbox, intentTools({ update: () => {}, record: () => '' }));

	expect(tools.specs.map((spec) => spec.name)).toEqual([
		'read_file',
		'update_intent',
		'record_done_when'
	]);
	expect(await tools.execute({ id: 'c1', name: 'read_file', arguments: '{}' })).toBe('contents');
	expect(() => tools.execute({ id: 'c2', name: 'write_file', arguments: '{}' })).toThrow(
		'Unknown tool write_file'
	);
});

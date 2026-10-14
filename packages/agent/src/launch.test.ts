import { expect, test } from 'bun:test';
import { launchTools, type Suggestion } from './launch.ts';

const call = (args: object) => ({
	id: 's1',
	name: 'launch_thread',
	arguments: JSON.stringify({
		headline: ' fix(audit): query only the last entry ',
		purpose: 'Settings fetch the whole audit log.',
		doneWhen: ['One query returns one row', ' '],
		context: 'src/routes/settings/+page.server.ts:14 loads every audit entry.',
		...args
	})
});

test('suggests separate work with the context a new thread needs', async () => {
	const launches: [Suggestion, boolean][] = [];
	const tools = launchTools(async (suggestion, start) => {
		launches.push([suggestion, start]);
		return null;
	});
	expect(tools.specs.map((spec) => spec.name)).toEqual(['launch_thread']);

	const output = await tools.execute(call({ start: false }));

	expect(output).toBe('Suggested. The person can start it as its own thread.');
	expect(launches).toEqual([
		[
			{
				headline: 'fix(audit): query only the last entry',
				purpose: 'Settings fetch the whole audit log.',
				doneWhen: ['One query returns one row'],
				context: 'src/routes/settings/+page.server.ts:14 loads every audit entry.'
			},
			false
		]
	]);
});

test('starts the thread when asked, or says it was only suggested', async () => {
	const started = launchTools(async (_, start) => (start ? 'abc123' : null));
	expect(await started.execute(call({ start: true }))).toContain('Started thread abc123');

	const refused = launchTools(async () => null);
	expect(await refused.execute(call({ start: true }))).toStartWith('Suggested instead');
});

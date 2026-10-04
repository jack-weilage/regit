import { expect, test } from 'vitest';
import { suggestTools } from './suggest.ts';

test('suggests separate work with the context a new thread needs', async () => {
	const suggestions: unknown[] = [];
	const tools = suggestTools((suggestion) => {
		suggestions.push(suggestion);
	});
	expect(tools.specs.map((spec) => spec.name)).toEqual(['suggest_thread']);

	const output = await tools.execute({
		id: 's1',
		name: 'suggest_thread',
		arguments: JSON.stringify({
			headline: ' fix(audit): query only the last entry ',
			purpose: 'Settings fetch the whole audit log.',
			doneWhen: ['One query returns one row', ' '],
			context: 'src/routes/settings/+page.server.ts:14 loads every audit entry.'
		})
	});

	expect(output).toContain('spin it off');
	expect(suggestions).toEqual([
		{
			headline: 'fix(audit): query only the last entry',
			purpose: 'Settings fetch the whole audit log.',
			doneWhen: ['One query returns one row'],
			context: 'src/routes/settings/+page.server.ts:14 loads every audit entry.'
		}
	]);
});

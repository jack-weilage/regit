import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { script, modelRequests, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const titled = {
	'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [handoff]
`
};
const replied = (text: string) => (detail: ThreadDetail) =>
	detail.summary.status === 'needs-you' &&
	detail.entries.some((entry) => entry.type === 'message' && entry.text === text);
const checkEvents = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) =>
		entry.type === 'event' && entry.text.startsWith('Checks: ') ? [entry.text] : []
	);

test('sends failing handoff checks back to the agent and reuses passes while nothing changed', async () => {
	const { repo, sam, id } = await startedThread(
		'handoff',
		[writeNotes('Some notes\\nMore\\n'), say('Done.'), writeNotes('# Notes\\n'), say('Fixed.')],
		undefined,
		titled
	);
	const fixed = await untilThread(repo, id, replied('Fixed.'));
	expect(checkEvents(fixed)).toEqual(['Checks: title failed', 'Checks: title passed']);
	expect(fixed.summary.checks).toMatchObject({
		action: 'handoff',
		results: [{ name: 'title', kind: 'run', status: 'passed', reused: false }]
	});
	const notice = JSON.stringify((await modelRequests('handoff')).at(-1)!.query);
	expect(notice).toContain(
		'Checks from .agents/checks.yml that must pass before you hand off failed'
	);
	expect(notice).toContain('## title (failed)\\nexit code 1');

	await script('handoff', [say('Nothing to change.')]);
	await repo.reply(id, { author: sam, text: 'Anything else?' });
	const again = await untilThread(repo, id, replied('Nothing to change.'));
	expect(checkEvents(again)).toEqual(checkEvents(fixed));
	expect(again.summary.checks!.results[0]).toMatchObject({ status: 'passed', reused: true });
});

test('hands off with the failure after three rounds the agent could not fix', async () => {
	const { repo, id } = await startedThread(
		'handoff-stuck',
		[writeNotes('No title\\n'), say('Done.'), say('Try 1.'), say('Try 2.'), say('Try 3.')],
		undefined,
		titled
	);
	const stuck = await untilThread(repo, id, replied('Try 3.'));
	expect(checkEvents(stuck)).toEqual(['Checks: title failed']);
	expect(stuck.summary.checks!.results[0]!.status).toBe('failed');
	expect(
		(await modelRequests('handoff-stuck')).filter((request) =>
			JSON.stringify(request.query).includes('## title (failed)')
		)
	).toHaveLength(3);
});

import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { script, modelRequests, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const run = (command: string) => [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'run',
			name: 'run',
			arguments: JSON.stringify({ command })
		}
	}
];
const titled = {
	'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    inputs: [notes.md]
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
const notices = async (repo: string) =>
	JSON.stringify((await modelRequests(repo)).at(-1)!.query).split('## title (failed)').length - 1;

test('sends failing handoff checks back to the agent and reuses passes whose inputs are unchanged', async () => {
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
	expect(notice).toContain(
		'## title (failed)\\nFull log: .git/regit-checks/title.log\\nexit code 1'
	);

	await script('handoff', [run("printf 'Other\\\\n' > other.md"), say('Added other.md.')]);
	await repo.reply(id, { author: sam, text: 'Add other.md too.' });
	const again = await untilThread(repo, id, replied('Added other.md.'));
	expect(checkEvents(again)).toEqual(checkEvents(fixed));
	expect(again.summary.checks!.results[0]).toMatchObject({ status: 'passed', reused: true });
});

test('hands off when the agent stops without changing anything after a failure', async () => {
	const { repo, id } = await startedThread(
		'handoff-question',
		[writeNotes('No title\\n'), say('Which title?'), say('I need a title from you first.')],
		undefined,
		titled
	);
	const asked = await untilThread(repo, id, replied('I need a title from you first.'));
	expect(asked.summary.checks!.results[0]!.status).toBe('failed');
	expect(await notices('handoff-question')).toBe(1);
	expect(JSON.stringify((await modelRequests('handoff-question')).at(-1)!.query)).toContain(
		'reply without changing files and the thread hands off'
	);
});

test('hands off with the failure after three rounds of changes that did not fix it', async () => {
	const { repo, id } = await startedThread(
		'handoff-stuck',
		[
			writeNotes('No title\\n'),
			say('Done.'),
			writeNotes('Still no title\\n'),
			say('Try 1.'),
			writeNotes('Not a title\\n'),
			say('Try 2.'),
			writeNotes('Nope\\n'),
			say('Try 3.')
		],
		undefined,
		titled
	);
	const stuck = await untilThread(repo, id, replied('Try 3.'));
	expect(checkEvents(stuck)).toEqual(['Checks: title failed']);
	expect(await notices('handoff-stuck')).toBe(3);
});

test('stopping the agent cancels running handoff checks and starts no further turn', async () => {
	const { repo, sam, id } = await startedThread(
		'handoff-stop',
		[writeNotes('# Notes\\n'), say('Done.')],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: slow
    run: sleep 60
    before: [handoff]
`
		}
	);
	await untilThread(repo, id, (detail) => detail.activity?.status?.label === 'Running checks');
	const started = Date.now();
	await repo.stop(id, sam);
	const stopped = await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	await new Promise((resolve) => setTimeout(resolve, 2000));
	const after = (await repo.thread(id))!;
	expect(after.summary.status).toBe('needs-you');
	expect(after.summary.failure).toBeNull();
	expect(after.entries).toHaveLength(stopped.entries.length);
	expect(Date.now() - started).toBeLessThan(30_000);
	expect(await modelRequests('handoff-stop')).toHaveLength(2);
});

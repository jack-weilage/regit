import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { script, modelRequests, decisionRequests, startedThread } = await setup();

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
const call = (name: string, args: object) => [
	{
		type: 'response.output_item.done',
		item: { type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) }
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
	await untilThread(repo, id, (detail) => {
		const agent = detail.activity?.agent;
		return agent?.type === 'thinking' && agent.label === 'Running checks';
	});
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

test('records done-when results, keeps them outdated after later changes and gives {intent} checks the intent', async () => {
	const titleCheck = 'notes.md starts with a title';
	const intent = {
		headline: 'docs(notes): add a title',
		purpose: 'The notes have no heading.',
		doneWhen: [titleCheck]
	};
	const { repo, sam, id } = await startedThread(
		'done-when',
		[
			call('update_intent', intent),
			writeNotes('# Notes\\n'),
			call('record_done_when', {
				results: [{ check: 1, status: 'met', evidence: 'head -1 notes.md printed # Notes' }]
			}),
			say('Done.')
		],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: scope
    ask: The change does what {intent} describes
    before: [handoff]
`
		}
	);
	const latest = (detail: ThreadDetail) =>
		detail.entries.findLast((entry) => entry.type === 'intent') as Extract<
			ThreadDetail['entries'][number],
			{ type: 'intent' }
		>;
	const done = await untilThread(repo, id, replied('Done.'));
	expect(latest(done).results).toEqual({
		[titleCheck]: {
			status: 'met',
			evidence: 'head -1 notes.md printed # Notes',
			at: expect.any(Number),
			tree: expect.stringMatching(/^[0-9a-f]{40}$/)
		}
	});
	expect(done.summary.checks!.results).toMatchObject([
		{ name: 'scope', kind: 'ask', status: 'passed' }
	]);
	const asked = (await decisionRequests('done-when')).find(
		(request) => 'holds' in request.questions
	)!;
	expect(asked.state).toMatchObject({
		check: 'The change does what `intent` describes',
		intent: `${intent.headline}\n\n${intent.purpose}\n\nDone when:\n- ${titleCheck}`
	});

	await script('done-when', [
		call('update_intent', { ...intent, doneWhen: [titleCheck, 'notes.md has a second line'] }),
		writeNotes('# Notes\\nMore\\n'),
		say('Updated.')
	]);
	await repo.reply(id, { author: sam, text: 'Add a second line.' });
	const updated = await untilThread(repo, id, replied('Updated.'));
	expect(latest(updated).intent.doneWhen).toHaveLength(2);
	expect(latest(updated).results).toEqual({
		[titleCheck]: expect.objectContaining({ status: 'met', stale: true })
	});
});

import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilMain, untilThread, writeNotes } from './support.ts';

const { dir, script, modelRequests, sh, commit, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const noted = (count: number) => Array.from({ length: count }, () => say('Noted.'));
const sleep = (seconds: number) => [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'sleep',
			name: 'run',
			arguments: JSON.stringify({ command: `sleep ${seconds}` })
		}
	}
];
const titled = {
	'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
`
};
const shipInput = (by: { id: string; name: string; kind: 'person' }) => ({
	by,
	email: 'sam@example.com',
	title: 'docs: change the notes',
	body: ''
});
const about = (text: string) => `Spun-off thread #2 (docs: change the notes) ${text}`;
const events = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) => (entry.type === 'event' ? [entry.text] : []));

// A parent thread launches a child, which works, ends needing a person, and wakes its idle parent.
async function launched(
	name: string,
	steps: object[][],
	files: Record<string, string> = {},
	green = false
) {
	const started = await startedThread(name, [say('On it.')], undefined, files);
	const { repo, id: parent } = started;
	await untilThread(repo, parent, (detail) => detail.summary.status === 'idle');
	if (green) {
		const seeded = sh(join(dir, `${name}.git`), 'rev-parse', 'main');
		await repo.landed({ repo: name, ref: 'refs/heads/main', after: seeded, headline: 'init' });
		await untilMain(repo, (main) => main.green?.sha === seeded && !main.verifying);
	}
	await script(name, [...steps, say('Noted.')]);
	const child = (await repo.launchThread(
		parent,
		{
			headline: 'docs: change the notes',
			purpose: 'The notes need work.',
			doneWhen: ['notes.md changed'],
			context: 'Sam asked for this.'
		},
		true
	))!;
	const told = await untilThread(
		repo,
		parent,
		(detail) =>
			detail.summary.status === 'idle' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Noted.')
	);
	return { ...started, parent, child, told };
}

const parentQueries = async (repo: string, parent: string) =>
	(await modelRequests(repo))
		.filter(
			(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === parent
		)
		.map((request) => JSON.stringify(request.query));

test('wakes an idle parent when its child needs a person, ships, passes and deploys', async () => {
	const { repo, sam, parent, child, told } = await launched(
		'parent-idle',
		[writeNotes('# Notes\\n'), say('Done.')],
		{ ...titled, '.agents/deploy': 'echo deployed\n' }
	);
	const checkpoint = (await repo.thread(child))!.entries.findLast(
		(entry) => entry.type === 'tools' && entry.checkpoint
	) as { checkpoint: string };
	const needsYou = about(
		`needs a person: changes ready to ship. Latest commit: \`${checkpoint.checkpoint.slice(0, 7)}\`.`
	);
	expect(events(told)).toContain(needsYou);
	expect(JSON.stringify((await modelRequests('parent-idle')).at(-1)!.query)).toContain(needsYou);

	await script('parent-idle', noted(6));
	await repo.ship(child, shipInput(sam));
	await untilThread(repo, child, (detail) => detail.summary.shipped?.verdict === 'deployed');
	const shipped = sh(join(dir, 'parent-idle.git'), 'rev-parse', '--short=7', 'main');
	const notices = [
		about(`shipped \`${shipped}\` to \`main\`.`),
		about(`passed \`main\`'s deploy checks with \`${shipped}\`.`),
		about(`is live as \`${shipped}\`.`)
	];
	const done = await untilThread(
		repo,
		parent,
		(detail) =>
			detail.summary.status === 'idle' && notices.every((notice) => events(detail).includes(notice))
	);
	expect(done.entries.at(-1)).toMatchObject({ type: 'message', text: 'Noted.' });
	const queries = (await parentQueries('parent-idle', parent)).join('\n');
	for (const notice of notices) expect(queries).toContain(notice);

	await script('parent-idle', [say('Still here.')]);
	await repo.reply(child, { author: sam, text: 'Is it live?' });
	await untilThread(repo, child, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Still here.')
	);
	const own = JSON.stringify((await modelRequests('parent-idle')).at(-1)!.query);
	expect(own).toContain(`What this thread shipped as ${shipped} is deployed.`);
	expect(own).not.toContain('Spun-off thread');
});

test('steers a working parent when its child is handed back a conflicting ship', async () => {
	const { repo, sam, parent, child } = await launched('parent-working', [
		writeNotes('# Notes\\n'),
		say('Added the title.')
	]);
	const work = join(dir, 'parent-working-work');
	await commit(work, { 'notes.md': 'Some better notes\n' }, 'Better notes');
	sh(work, 'push', '--quiet', join(dir, 'parent-working.git'), 'main');
	await script('parent-working', [
		sleep(25),
		writeNotes('# Notes\\n\\nSome better notes\\n'),
		say('Resolved the conflict.'),
		...noted(4)
	]);
	await repo.reply(parent, { author: sam, text: 'Wait a moment.' });
	await expect.poll(async () => (await parentQueries('parent-working', parent)).length).toBe(1);

	await repo.ship(child, shipInput(sam));
	const handBack = about('conflicted with `main` while shipping');
	const steered = await untilThread(repo, parent, (detail) =>
		events(detail).some((text) => text.startsWith(handBack))
	);
	expect(steered.summary.status).toBe('working');
	expect(events(steered).find((text) => text.startsWith(handBack))).toMatch(
		/while shipping `[0-9a-f]{7}`; it ships again once its agent brings it up to date\.$/
	);

	await expect
		.poll(async () => (await repo.thread(child))!.summary.status, { timeout: 60_000 })
		.toBe('shipped');
	const shipped = sh(join(dir, 'parent-working.git'), 'rev-parse', '--short=7', 'main');
	const landed = about(`shipped \`${shipped}\` to \`main\`.`);
	await expect
		.poll(
			async () => {
				const queries = await parentQueries('parent-working', parent);
				return queries.length > 1 && queries.join('\n').includes(landed);
			},
			{ timeout: 60_000 }
		)
		.toBe(true);
	const [, afterSleep] = await parentQueries('parent-working', parent);
	expect(afterSleep).toContain(handBack);
});

test('tells a parent when its child breaks main, is handed back, and is reverted', async () => {
	const { repo, sam, parent, child } = await launched(
		'parent-reverted',
		[writeNotes('No title\\n'), say('Done.')],
		{ ...titled, 'notes.md': '# Notes\n' },
		true
	);
	await script('parent-reverted', noted(8));
	await repo.ship(child, shipInput(sam));
	const reverted = await untilThread(
		repo,
		child,
		(detail) => detail.summary.shipped?.verdict === 'reverted'
	);
	const broken = reverted.summary.shipped!.sha.slice(0, 7);
	const revert = sh(join(dir, 'parent-reverted.git'), 'rev-parse', '--short=7', 'main');
	const notices = [
		about(`shipped \`${broken}\` to \`main\`.`),
		about(
			`broke \`main\`'s deploy checks (title) with \`${broken}\`; the fix ships once its agent finishes.`
		),
		about(`broke \`main\`'s deploy checks with \`${broken}\` and was reverted in \`${revert}\`.`)
	];
	await untilThread(
		repo,
		parent,
		(detail) =>
			detail.summary.status === 'idle' && notices.every((notice) => events(detail).includes(notice))
	);
	await expect
		.poll(async () => (await parentQueries('parent-reverted', parent)).join('\n'), {
			timeout: 30_000
		})
		.toContain(notices[2]);
	const queries = (await parentQueries('parent-reverted', parent)).join('\n');
	for (const notice of notices) expect(queries).toContain(notice);
});

test('tells archived and deleted parents nothing', async () => {
	const { repo, sam, parent, child } = await launched('parent-gone', [
		writeNotes('# Notes\\n'),
		say('Done.')
	]);
	await repo.archive(parent, sam);
	const archived = (await repo.thread(parent))!.entries.length;
	await script('parent-gone', []);
	await repo.ship(child, shipInput(sam));
	await untilThread(repo, child, (detail) => detail.summary.shipped?.verdict === 'passed');
	expect((await repo.thread(parent))!.entries).toHaveLength(archived);

	await repo.delete(parent, sam);
	await script('parent-gone', [writeNotes('# Notes\\n\\nMore\\n'), say('More.')]);
	await repo.reply(child, { author: sam, text: 'Add more.' });
	await untilThread(
		repo,
		child,
		(detail) =>
			detail.summary.needsYou &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'More.')
	);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	expect(await parentQueries('parent-gone', parent)).toEqual([]);
});

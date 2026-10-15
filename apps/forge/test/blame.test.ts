import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, sleepCall, untilMain, untilThread, writeNotes } from './support.ts';

const { dir, sandboxes, script, sh, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const writeOther = [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'other',
			name: 'run',
			arguments: JSON.stringify({ command: "printf 'Other\\n' > other.md" })
		}
	}
];
const titleCheck = (run: string) => ({
	'notes.md': '# Notes\n',
	'.agents/checks.yml': `checks:
  - name: title
    run: ${run}
    before: [deploy]
`
});
const shipInput = (
	by: { id: string; name: string; kind: 'person' },
	title = 'docs: drop the title'
) => ({
	by,
	email: 'sam@example.com',
	title,
	body: ''
});
const events = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) => (entry.type === 'event' ? [entry.text] : []));

async function greenStart(name: string, files = titleCheck("grep -q '^# ' notes.md")) {
	const started = await startedThread(
		name,
		[writeNotes('No title\\n'), say('Done.')],
		undefined,
		files
	);
	const seeded = sh(join(dir, `${name}.git`), 'rev-parse', 'main');
	await started.repo.landed({
		repo: name,
		ref: 'refs/heads/main',
		after: seeded,
		headline: 'init'
	});
	await untilMain(started.repo, (main) => main.green?.sha === seeded && !main.verifying);
	await untilThread(started.repo, started.id, (detail) => detail.summary.status === 'idle');
	return { ...started, seeded, canonical: join(dir, `${name}.git`) };
}

test('blames and reverts the original culprit when its fix ships and main is still red', async () => {
	const { repo, sam, id, seeded, canonical } = await greenStart('fix-still-red');
	await script('fix-still-red', [writeNotes('Still no title\\n'), say('Fixed it.')]);

	await repo.ship(id, shipInput(sam));
	const red = await untilMain(repo, (main) => main.verified?.passed === false);
	const broken = red.verified!.sha;
	const stillRed = await untilMain(
		repo,
		(main) => main.verified?.passed === false && main.verified.sha !== broken,
		180_000
	);
	expect(sh(canonical, 'rev-parse', `${stillRed.verified!.sha}^`)).toBe(broken);
	expect(stillRed.verified!.culprit).toMatchObject({ sha: broken, thread: id });

	await untilThread(repo, id, (detail) => detail.summary.shipped?.verdict === 'reverted');
	expect(sh(canonical, 'log', '--format=%s', 'main')).toBe(
		[
			'Revert "docs: drop the title"',
			'Revert "Fix main after "docs: drop the title""',
			'Fix main after "docs: drop the title"',
			'docs: drop the title',
			'init'
		].join('\n')
	);
	const main = await untilMain(repo, (main) => main.green?.sha !== seeded && !main.verifying);
	expect(main.green?.sha).toBe(sh(canonical, 'rev-parse', 'main'));
});

test('blames a ship that broke main after its thread shipped again', async () => {
	const hold = () => join(sandboxes!, 'main-shipped-twice/.git/hold');
	const { repo, sam, id, canonical } = await greenStart(
		'shipped-twice',
		titleCheck(
			`while [ -e "$(git rev-parse --git-common-dir)/hold" ]; do sleep 0.2; done; grep -q '^# ' notes.md`
		)
	);
	await writeFile(hold(), '');

	await repo.ship(id, shipInput(sam));
	const first = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');
	const broken = first.summary.shipped!.sha;
	await untilMain(repo, (main) => main.verifying?.sha === broken);

	await script('shipped-twice', [writeOther, say('Added other notes.')]);
	await repo.reply(id, { author: sam, text: 'Add other notes.' });
	await untilThread(
		repo,
		id,
		(detail) => detail.summary.status === 'idle' && !!detail.summary.changes?.files
	);
	await repo.ship(id, shipInput(sam, 'docs: add other notes'));
	await untilThread(
		repo,
		id,
		(detail) => detail.summary.status === 'shipped' && detail.summary.shipped?.sha !== broken
	);
	expect((await repo.main()).verifying?.sha).toBe(broken);

	await script('shipped-twice', [say("I can't tell what's wrong.")]);
	await rm(hold());
	const red = await untilMain(repo, (main) => main.verified?.sha === broken);
	expect(red.verified).toMatchObject({ passed: false, culprit: { sha: broken, thread: id } });

	await untilThread(repo, id, (detail) => detail.summary.shipped?.verdict === 'reverted');
	expect(sh(canonical, 'log', '--format=%s', 'main')).toBe(
		'Revert "docs: drop the title"\ndocs: add other notes\ndocs: drop the title\ninit'
	);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
});

test.each(['stop', 'archive', 'delete'] as const)(
	'reverts what a thread broke when a person decides to %s it while it fixes main',
	async (action) => {
		const name = `${action}-while-fixing`;
		const { repo, sam, id, canonical } = await greenStart(name);
		await script(name, [sleepCall, say('Fixed it.')]);

		await repo.ship(id, shipInput(sam));
		await untilMain(repo, (main) => main.verified?.passed === false);
		await untilThread(
			repo,
			id,
			(detail) =>
				detail.summary.status === 'working' &&
				events(detail).some((text) => text.endsWith('handed back to the agent to fix'))
		);

		await repo[action](id, sam);
		const reverted = await untilThread(
			repo,
			id,
			(detail) => detail.summary.shipped?.verdict === 'reverted'
		);
		expect(reverted.summary.failure).toMatchObject({ title: 'Reverted' });
		expect(sh(canonical, 'log', '--format=%s', 'main')).toBe(
			'Revert "docs: drop the title"\ndocs: drop the title\ninit'
		);
		const pastTense = { stop: 'stopped', archive: 'archived', delete: 'deleted' }[action];
		expect(sh(canonical, 'log', '-1', '--format=%b', 'main')).toContain(
			`Sam ${pastTense} this thread before it fixed them`
		);
	}
);

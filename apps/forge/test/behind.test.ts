import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { dir, git, script, modelRequests, sh, commit, startedThread } = await setup();

test('reads main once per turn while the thread is up to date, however often it checkpoints', async () => {
	const { repo, id } = await startedThread('current', [
		writeNotes('# Notes\\n'),
		writeNotes('# Notes\\n\\nSome notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	const done = await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(done.entries.filter((entry) => entry.type === 'tools' && entry.checkpoint)).toHaveLength(
		2
	);
	expect(
		done.entries.some((entry) => entry.type === 'event' && entry.text.startsWith('Checkpoint'))
	).toBe(false);
	expect(done.summary.behind).toBeNull();
	const mainReads = (await git.paths()).filter((path) =>
		path.startsWith('GET /current.git/info/refs')
	);
	expect(mainReads).toHaveLength(2);
});

test('records how far behind main threads are, warns on conflicts and merges only when asked', async () => {
	const { env, repo, sam, id } = await startedThread('landing', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	await script('landing', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'other',
					name: 'run',
					arguments: JSON.stringify({ command: "printf 'More\\n' > other.md" })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Added other.md.' }]
	]);
	const { id: clean } = await repo.openThread({
		repo: 'landing',
		author: sam,
		text: 'Add other.md.',
		mode: 'small',
		machine: 'standard-1'
	});
	await untilThread(repo, clean, (detail) => detail.summary.status === 'needs-you');
	const work = join(dir, 'landing-work');
	await commit(work, { 'notes.md': 'Some better notes\n' }, 'Better notes');
	sh(work, 'push', '--quiet', join(dir, 'landing.git'), 'main');
	const main = sh(join(dir, 'landing.git'), 'rev-parse', 'main');

	const landing = {
		repo: 'landing',
		ref: 'refs/heads/main',
		after: main,
		headline: 'Better notes'
	};
	await repo.landed(landing);
	const warned = (await repo.thread(id))!;
	expect(warned.summary.behind).toEqual({
		branch: 'main',
		commits: 1,
		sha: main,
		headline: 'Better notes',
		conflicts: ['notes.md']
	});
	expect(warned.entries.at(-1)).toMatchObject({
		type: 'event',
		text: 'Conflicts with main in notes.md'
	});
	expect((await repo.thread(clean))!.summary.behind).toMatchObject({ commits: 1, conflicts: [] });
	await repo.landed(landing);
	expect((await repo.thread(id))!.entries).toHaveLength(warned.entries.length);

	await script('landing', [
		[{ type: 'response.output_text.delta', delta: 'Still on the old main.' }]
	]);
	await repo.reply(id, { author: sam, text: 'Carry on.' });
	await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Still on the old main.'
			)
	);
	const notified = JSON.stringify((await modelRequests('landing')).at(-1)!.query);
	expect(notified).toContain(
		`<system-notification>\\n\`main\` has 1 new commit (latest ${main.slice(0, 7)} \\"Better notes\\") that conflict with this thread's changes in notes.md.`
	);
	expect(notified.indexOf('system-notification')).toBeLessThan(notified.indexOf('Sam: Carry on.'));

	await script('landing', [[{ type: 'response.output_text.delta', delta: 'Still waiting.' }]]);
	await repo.reply(id, { author: sam, text: 'And now?' });
	await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Still waiting.')
	);
	expect(
		JSON.stringify((await modelRequests('landing')).at(-1)!.query).split(
			"conflict with this thread's changes"
		)
	).toHaveLength(2);
	const fork = join(dir, `landing--${id}.git`);
	expect(sh(fork, 'rev-list', 'main')).not.toContain(main);

	await script('landing', [
		writeNotes('# Notes\\n\\nSome better notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Merged main.' }]
	]);
	await repo.bringUpToDate(id, sam);
	const merged = await untilThread(
		repo,
		id,
		(detail) => detail.summary.status === 'needs-you' && detail.summary.behind === null
	);
	expect(merged.entries).toContainEqual(
		expect.objectContaining({
			type: 'event',
			text: `${sam.name} asked to bring this thread up to date with main`
		})
	);
	expect(JSON.stringify((await modelRequests('landing')).at(-2)!.query)).toContain(
		'merging it into this thread conflicts in notes.md'
	);
	expect(sh(fork, 'rev-list', '--parents', '-1', 'main').split(' ')).toContain(main);
	expect(sh(fork, 'show', 'main:notes.md')).toBe('# Notes\n\nSome better notes');
	expect(sh(join(dir, `landing--${clean}.git`), 'rev-list', 'main')).not.toContain(main);

	await script('landing', [
		writeNotes('# Other notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Rewrote the notes.' }],
		[{ type: 'response.output_text.delta', delta: 'Noted the conflict.' }]
	]);
	await repo.reply(clean, { author: sam, text: 'Rewrite the notes too.' });
	const conflicting = await untilThread(
		repo,
		clean,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Noted the conflict.'
			)
	);
	expect(JSON.stringify((await modelRequests('landing')).at(-1)!.query)).toContain(
		"that conflict with this thread's changes in notes.md"
	);
	expect(conflicting.summary.behind).toEqual({
		branch: 'main',
		commits: 1,
		sha: main,
		headline: 'Better notes',
		conflicts: ['notes.md']
	});
	expect((await env.ATTEMPTS.getByName(clean).snapshot())!.status).toBe('finished');
});

test('fetches main for a conflict notice that arrives mid-turn so the agent can inspect it', async () => {
	const { repo, sam, id } = await startedThread('midturn', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const go = join(dir, 'midturn-go');
	await script('midturn', [
		write(`while [ ! -f ${go} ]; do sleep 0.1; done`),
		write('git rev-parse upstream/main'),
		done('Looked at main.')
	]);
	await repo.reply(id, { author: sam, text: 'Keep going.' });
	await untilThread(repo, id, (detail) => detail.summary.status === 'running');

	const work = join(dir, 'midturn-work');
	await commit(work, { 'notes.md': 'Some better notes\n' }, 'Better notes');
	sh(work, 'push', '--quiet', join(dir, 'midturn.git'), 'main');
	const main = sh(join(dir, 'midturn.git'), 'rev-parse', 'main');
	await repo.landed({
		repo: 'midturn',
		ref: 'refs/heads/main',
		after: main,
		headline: 'Better notes'
	});
	expect((await repo.thread(id))!.summary.behind).toMatchObject({
		sha: main,
		conflicts: ['notes.md']
	});
	await writeFile(go, '');

	await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Looked at main.')
	);
	const requests = await modelRequests('midturn');
	const notice = JSON.stringify(requests.at(-2)!.query);
	expect(notice).toContain("that conflict with this thread's changes in notes.md");
	expect(notice).toContain(
		'See what landed with `git log HEAD..upstream/main` and `git diff HEAD...upstream/main -- notes.md`.'
	);
	expect(JSON.stringify(requests.at(-1)!.query)).toContain(main);
	expect(sh(join(dir, `midturn--${id}.git`), 'rev-list', 'main')).not.toContain(main);
});

test('lets the agent fetch and merge main itself without counting main as its changes', async () => {
	const { env, repo, sam, id } = await startedThread('self-merge', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const go = join(dir, 'self-merge-go');
	await script('self-merge', [
		write(`while [ ! -f ${go} ]; do sleep 0.1; done`),
		write(
			'git fetch upstream && git -c user.name=Sam -c user.email=sam@example.com merge --no-edit upstream/main'
		),
		done('Merged main.')
	]);
	await repo.reply(id, { author: sam, text: 'Pull in main.' });
	await untilThread(repo, id, (detail) => detail.summary.status === 'running');
	const work = join(dir, 'self-merge-work');
	await commit(work, { 'other.md': 'Landed\n' }, 'Add other.md');
	sh(work, 'push', '--quiet', join(dir, 'self-merge.git'), 'main');
	const main = sh(join(dir, 'self-merge.git'), 'rev-parse', 'main');
	await writeFile(go, '');

	await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Merged main.')
	);
	const fork = join(dir, `self-merge--${id}.git`);
	expect(sh(fork, 'rev-list', 'main')).toContain(main);
	const attempt = env.ATTEMPTS.getByName(id);
	expect((await attempt.changes())!.map(({ path }) => path)).toEqual(['notes.md']);
	expect((await attempt.revision())!.base).toBe(main);
});

test('tells an idle thread about conflicts with main even without a push event', async () => {
	const { repo, sam, id } = await startedThread('unannounced', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const work = join(dir, 'unannounced-work');
	await commit(work, { 'notes.md': 'Quiet notes\n' }, 'Quiet notes');
	sh(work, 'push', '--quiet', join(dir, 'unannounced.git'), 'main');

	await script('unannounced', [
		[{ type: 'response.output_text.delta', delta: 'Saw the conflict.' }]
	]);
	await repo.reply(id, { author: sam, text: 'Anything new?' });
	const detail = await untilThread(
		repo,
		id,
		(detail) => detail.summary.status === 'needs-you' && !!detail.summary.behind
	);
	expect(detail.summary.behind).toMatchObject({ commits: 1, conflicts: ['notes.md'] });
	expect(JSON.stringify((await modelRequests('unannounced')).at(-1)!.query)).toContain(
		"that conflict with this thread's changes in notes.md"
	);
});

const write = (command: string) => [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'write',
			name: 'run',
			arguments: JSON.stringify({ command })
		}
	}
];
const done = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const conflicts = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) =>
		entry.type === 'event' && entry.text.startsWith('Conflicts with "') ? [entry.text] : []
	);

test('notes threads whose changes conflict, in each thread and once to their agents', async () => {
	const {
		repo,
		sam,
		id: first
	} = await startedThread('overlap', [
		write("printf '# Notes\\n' > notes.md && printf 'a\\n' > bun.lock"),
		done('Added the title.')
	]);
	await untilThread(repo, first, (detail) => detail.summary.status === 'needs-you');
	const open = async (text: string, steps: object[][]) => {
		await script('overlap', steps);
		const { id } = await repo.openThread({
			repo: 'overlap',
			author: sam,
			text,
			mode: 'small',
			machine: 'standard-1'
		});
		await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
		return id;
	};
	const same = await open('Add the same title.', [
		write("printf '# Notes\\n' > notes.md"),
		done('Added it too.')
	]);
	const rewrite = await open('Rewrite the notes.', [
		write("printf '# Better notes\\n' > notes.md && printf 'c\\n' > bun.lock"),
		done('Rewrote the notes.')
	]);
	const noted = await untilThread(repo, rewrite, (detail) => conflicts(detail).length === 2);
	expect(conflicts(noted).sort()).toEqual([
		'Conflicts with "Add a title." in notes.md',
		'Conflicts with "Add the same title." in notes.md'
	]);
	expect(conflicts((await repo.thread(first))!)).toEqual([
		'Conflicts with "Rewrite the notes." in notes.md'
	]);
	expect(conflicts((await repo.thread(same))!)).toEqual([
		'Conflicts with "Rewrite the notes." in notes.md'
	]);

	const told = async (text: string, reply: string) => {
		await script('overlap', [done(reply)]);
		await repo.reply(first, { author: sam, text });
		await untilThread(repo, first, (detail) =>
			detail.entries.some((entry) => entry.type === 'message' && entry.text === reply)
		);
		return JSON.stringify((await modelRequests('overlap')).at(-1)!.query);
	};
	const notified = await told('Carry on.', 'Noted the conflict.');
	expect(notified).toContain(`- Thread ${rewrite} (\\"Rewrite the notes.\\"): notes.md\\n`);
	expect(notified).not.toContain(`- Thread ${same} `);
	expect((await told('And now?', 'Still noted.')).split('would conflict with')).toHaveLength(2);
});

test('blames a conflict on another thread only in files both threads changed', async () => {
	const {
		repo,
		sam,
		id: first
	} = await startedThread('stale-main', [
		write("printf '# Notes\\n' > notes.md && printf 'Mine\\n' > todo.md"),
		done('Added the title and a todo.')
	]);
	await untilThread(repo, first, (detail) => detail.summary.status === 'needs-you');
	const work = join(dir, 'stale-main-work');
	await commit(work, { 'todo.md': 'Theirs\n' }, 'Add a todo');
	sh(work, 'push', '--quiet', join(dir, 'stale-main.git'), 'main');

	await script('stale-main', [
		write("printf '# Better notes\\n' > notes.md"),
		done('Rewrote the notes.')
	]);
	const { id: later } = await repo.openThread({
		repo: 'stale-main',
		author: sam,
		text: 'Rewrite the notes.',
		mode: 'small',
		machine: 'standard-1'
	});
	const noted = await untilThread(repo, later, (detail) => conflicts(detail).length > 0);
	expect(conflicts(noted)).toEqual(['Conflicts with "Add a title." in notes.md']);
	expect(conflicts((await repo.thread(first))!)).toEqual([
		'Conflicts with "Rewrite the notes." in notes.md'
	]);
});

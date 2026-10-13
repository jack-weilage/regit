import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup, untilThread, writeNotes } from './support.ts';

const { dir, script, modelRequests, sh, commit, startedThread } = await setup();

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

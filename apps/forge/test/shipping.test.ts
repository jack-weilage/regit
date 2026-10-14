import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup, untilThread, writeNotes } from './support.ts';

const { dir, git, script, modelRequests, sh, commit, startedThread } = await setup();

test('ships finished work as one commit on main', async () => {
	const { repo, sam, id } = await startedThread('shipping', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		[{ type: 'response.output_text.delta', delta: 'It is the first line.' }]
	]);
	const ready = await untilThread(repo, id, (detail) => detail.summary.status === 'idle');
	expect(ready.summary.changes).toEqual({ files: 1, additions: 1, deletions: 1 });
	expect(await repo.changes(id)).toMatchObject([
		{ path: 'notes.md', change: 'modified', additions: 1, deletions: 1 }
	]);

	await repo.ship(id, {
		by: sam,
		email: 'sam@example.com',
		title: 'docs: add a title',
		body: 'Readers need a title.'
	});
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');

	const main = sh(join(dir, 'shipping.git'), 'rev-parse', 'main');
	expect(shipped.summary.shipped).toMatchObject({ sha: main, by: 'Sam' });
	expect(shipped.entries.at(-1)).toMatchObject({
		type: 'event',
		text: `Shipped ${main.slice(0, 7)} to main`
	});
	expect(sh(join(dir, 'shipping.git'), 'log', '--format=%an|%s', 'main')).toBe(
		'Sam|docs: add a title\nSam|init'
	);
	expect(sh(join(dir, 'shipping.git'), 'log', '-1', '--format=%b', 'main')).toMatch(
		/^Readers need a title\.\n\nCo-authored-by: ReGit <agent@regit\.dev>\n\nReGit-Ship: [0-9a-f]{32}$/
	);
	expect(sh(join(dir, 'shipping.git'), 'show', 'main:notes.md')).toBe('# Notes');
	expect((await git.requests()).some((headers) => headers.authorization)).toBe(false);

	await repo.landed({
		repo: 'shipping',
		ref: 'refs/heads/main',
		after: main,
		headline: 'docs: add a title'
	});
	expect((await repo.thread(id))!.summary.behind).toBeNull();
	const work = join(dir, 'shipping-work');
	sh(work, 'fetch', '--quiet', join(dir, 'shipping.git'), 'main');
	sh(work, 'reset', '--quiet', '--hard', 'FETCH_HEAD');
	await commit(work, { 'other.md': 'Other\n' }, 'Other notes');
	sh(work, 'push', '--quiet', join(dir, 'shipping.git'), 'main');
	const moved = sh(join(dir, 'shipping.git'), 'rev-parse', 'main');
	await repo.landed({ repo: 'shipping', ref: 'refs/heads/main', after: moved, headline: '' });
	expect((await repo.thread(id))!.summary.behind).toMatchObject({ commits: 1, conflicts: [] });

	await repo.reply(id, { author: sam, text: 'Where is the title?' });
	const answered = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'idle' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'It is the first line.'
			)
	);
	expect(answered.summary.changes).toEqual({ files: 0, additions: 0, deletions: 0 });
	expect(sh(join(dir, `shipping--${id}.git`), 'rev-parse', 'main')).toBe(main);
});

test('hands a conflicting ship back to its agent to resolve, then ships again', async () => {
	const { repo, sam, id } = await startedThread('conflicting', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');
	const work = join(dir, 'conflicting-work');
	await commit(work, { 'notes.md': 'Some better notes\n' }, 'Better notes');
	sh(work, 'push', '--quiet', join(dir, 'conflicting.git'), 'main');
	const main = sh(join(dir, 'conflicting.git'), 'rev-parse', 'main');
	await script('conflicting', [
		writeNotes('# Notes\\n\\nSome better notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Resolved the conflict.' }]
	]);

	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');
	expect(shipped.entries).toContainEqual(
		expect.objectContaining({
			type: 'event',
			text: 'Ship conflicts with main in notes.md. Handing it back to the agent to bring up to date.',
			tone: 'warning'
		})
	);
	const handedBack = JSON.stringify((await modelRequests('conflicting')).at(-2)!.query);
	expect(handedBack).toContain('Shipping conflicted with main.');
	expect(handedBack).toContain('conflicts in notes.md');
	const canonical = join(dir, 'conflicting.git');
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes\n\nSome better notes');
	expect(sh(canonical, 'rev-parse', 'main^')).toBe(main);
	expect(sh(canonical, 'log', '--format=%s', 'main')).toBe('docs: add a title\nBetter notes\ninit');
	const runFork = join(dir, `conflicting--${id}.git`);
	expect(sh(runFork, 'rev-list', '--parents', '-1', 'main').split(' ')).toContain(main);
});

test("ships to the branch the repository's HEAD points to, not its recorded default", async () => {
	const { repo, sam, id } = await startedThread(
		'imported',
		[writeNotes('# Notes\\n'), [{ type: 'response.output_text.delta', delta: 'Added the title.' }]],
		'master'
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');

	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');

	expect(shipped.branch).toBe('master');
	expect(shipped.entries.slice(-2).map((entry) => entry.type === 'event' && entry.text)).toEqual([
		'Sam is shipping this thread to master',
		`Shipped ${sh(join(dir, 'imported.git'), 'rev-parse', '--short=7', 'master')} to master`
	]);
	expect(sh(join(dir, 'imported.git'), 'log', '--format=%s', 'master')).toBe(
		'docs: add a title\ninit'
	);
	expect(() => sh(join(dir, 'imported.git'), 'rev-parse', '--verify', 'main')).toThrow();
});

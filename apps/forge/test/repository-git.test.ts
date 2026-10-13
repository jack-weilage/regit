import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Ship } from '@regit/core';
import { setup } from './support.ts';

const harness = await setup();

test('ships the pinned revision once, even when retried, and records provenance', async () => {
	const repo = 'publisher';
	const work = await harness.seed(repo, { 'file.txt': 'base\n' });
	const base = harness.sh(work, 'rev-parse', 'HEAD');
	const source = `${repo}--source`;
	harness.sh(harness.dir, 'clone', '--bare', work, `${source}.git`);
	await harness.commit(work, { 'file.txt': 'pinned\n' }, 'pinned');
	const sha = harness.sh(work, 'rev-parse', 'HEAD');
	harness.sh(work, 'push', join(harness.dir, `${source}.git`), 'HEAD:main');
	await harness.commit(work, { 'file.txt': 'later\n' }, 'later');
	harness.sh(work, 'push', join(harness.dir, `${source}.git`), 'HEAD:main');
	const ship: Ship = {
		id: 'b'.repeat(32),
		repo,
		thread: 'thread',
		source: { proposal: 'thread', repository: source, branch: 'main', base, sha, at: 1 },
		intent: null,
		by: { name: 'Sam', kind: 'person' },
		email: 'sam@example.com',
		title: 'Ship pinned',
		body: '',
		handBacks: 0
	};
	const env = await harness.worker.getEnv();
	const publisher = env.REPOSITORY_GIT.getByName(`ship-${repo}`);

	const canonical = join(harness.dir, `${repo}.git`);
	const shipped = await publisher.ship(ship);
	expect(await publisher.ship(ship)).toEqual(shipped);
	expect(harness.sh(canonical, 'rev-parse', 'main')).toBe(shipped.sha);
	expect(shipped.branch).toBe('main');
	expect(harness.sh(canonical, 'rev-list', '--count', 'main')).toBe('2');
	expect(harness.sh(canonical, 'show', 'main:file.txt')).toBe('pinned');
	expect(JSON.parse(harness.sh(canonical, 'notes', '--ref=regit', 'show', shipped.sha))).toEqual({
		schema: 2,
		ship: ship.id,
		source: ship.source,
		intent: null,
		shippedBy: ship.by
	});
});

test('reverts a commit on main once, even when retried', async () => {
	const repo = 'reverting';
	const work = await harness.seed(repo, { 'file.txt': 'base\n' });
	await harness.commit(work, { 'file.txt': 'broken\n' }, 'Break it');
	const canonical = join(harness.dir, `${repo}.git`);
	harness.sh(work, 'push', '--quiet', canonical, 'main');
	const broken = harness.sh(canonical, 'rev-parse', 'main');
	const env = await harness.worker.getEnv();
	const publisher = env.REPOSITORY_GIT.getByName(`ship-${repo}`);

	const input = { repo, sha: broken, message: 'Revert "Break it"\n\nDeploy checks failed.' };
	const reverted = await publisher.revert(input);
	expect(await publisher.revert(input)).toEqual(reverted);
	expect(harness.sh(canonical, 'rev-parse', 'main')).toBe(reverted.sha);
	expect(harness.sh(canonical, 'rev-parse', 'main^')).toBe(broken);
	expect(harness.sh(canonical, 'show', 'main:file.txt')).toBe('base');
	expect(harness.sh(canonical, 'log', '-1', '--format=%an|%s', 'main')).toBe(
		'ReGit|Revert "Break it"'
	);
});

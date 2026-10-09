import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { Revision, Promotion } from '@regit/core';
import { setup } from './support.ts';

const harness = await setup();

test('prepares the pinned revision, publishes exactly it, and writes independent notes', async () => {
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
	const revision: Revision = {
		id: 'revision',
		proposal: 'proposal',
		run: 'run',
		intent: 'intent',
		repository: source,
		branch: 'main',
		base,
		sha,
		at: 1
	};
	const promotion: Promotion = {
		id: 'publish',
		proposal: 'proposal',
		revision: revision.id,
		intent: 'intent',
		requestedBy: { name: 'Sam', kind: 'person' },
		email: 'sam@example.com',
		title: 'Ship pinned',
		body: '',
		status: 'preparing',
		candidate: null,
		assessment: null,
		error: null,
		notesPublished: false,
		at: 1
	};
	const env = await harness.worker.getEnv();
	const publisher = env.REPOSITORY_GIT.getByName(`promotion-${promotion.id}`);
	const candidate = await publisher.prepare(repo, revision, promotion);
	expect(candidate.repository).toBe(`${repo}--candidate-publish`);
	expect(candidate.expectedHead).toBe(base);
	const fork = join(harness.dir, `${candidate.repository}.git`);
	expect(harness.sh(fork, 'show', `${candidate.sha}:file.txt`)).toBe('pinned');
	expect(await publisher.prepare(repo, { ...revision, sha: base }, promotion)).toEqual(candidate);
	await publisher.promote(repo, candidate);
	await publisher.promote(repo, candidate);
	const canonical = join(harness.dir, `${repo}.git`);
	expect(harness.sh(canonical, 'rev-parse', 'main')).toBe(candidate.sha);
	await expect(publisher.notes(repo, candidate, 'invalid JSON')).rejects.toThrow();
	expect(harness.sh(canonical, 'rev-parse', 'main')).toBe(candidate.sha);
	const note = JSON.stringify({ revision: revision.id, sourceSha: sha });
	await publisher.notes(repo, candidate, note);
	expect(harness.sh(canonical, 'notes', '--ref=regit', 'show', candidate.sha)).toBe(note);
});

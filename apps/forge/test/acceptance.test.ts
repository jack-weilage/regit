import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail as CoreThreadDetail, ProposalControl } from '@regit/core';
import { setup } from './support.ts';

type ThreadDetail = CoreThreadDetail & { control: ProposalControl };

const { dir, worker, seed, commit, sh, idle, script, submitReview, modelRequests } = await setup();
const owner = { id: 'owner', name: 'Sam', kind: 'person' as const };
const intent = {
	headline: 'docs: add a title',
	purpose: 'Readers need a title.',
	doneWhen: ['notes.md starts with a title']
};
const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const tool = (name: string, args: object) => [
	{
		type: 'response.output_item.done',
		item: { type: 'function_call', call_id: name, name, arguments: JSON.stringify(args) }
	}
];

async function until(
	repo: ReturnType<Env['REPOS']['getByName']>,
	id: string,
	check: (detail: ThreadDetail) => boolean
) {
	try {
		await expect
			.poll(async () => check((await repo.thread(id)) as ThreadDetail), { timeout: 30_000 })
			.toBe(true);
	} catch (error) {
		throw new Error(`Thread did not settle: ${JSON.stringify(await repo.thread(id))}`, {
			cause: error
		});
	}
	return (await repo.thread(id)) as ThreadDetail;
}

async function finishedRun(name: string) {
	const work = await seed(name, { 'notes.md': 'Some notes\n' });
	const canonical = join(dir, `${name}.git`);
	const original = sh(canonical, 'rev-parse', 'main');
	const env = await worker.getEnv();
	await env.DB.prepare('INSERT INTO repos (name, created_by, created_at) VALUES (?, ?, ?)')
		.bind(name, 'Sam', Date.now())
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, owner.id, 'owner')
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, 'editor', 'editor')
		.run();
	await idle();
	await script([
		say('Proposed.'),
		tool('write_file', { path: 'notes.md', content: '# Notes\n' }),
		say('Done.'),
		submitReview('pass', ['met'])
	]);
	const repo = env.REPOS.getByName(name);
	const opened = await repo.openThread({
		repo: name,
		author: owner,
		text: 'Add a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	const id = opened.id;
	await until(repo, id, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.author.kind === 'agent')
	);
	await repo.intentProposed(id, intent);
	await repo.start(id, owner);
	const detail = await until(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	return { env, repo, id, detail, work, canonical, original };
}

async function candidate(name: string) {
	const run = await finishedRun(name);
	await idle();
	await script([submitReview('pass', ['met'])]);
	await run.repo.ship(run.id, {
		by: owner,
		email: 'sam@example.com',
		title: intent.headline,
		body: intent.purpose
	});
	const detail = await until(
		run.repo,
		run.id,
		(detail) => detail.control.promotions.at(-1)?.status === 'ready'
	);
	const promotion = detail.control.promotions.at(-1)!;
	expect(sh(run.canonical, 'rev-parse', 'main')).toBe(run.original);
	return { ...run, ready: detail, promotion };
}

test('only an owner can queue and approve the exact isolated, assessed candidate', async () => {
	const { repo, id, detail, canonical, original } = await finishedRun('accept-exact');
	const input = {
		by: owner,
		email: 'sam@example.com',
		title: intent.headline,
		body: intent.purpose
	};
	for (const by of [
		{ name: 'Sam', kind: 'person' as const },
		{ ...owner, id: 'editor' },
		{ ...owner, id: 'stranger' },
		{ ...owner, kind: 'agent' as const }
	]) {
		await expect(repo.ship(id, { ...input, by })).rejects.toThrow();
	}
	expect((await repo.thread(id))!.control!.promotions).toEqual([]);
	await idle();
	await script([submitReview('pass', ['met'])]);
	await repo.ship(id, input);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	const ready = await until(
		repo,
		id,
		(detail) => detail.control.promotions.at(-1)?.status === 'ready'
	);
	const promotion = ready.control.promotions.at(-1)!;
	const candidate = promotion.candidate!;
	const revision = ready.control.revisions.find((revision) => revision.id === promotion.revision)!;
	expect(revision).toMatchObject({
		run: detail.control.runs[0]!.id,
		intent: ready.control.acceptedIntent!.id
	});
	expect(promotion.assessment).toMatchObject({
		revision: candidate.sha,
		intent: promotion.intent,
		producer: `verify-${promotion.id}`,
		verdict: 'pass'
	});
	expect(candidate.expectedHead).toBe(original);
	expect(candidate.repository).not.toBe(revision.repository);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	const fork = join(dir, `${candidate.repository}.git`);
	expect(sh(fork, 'show', `${candidate.sha}:notes.md`)).toBe('# Notes');
	expect(sh(fork, 'log', '-1', '--format=%an|%ae|%cn|%ce|%s', candidate.sha)).toBe(
		'Sam|sam@example.com|ReGit|agent@regit.dev|docs: add a title'
	);
	expect(sh(fork, 'log', '-1', '--format=%b', candidate.sha)).toBe(
		`${intent.purpose}\n\nCo-authored-by: ReGit <agent@regit.dev>`
	);
	await expect(repo.approvePromotion(id, 'not-this-candidate', owner)).rejects.toThrow();
	await expect(
		repo.approvePromotion(id, promotion.id, { ...owner, id: 'editor' })
	).rejects.toThrow();
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	await repo.approvePromotion(id, promotion.id, owner);
	const shipped = await until(
		repo,
		id,
		(detail) => detail.control.promotions.at(-1)?.notesPublished === true
	);
	expect(shipped.summary.shipped).toMatchObject({ sha: candidate.sha, by: 'Sam' });
	expect(sh(canonical, 'rev-parse', 'main')).toBe(candidate.sha);
	expect(sh(canonical, 'rev-list', '--count', 'main')).toBe('2');
	const note = JSON.parse(sh(canonical, 'notes', '--ref=regit', 'show', candidate.sha));
	expect(note).toMatchObject({
		schema: 1,
		promotion: promotion.id,
		source: revision,
		intent: ready.control.acceptedIntent,
		assessment: promotion.assessment,
		authorizedBy: owner
	});
	const reviewRequests = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'review'
	);
	expect(reviewRequests).toHaveLength(1);
});

test('accepting changed intent invalidates the pending candidate and its approval', async () => {
	const { repo, id, ready, promotion, canonical, original } = await candidate('accept-changed');
	await repo.intentProposed(id, {
		...intent,
		headline: 'docs: add a footer',
		doneWhen: ['notes.md ends with a footer']
	});
	await repo.acceptIntent(id, owner);
	const changed = (await repo.thread(id)) as ThreadDetail;
	expect(changed.control.acceptedIntent!.id).not.toBe(ready.control.acceptedIntent!.id);
	expect(changed.control.promotions.at(-1)).toMatchObject({
		id: promotion.id,
		status: 'cancelled'
	});
	await expect(repo.approvePromotion(id, promotion.id, owner)).rejects.toThrow();
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
});

test('an external main advance makes an approved candidate stale without rebasing or pushing it', async () => {
	const { repo, id, promotion, canonical, work } = await candidate('accept-stale');
	const pinned = promotion.candidate!;
	await commit(work, { 'external.md': 'External work\n' }, 'External advance');
	sh(work, 'push', '--quiet', canonical, 'main');
	const external = sh(canonical, 'rev-parse', 'main');
	await repo.approvePromotion(id, promotion.id, owner);
	const failed = await until(
		repo,
		id,
		(detail) => detail.control.promotions.at(-1)?.status === 'failed'
	);
	expect(failed.control.promotions.at(-1)).toMatchObject({
		candidate: pinned,
		notesPublished: false,
		error: expect.stringContaining('Stale candidate:')
	});
	expect(sh(canonical, 'rev-parse', 'main')).toBe(external);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('Some notes');
	expect(sh(join(dir, `${pinned.repository}.git`), 'rev-parse', 'main')).toBe(pinned.sha);
	expect(() => sh(canonical, 'notes', '--ref=regit', 'show', pinned.sha)).toThrow();
});

test('new runs are independent from proposals and ignore callbacks from older runs', async () => {
	const { env, repo, id, detail, canonical, original } = await finishedRun('accept-runs');
	const first = detail.control.runs[0]!;
	expect(first.id).not.toBe(id);
	const firstRevision = await env.ATTEMPTS.getByName(first.id).revision();
	await idle();
	await script([
		tool('write_file', { path: 'notes.md', content: '# Another title\n' }),
		say('Done again.'),
		submitReview('pass', ['met'])
	]);
	await repo.start(id, owner);
	const second = await until(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(second.control.runs).toHaveLength(2);
	expect(second.control.runs[1]).toMatchObject({ proposal: id, intent: first.intent });
	expect(second.control.runs[1]!.id).not.toBe(first.id);
	expect(second.control.acceptedIntent).toEqual(detail.control.acceptedIntent);
	expect(await env.ATTEMPTS.getByName(first.id).revision()).toMatchObject({
		...firstRevision,
		at: expect.any(Number)
	});
	await repo.attemptUpdated(
		id,
		{ type: 'status', status: 'failed', error: 'Old failure' },
		first.id
	);
	await repo.attemptUpdated(id, { type: 'shipped', sha: 'a'.repeat(40), base: 'main' }, first.id);
	await repo.attemptUpdated(id, {
		type: 'status',
		status: 'failed',
		error: 'Missing run identity'
	});
	expect(await repo.thread(id)).toEqual(second);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
});

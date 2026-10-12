import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup } from './support.ts';

const { dir, worker, seed, commit, sh, idle, script, scriptAnalyses } = await setup();
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

async function finishedThread(name: string) {
	const work = await seed(name, { 'notes.md': 'Some notes\n' });
	const canonical = join(dir, `${name}.git`);
	const original = sh(canonical, 'rev-parse', 'main');
	const env = await worker.getEnv();
	await env.DB.prepare('INSERT INTO repos (name, created_at) VALUES (?, ?)')
		.bind(name, Date.now())
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, owner.id, 'owner')
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, 'editor', 'editor')
		.run();
	await idle();
	await scriptAnalyses([tool('update_intent', intent)]);
	await script([tool('write_file', { path: 'notes.md', content: '# Notes\n' }), say('Done.')]);
	const repo = env.REPOS.getByName(name);
	const opened = await repo.openThread({
		repo: name,
		author: owner,
		text: 'Add a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	const id = opened.id;
	const detail = await until(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'intent')
	);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	return { env, repo, id, detail, work, canonical, original };
}

async function candidate(name: string) {
	const run = await finishedThread(name);
	await run.repo.ship(run.id, {
		by: owner,
		email: 'sam@example.com',
		title: intent.headline,
		body: intent.purpose
	});
	const detail = await until(
		run.repo,
		run.id,
		(detail) => detail.promotions.at(-1)?.status === 'ready'
	);
	const promotion = detail.promotions.at(-1)!;
	expect(sh(run.canonical, 'rev-parse', 'main')).toBe(run.original);
	return { ...run, ready: detail, promotion };
}

test('only an owner can queue and approve the exact isolated candidate', async () => {
	const { repo, id, canonical, original } = await finishedThread('publish-exact');
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
	expect((await repo.thread(id))!.promotions).toEqual([]);
	await repo.ship(id, input);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	const ready = await until(repo, id, (detail) => detail.promotions.at(-1)?.status === 'ready');
	const promotion = ready.promotions.at(-1)!;
	const candidate = promotion.candidate!;
	const revision = promotion.source;
	expect(revision).toMatchObject({ proposal: id, repository: `publish-exact--${id}` });
	expect(promotion.intent).toEqual(intent);
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
		(detail) => detail.promotions.at(-1)?.notesPublished === true
	);
	expect(shipped.summary).toMatchObject({
		status: 'shipped',
		changes: null,
		shipped: { sha: candidate.sha, by: 'Sam' }
	});
	expect(sh(canonical, 'rev-parse', 'main')).toBe(candidate.sha);
	expect(sh(canonical, 'rev-list', '--count', 'main')).toBe('2');
	const note = JSON.parse(sh(canonical, 'notes', '--ref=regit', 'show', candidate.sha));
	expect(note).toMatchObject({
		schema: 1,
		promotion: promotion.id,
		source: revision,
		intent,
		authorizedBy: owner
	});
});

test('discarding a thread with a pending candidate cancels it and reopens as needing you', async () => {
	const { repo, id } = await finishedThread('discard-pending');
	await repo.ship(id, {
		by: owner,
		email: 'sam@example.com',
		title: intent.headline,
		body: intent.purpose
	});
	await repo.discard(id, owner);
	await repo.reopen(id, owner);
	const detail = (await repo.thread(id)) as ThreadDetail;
	expect(detail.summary.status).toBe('needs-you');
	expect(detail.promotions.at(-1)!.status).toBe('cancelled');
});

test('work after a candidate is prepared lands on the published commit afterwards', async () => {
	const { repo, id, promotion, canonical } = await candidate('publish-later');
	await idle();
	await script([
		tool('write_file', { path: 'footer.md', content: 'A footer\n' }),
		say('Added a footer.')
	]);
	await repo.reply(id, { author: owner, text: 'Add a footer too.' });
	await until(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Added a footer.')
	);
	await repo.approvePromotion(id, promotion.id, owner);
	await until(repo, id, (detail) => detail.summary.status === 'shipped');
	const published = promotion.candidate!.sha;
	expect(sh(canonical, 'rev-parse', 'main')).toBe(published);
	expect(() => sh(canonical, 'show', 'main:footer.md')).toThrow();

	await script([say('Rebased.')]);
	await repo.reply(id, { author: owner, text: 'Carry on.' });
	const rebased = await until(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Rebased.')
	);
	const fork = join(dir, `publish-later--${id}.git`);
	expect(sh(fork, 'rev-parse', 'main^')).toBe(published);
	expect(sh(fork, 'show', 'main:footer.md')).toBe('A footer');
	expect(rebased.summary.changes).toEqual({ files: 1, additions: 1, deletions: 0 });
});

test('an external main advance makes an approved candidate stale without rebasing or pushing it', async () => {
	const { repo, id, promotion, canonical, work } = await candidate('accept-stale');
	const pinned = promotion.candidate!;
	await commit(work, { 'external.md': 'External work\n' }, 'External advance');
	sh(work, 'push', '--quiet', canonical, 'main');
	const external = sh(canonical, 'rev-parse', 'main');
	await repo.approvePromotion(id, promotion.id, owner);
	const failed = await until(repo, id, (detail) => detail.promotions.at(-1)?.status === 'failed');
	expect(failed.promotions.at(-1)).toMatchObject({
		candidate: pinned,
		notesPublished: false,
		error: expect.stringContaining('Stale candidate:')
	});
	expect(sh(canonical, 'rev-parse', 'main')).toBe(external);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('Some notes');
	expect(sh(join(dir, `${pinned.repository}.git`), 'rev-parse', 'main')).toBe(pinned.sha);
	expect(() => sh(canonical, 'notes', '--ref=regit', 'show', pinned.sha)).toThrow();
});

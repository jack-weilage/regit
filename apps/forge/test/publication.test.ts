import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { LiveMessage, ThreadDetail } from '@regit/core';
import { setup } from './support.ts';

const { dir, worker, seed, commit, sh, script } = await setup();
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
	await script(name, [
		tool('update_intent', intent),
		tool('write_file', { path: 'notes.md', content: '# Notes\n' }),
		say('Done.')
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
	const detail = await until(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);
	return { env, repo, id, detail, work, canonical, original };
}

const input = {
	by: owner,
	email: 'sam@example.com',
	title: intent.headline,
	body: intent.purpose
};

test('only an owner can ship, and shipping squashes the thread onto main with provenance', async () => {
	const { repo, id, canonical, original } = await finishedThread('ship-exact');
	for (const by of [
		{ name: 'Sam', kind: 'person' as const },
		{ ...owner, id: 'editor' },
		{ ...owner, id: 'stranger' },
		{ ...owner, kind: 'agent' as const }
	]) {
		await expect(repo.ship(id, { ...input, by })).rejects.toThrow();
	}
	expect(sh(canonical, 'rev-parse', 'main')).toBe(original);

	const live: LiveMessage[] = [];
	const { webSocket: socket } = await repo.fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	socket!.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));
	await repo.ship(id, input);
	const shipped = await until(repo, id, (detail) => detail.summary.status === 'shipped');
	socket!.close();
	const sha = sh(canonical, 'rev-parse', 'main');
	const stages = live.flatMap((message) =>
		message.type === 'activity' && message.thread === id && message.activity?.ship
			? [message.activity.ship.stage]
			: []
	);
	expect(stages).toEqual(['starting', 'fetching', 'building', 'pushing', 'recording']);
	expect(shipped.activity).toBeNull();
	expect(shipped.summary).toMatchObject({ changes: null, shipped: { sha, by: 'Sam' } });
	expect(shipped.entries.at(-1)).toMatchObject({
		type: 'event',
		text: `Shipped ${sha.slice(0, 7)} to main`
	});
	expect(sh(canonical, 'rev-parse', 'main^')).toBe(original);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
	expect(sh(canonical, 'log', '-1', '--format=%an|%ae|%cn|%ce|%s', 'main')).toBe(
		'Sam|sam@example.com|ReGit|agent@regit.dev|docs: add a title'
	);
	const body = sh(canonical, 'log', '-1', '--format=%b', 'main');
	const shipId = /ReGit-Ship: ([0-9a-f]{32})$/.exec(body)![1];
	expect(body).toBe(
		`${intent.purpose}\n\nCo-authored-by: ReGit <agent@regit.dev>\n\nReGit-Ship: ${shipId}`
	);
	expect(JSON.parse(sh(canonical, 'notes', '--ref=regit', 'show', sha))).toEqual({
		schema: 2,
		ship: shipId,
		source: expect.objectContaining({ proposal: id, repository: `ship-exact--${id}` }),
		intent,
		shippedBy: owner
	});
	expect(readdirSync(dir).filter((name) => name.includes('--candidate-'))).toEqual([]);
});

test('a shipping thread cannot be discarded until it finishes', async () => {
	const { repo, id } = await finishedThread('ship-discard');
	await repo.ship(id, input);
	await expect(repo.discard(id, owner)).rejects.toThrow();
	expect(((await repo.thread(id)) as ThreadDetail).summary.status).toBe('shipping');
	await until(repo, id, (detail) => detail.summary.status === 'shipped');
	await repo.discard(id, owner);
	expect(((await repo.thread(id)) as ThreadDetail).summary.status).toBe('discarded');
});

test('ships onto main as it is when shipping, even after main moved', async () => {
	const { repo, id, canonical, work } = await finishedThread('ship-moved');
	await commit(work, { 'external.md': 'External work\n' }, 'External advance');
	sh(work, 'push', '--quiet', canonical, 'main');
	const external = sh(canonical, 'rev-parse', 'main');

	await repo.ship(id, input);
	await until(repo, id, (detail) => detail.summary.status === 'shipped');
	expect(sh(canonical, 'rev-parse', 'main^')).toBe(external);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
	expect(sh(canonical, 'show', 'main:external.md')).toBe('External work');
});

test('work after shipping builds on the shipped commit', async () => {
	const { repo, id, canonical } = await finishedThread('ship-later');
	await repo.ship(id, input);
	await until(repo, id, (detail) => detail.summary.status === 'shipped');
	const published = sh(canonical, 'rev-parse', 'main');

	await script('ship-later', [
		tool('write_file', { path: 'footer.md', content: 'A footer\n' }),
		say('Added a footer.')
	]);
	await repo.reply(id, { author: owner, text: 'Add a footer too.' });
	const later = await until(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Added a footer.')
	);
	const fork = join(dir, `ship-later--${id}.git`);
	expect(sh(fork, 'rev-parse', 'main^')).toBe(published);
	expect(sh(fork, 'show', 'main:footer.md')).toBe('A footer');
	expect(later.summary.changes).toEqual({ files: 1, additions: 1, deletions: 0 });
	expect(sh(canonical, 'rev-parse', 'main')).toBe(published);
});

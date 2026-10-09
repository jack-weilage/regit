import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { hashGitToken, newGitToken } from '@regit/db';
import { setup } from './support.ts';

const t = await setup();
const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
	(
		await run('git', args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
	).stdout.trim();

test('authenticated clone/fetch is read-only even with a legacy write scope', async () => {
	const repo = 'ingress-demo';
	await t.seed(repo, { 'README.md': '# Demo\n' });
	const env = await t.worker.getEnv();
	await env.DB.prepare('INSERT INTO repos (name, created_by, created_at) VALUES (?, ?, ?)')
		.bind(repo, 'sam@example.com', Date.now())
		.run();
	const secret = newGitToken();
	const id = crypto.randomUUID();
	await env.DB.prepare(
		'INSERT INTO git_tokens (id, hash, repo, scope, label, created_by, principal_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(
			id,
			await hashGitToken(secret),
			repo,
			'write',
			'test',
			'sam@example.com',
			'sam',
			Date.now(),
			Date.now() + 86400000
		)
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(repo, 'sam', 'viewer')
		.run();
	// The harness fetch keeps the production hostname while the real Git client uses a local bridge.
	const bridge = (await import('node:http')).createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) chunks.push(Buffer.from(chunk));
		const headers = new Headers();
		for (const [name, value] of Object.entries(req.headers)) {
			if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
		}
		const response = await t.worker.fetch(`https://git.regit.dev${req.url}`, {
			method: req.method,
			headers: Object.fromEntries(headers),
			...(req.method === 'POST' && { body: Buffer.concat(chunks) })
		});
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
	try {
		const port = (bridge.address() as import('node:net').AddressInfo).port;
		const remote = `http://token:${secret}@127.0.0.1:${port}/${repo}.git`;
		const clone = join(t.dir, 'ingress-clone');
		await git(t.dir, 'clone', '--quiet', remote, clone);
		expect(await readFile(join(clone, 'README.md'), 'utf8')).toBe('# Demo\n');
		await git(clone, 'fetch', '--quiet', 'origin');
		await expect(git(clone, 'push', 'origin', 'main')).rejects.toThrow(/403/);
		expect((await t.git.requests()).every((h) => h.authorization === `Bearer token-${repo}`)).toBe(
			true
		);
		const auth = { authorization: `Basic ${btoa(`token:${secret}`)}` };
		for (const path of ['info/refs?service=git-receive-pack', 'git-receive-pack']) {
			expect(
				(await t.worker.fetch(`https://git.regit.dev/${repo}.git/${path}`, { headers: auth }))
					.status
			).toBe(403);
		}
		const read = () =>
			t.worker.fetch(`https://git.regit.dev/${repo}.git/info/refs?service=git-upload-pack`, {
				headers: auth
			});
		await env.DB.prepare('DELETE FROM repo_members WHERE repo = ?').bind(repo).run();
		expect((await read()).status).toBe(403);
		await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
			.bind(repo, 'sam', 'viewer')
			.run();
		await env.DB.prepare('UPDATE git_tokens SET principal_id = NULL WHERE id = ?').bind(id).run();
		expect((await read()).status).toBe(403);
		await env.DB.prepare('UPDATE git_tokens SET expires_at = 0 WHERE id = ?').bind(id).run();
		expect((await read()).status).toBe(401);
		expect(
			(await t.worker.fetch(`https://git.regit.dev/${repo}.git/info/refs?service=git-upload-pack`))
				.status
		).toBe(401);
	} finally {
		await new Promise<void>((resolve, reject) =>
			bridge.close((error) => (error ? reject(error) : resolve()))
		);
	}
});

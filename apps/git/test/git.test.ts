import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { startGitServer } from '../../forge/test/git-process.ts';
import { hashGitToken, newGitToken } from '@regit/db';

let dir: string;
let backend: Awaited<ReturnType<typeof startGitServer>>;
let server: ReturnType<typeof createTestHarness>;
let worker: ReturnType<typeof server.getWorker<Env>>;
let base: URL;

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) =>
	(
		await run('git', args, {
			cwd,
			encoding: 'utf8',
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
		})
	).stdout.trim();
const fails = async (cwd: string, ...args: string[]) => {
	try {
		await git(cwd, ...args);
	} catch (error) {
		return String((error as { stderr?: string }).stderr);
	}
	throw new Error(`git ${args.join(' ')} succeeded`);
};
const remote = (secret: string, repo = 'demo') => `http://token:${secret}@${base.host}/${repo}.git`;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'regit-git-proxy-'));
	backend = await startGitServer(dir);
	server = createTestHarness({
		workers: [
			{
				configPath: './test/wrangler.jsonc',
				bindingOverrides: { ARTIFACTS: 'fake-artifacts' }
			},
			{
				config: {
					name: 'fake-artifacts',
					main: './test/fake-artifacts.ts',
					compatibility_date: '2026-10-01',
					vars: { GIT_REMOTE: `http://127.0.0.1:${backend.port}` }
				}
			}
		]
	});
	worker = server.getWorker<Env>();
	base = (await server.listen()).url;
	const work = join(dir, 'seed');
	await git(dir, 'init', '--quiet', '--initial-branch', 'main', work);
	await writeFile(join(work, 'README.md'), '# Demo\n');
	await git(work, 'add', '.');
	await git(
		work,
		'-c',
		'user.name=Sam',
		'-c',
		'user.email=sam@example.com',
		'commit',
		'--quiet',
		'-m',
		'init'
	);
	await git(dir, 'clone', '--quiet', '--bare', work, 'demo.git');
});
beforeEach(() => worker.applyD1Migrations('DB'));
afterEach(async () => {
	await (await worker.getEnv()).DB.prepare('DELETE FROM git_tokens').run();
});
afterAll(async () => {
	await server.close();
	backend.close();
	await rm(dir, { recursive: true, force: true });
});

async function token(repo: string, scope: 'read' | 'write', days = 30) {
	const secret = newGitToken();
	const now = Date.now();
	await (
		await worker.getEnv()
	).DB.prepare(
		'INSERT INTO git_tokens (id, hash, repo, scope, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
	)
		.bind(
			crypto.randomUUID(),
			await hashGitToken(secret),
			repo,
			scope,
			'laptop',
			'sam@regit.dev',
			now,
			now + days * 86_400_000
		)
		.run();
	return secret;
}

test('clones with a read token and pushes with a write token, through Artifacts', async () => {
	const reader = await token('demo', 'read');
	const writer = await token('demo', 'write');

	const clone = join(dir, 'clone');
	await git(dir, 'clone', '--quiet', remote(reader), clone);
	expect(await readFile(join(clone, 'README.md'), 'utf8')).toBe('# Demo\n');

	await writeFile(join(clone, 'README.md'), '# Demo\n\nFrom a laptop.\n');
	await git(
		clone,
		'-c',
		'user.name=Sam',
		'-c',
		'user.email=sam@example.com',
		'commit',
		'--quiet',
		'-am',
		'Edit'
	);
	expect(await fails(clone, 'push', remote(reader), 'main')).toContain(
		"This token can't push to demo"
	);

	await git(clone, 'push', '--quiet', remote(writer), 'main');
	expect(await git(join(dir, 'demo.git'), 'log', '-1', '--format=%s', 'main')).toBe('Edit');
	expect((await backend.requests()).map((headers) => headers.authorization)).toContain(
		'Bearer artifact-write'
	);
	const { results } = await (
		await worker.getEnv()
	).DB.prepare('SELECT last_used_at FROM git_tokens').all();
	expect(results.map((row) => row.last_used_at)).not.toContain(null);
});

test('refuses missing, foreign and expired tokens', async () => {
	expect((await fetch(new URL('/demo.git/info/refs?service=git-upload-pack', base))).status).toBe(
		401
	);
	expect(await fails(dir, 'ls-remote', remote(await token('other', 'write')))).toContain(
		"This token doesn't grant access to demo"
	);
	expect(await fails(dir, 'ls-remote', remote(await token('demo', 'read', -1)))).toMatch(
		/Authentication failed|401/
	);
});

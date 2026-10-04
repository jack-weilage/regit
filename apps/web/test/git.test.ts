import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { startGitServer } from '../../forge/test/git-process.ts';
import type GitWorker from './git-worker.ts';

let dir: string;
let backend: Awaited<ReturnType<typeof startGitServer>>;
let server: ReturnType<typeof createTestHarness>;
let worker: ReturnType<typeof server.getWorker<Env, { default: typeof GitWorker }>>;
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
				configPath: './test/git.wrangler.jsonc',
				bindingOverrides: { ARTIFACTS: 'fake-git-artifacts' }
			},
			{
				config: {
					name: 'fake-git-artifacts',
					main: './test/fake-git-artifacts.ts',
					compatibility_date: '2026-10-01',
					vars: { GIT_REMOTE: `http://127.0.0.1:${backend.port}` }
				}
			}
		]
	});
	worker = server.getWorker<Env, { default: typeof GitWorker }>();
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

test('clones with a read token and pushes with a write token, through Artifacts', async () => {
	const tokens = await worker.getExport();
	const reader = await tokens.createToken({
		repo: 'demo',
		scope: 'read',
		days: 30,
		createdBy: 'sam@regit.dev'
	});
	const writer = await tokens.createToken({
		repo: 'demo',
		scope: 'write',
		days: 30,
		createdBy: 'sam@regit.dev'
	});
	expect(reader.secret).toMatch(/^regit_[0-9a-f]{48}$/);

	const clone = join(dir, 'clone');
	await git(dir, 'clone', '--quiet', remote(reader.secret), clone);
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
	expect(await fails(clone, 'push', remote(reader.secret), 'main')).toContain(
		"This token can't push to demo"
	);

	await git(clone, 'push', '--quiet', remote(writer.secret), 'main');
	expect(await git(join(dir, 'demo.git'), 'log', '-1', '--format=%s', 'main')).toBe('Edit');
	expect((await backend.requests()).map((headers) => headers.authorization)).toContain(
		'Bearer artifact-write'
	);
	expect(
		(await tokens.listTokens('demo', 'sam@regit.dev')).map((token) => token.lastUsedAt)
	).not.toContain(null);
});

test('refuses missing, foreign and expired tokens, and lists and revokes tokens', async () => {
	const tokens = await worker.getExport();
	expect((await fetch(new URL('/demo.git/info/refs?service=git-upload-pack', base))).status).toBe(
		401
	);
	const other = await tokens.createToken({
		repo: 'other',
		scope: 'write',
		days: 30,
		createdBy: 'sam@regit.dev'
	});
	expect(await fails(dir, 'ls-remote', remote(other.secret))).toContain(
		"This token doesn't grant access to demo"
	);
	const expired = await tokens.createToken({
		repo: 'demo',
		scope: 'read',
		days: -1,
		createdBy: 'sam@regit.dev'
	});
	expect(await fails(dir, 'ls-remote', remote(expired.secret))).toMatch(
		/Authentication failed|401/
	);

	const mine = await tokens.listTokens('demo', 'sam@regit.dev');
	expect(mine.map(({ id, scope }) => ({ id, scope }))).toEqual([{ id: expired.id, scope: 'read' }]);
	expect(mine[0]).not.toHaveProperty('hash');
	expect(await tokens.listTokens('demo', 'lin@regit.dev')).toEqual([]);
	await tokens.revokeToken(expired.id, 'sam@regit.dev');
	expect(await tokens.listTokens('demo', 'sam@regit.dev')).toEqual([]);
});

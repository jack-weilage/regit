import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type { GatewayRequest } from '@regit/agent';
import type Forge from '../src/index.ts';
import type FakeModels from './fake-models.ts';
import { startGitServer } from './git-process.ts';

const dir = await mkdtemp(join(tmpdir(), 'regit-forge-'));
const git = await startGitServer(dir);

const server = createTestHarness({
	workers: [
		{
			configPath: './wrangler.jsonc',
			bindingOverrides: { MODELS: 'fake-models', ARTIFACTS: 'fake-artifacts' }
		},
		{
			config: {
				name: 'fake-models',
				main: './test/fake-models.ts',
				compatibility_date: '2026-10-01'
			}
		},
		{
			config: {
				name: 'fake-artifacts',
				main: './test/fake-artifacts.ts',
				compatibility_date: '2026-10-01',
				vars: { GIT_REMOTE: `http://host.docker.internal:${git.port}` }
			}
		}
	]
});
const worker = server.getWorker<Env, { default: typeof Forge }>();
const models = server.getWorker<unknown, { default: typeof FakeModels }>('fake-models');

async function script(replies: object[][]) {
	await (await models.getExport()).script(replies);
}

async function modelRequests() {
	return JSON.parse(await (await models.getExport()).requests()) as GatewayRequest[];
}

function sh(cwd: string, ...args: string[]) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

async function seed(name: string, files: Record<string, string>) {
	const work = join(dir, `${name}-work`);
	sh(dir, 'init', '--quiet', '--initial-branch', 'main', work);
	await commit(work, files, 'init');
	sh(dir, 'clone', '--quiet', '--bare', work, `${name}.git`);
	return work;
}

async function commit(work: string, files: Record<string, string>, message: string) {
	for (const [path, content] of Object.entries(files)) await writeFile(join(work, path), content);
	sh(work, 'add', '.');
	sh(
		work,
		'-c',
		'user.name=Sam',
		'-c',
		'user.email=sam@example.com',
		'commit',
		'--quiet',
		'-m',
		message
	);
}

async function settled(api: Awaited<ReturnType<typeof worker.getExport>>, thread: string) {
	for (let i = 0; i < 300; i++) {
		const snapshot = await api.attempt(thread);
		if (snapshot && !['queued', 'running'].includes(snapshot.status)) return snapshot;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error('The attempt did not settle');
}

beforeAll(() => server.listen());
beforeEach(() => worker.applyD1Migrations('DB'));
afterEach(() => server.reset());
afterAll(async () => {
	await server.close();
	git.close();
	await rm(dir, { recursive: true, force: true });
});

test('creates repositories', async () => {
	const api = await worker.getExport();
	expect(await api.createRepo({ name: 'fresh', createdBy: 'sam@regit.dev' })).toEqual({
		name: 'fresh',
		remote: `http://host.docker.internal:${git.port}/fresh.git`,
		defaultBranch: 'main'
	});
	const env = await worker.getEnv();
	expect(await env.DB.prepare('SELECT name, source, created_by FROM repos').all()).toMatchObject({
		results: [{ name: 'fresh', source: null, created_by: 'sam@regit.dev' }]
	});
	await expect(
		Promise.resolve().then(() => api.createRepo({ name: 'fresh', createdBy: 'lin@regit.dev' }))
	).rejects.toThrow('fresh already exists.');
	await expect(
		Promise.resolve().then(() => api.createRepo({ name: 'no/slashes', createdBy: 'sam@regit.dev' }))
	).rejects.toThrow('may only use letters');
	await expect(
		Promise.resolve().then(() =>
			api.createRepo({ name: 'looks--like-a-fork', createdBy: 'sam@regit.dev' })
		)
	).rejects.toThrow('without a double hyphen');
});

test('runs the agent on a fork of the repository, checkpointing its work', async () => {
	await seed('greeting', { 'greeting.ts': "export const greeting = 'hello';\n" });
	await script([
		[
			{ type: 'response.output_text.delta', delta: 'Say hi instead' },
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'call_1',
					name: 'edit_file',
					arguments: JSON.stringify({ path: 'greeting.ts', old_string: 'hello', new_string: 'hi' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Changed the greeting to hi.' }]
	]);
	const api = await worker.getExport();
	await api.startAttempt('thread-1', {
		task: 'Make the greeting say hi',
		mode: 'small',
		repo: 'greeting'
	});

	const snapshot = await settled(api, 'thread-1');
	expect(snapshot).toMatchObject({ status: 'finished', error: null });
	expect(snapshot.steps).toHaveLength(2);

	const fork = join(dir, 'greeting--thread-1.git');
	const sha = snapshot.steps[0]!.checkpoint;
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(sh(fork, 'rev-parse', 'main')).toBe(sha);
	expect(sh(fork, 'show', 'main:greeting.ts')).toBe("export const greeting = 'hi';");
	expect(sh(fork, 'log', '-1', '--format=%an %s', 'main')).toBe('ReGit Say hi instead');
	expect(sh(join(dir, 'greeting.git'), 'show', 'main:greeting.ts')).toBe(
		"export const greeting = 'hello';"
	);
	expect((await git.requests()).some((headers) => headers.authorization)).toBe(false);

	const [first, second] = await modelRequests();
	expect(first).toMatchObject({
		provider: 'openai',
		endpoint: 'responses',
		headers: { 'cf-aig-metadata': { thread: 'thread-1', mode: 'small', task: 'code' } },
		query: { model: 'gpt-6-luna' }
	});
	expect((second!.query as { input: unknown[] }).input.at(-1)).toMatchObject({
		type: 'function_call_output',
		call_id: 'call_1',
		output: [{ type: 'input_text', text: 'Edited greeting.ts' }]
	});
});

test('fails the attempt when the model fails', async () => {
	await seed('failing', { 'README.md': '# Failing\n' });
	await script([
		[
			{
				type: 'response.failed',
				response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
			}
		]
	]);
	const api = await worker.getExport();
	await api.startAttempt('thread-2', { task: 'Anything', mode: 'medium', repo: 'failing' });

	expect(await settled(api, 'thread-2')).toMatchObject({
		status: 'failed',
		error: 'No credits',
		steps: []
	});
});

test('snapshots the toolchain, restores it, and refreshes it when the tools change', async () => {
	const work = await seed('toolchain', { 'README.md': '# Toolchain\n' });
	await script([
		[{ type: 'response.output_text.delta', delta: 'Nothing to do.' }],
		[{ type: 'response.output_text.delta', delta: 'Still nothing.' }],
		[{ type: 'response.output_text.delta', delta: 'All set.' }]
	]);
	const api = await worker.getExport();
	const env = await worker.getEnv();
	const recorded = () =>
		env.DB.prepare('SELECT snapshot_id AS id, key FROM toolchain_snapshots WHERE repo = ?')
			.bind('toolchain')
			.first<{ id: string; key: string }>();

	await api.startAttempt('thread-3', { task: 'Look around', mode: 'small', repo: 'toolchain' });
	expect(await settled(api, 'thread-3')).toMatchObject({
		status: 'finished',
		toolchain: { tools: { jq: [expect.any(String)] }, restored: false }
	});
	const first = await recorded();
	expect(first).toMatchObject({ id: expect.any(String), key: expect.any(String) });

	await api.startAttempt('thread-4', { task: 'Look again', mode: 'small', repo: 'toolchain' });
	expect(await settled(api, 'thread-4')).toMatchObject({
		status: 'finished',
		toolchain: { restored: true }
	});
	expect(await recorded()).toEqual(first);

	const pinned = 'path:/opt/mise/installs/jq/1.8.2';
	await commit(work, { '.tool-versions': `jq ${pinned}\n` }, 'Pin jq');
	sh(work, 'push', '--quiet', join(dir, 'toolchain.git'), 'main');

	await api.startAttempt('thread-5', { task: 'Look once more', mode: 'small', repo: 'toolchain' });
	const third = await settled(api, 'thread-5');
	expect(third.error).toBeNull();
	expect(third).toMatchObject({
		status: 'finished',
		toolchain: { tools: { jq: [pinned] }, restored: true }
	});
	const refreshed = await recorded();
	expect(refreshed!.key).not.toBe(first!.key);
	expect(refreshed!.id).not.toBe(first!.id);
});

test('coordinates a thread from conversation to a finished attempt, live', async () => {
	await seed('notes', { 'notes.md': 'Some notes\n' });
	const propose = (headline: string) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: 'propose',
				name: 'propose_intent',
				arguments: JSON.stringify({
					headline,
					purpose: 'Readers need a title.',
					doneWhen: ['notes.md starts with a title']
				})
			}
		}
	];
	await script([
		propose('docs: tidy the notes'),
		propose('docs(notes): add a title'),
		[
			{ type: 'response.output_text.delta', delta: 'Adding the title' },
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'call_1',
					name: 'write_file',
					arguments: JSON.stringify({ path: 'notes.md', content: '# Notes\n\nSome notes\n' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);

	const { url } = await server.listen();
	const live: { type: string; entry?: { type: string } }[] = [];
	const socket = new WebSocket(new URL('/repos/notes/live', url.href.replace(/^http/, 'ws')).href);
	socket.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));
	await new Promise((resolve) => socket.addEventListener('open', resolve, { once: true }));

	const api = await worker.getExport();
	const sam = { name: 'Sam', kind: 'person' as const };
	const opened = await api.openThread('notes', {
		author: sam,
		text: 'The notes need a title.',
		mode: 'small'
	});
	expect(opened).toMatchObject({ status: 'draft', headline: 'docs: tidy the notes' });

	await api.reply('notes', opened.id, { author: sam, text: 'Call it Notes.' });
	await api.startThread('notes', opened.id);

	let detail = await api.thread('notes', opened.id);
	for (let i = 0; i < 300 && detail?.summary.status === 'running'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await api.thread('notes', opened.id);
	}
	socket.close();

	expect(detail!.summary).toMatchObject({
		status: 'needs-you',
		headline: 'docs(notes): add a title'
	});
	expect(
		detail!.entries.map((entry) =>
			entry.type === 'message'
				? `${entry.author.name}: ${entry.text}`
				: entry.type === 'event'
					? entry.text.replace(/[0-9a-f]{7}$/, 'sha')
					: `intent ${entry.intent.headline}`
		)
	).toEqual([
		'Sam: The notes need a title.',
		'intent docs: tidy the notes',
		'Sam: Call it Notes.',
		'intent docs(notes): add a title',
		'Started the attempt',
		'ReGit: Adding the title',
		'Checkpoint sha',
		'ReGit: Added the title.',
		'The attempt finished'
	]);
	expect(live.filter((message) => message.type === 'entry')).toHaveLength(detail!.entries.length);
	expect(await api.threads('notes')).toMatchObject([{ id: opened.id, status: 'needs-you' }]);
	expect(sh(join(dir, `notes--${opened.id}.git`), 'show', 'main:notes.md')).toBe(
		'# Notes\n\nSome notes'
	);

	const requests = await modelRequests();
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual(['intent', 'intent', 'code', 'code']);
});

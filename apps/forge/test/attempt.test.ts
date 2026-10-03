import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type { GatewayRequest } from '@regit/agent';
import type { AttemptInput } from '../src/attempt-sandbox.ts';
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
const worker = server.getWorker<Env>();
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

function start(thread: string, input: AttemptInput) {
	return worker.getEnv().then((env) => env.ATTEMPTS.getByName(thread).start(input));
}

async function settled(thread: string) {
	const env = await worker.getEnv();
	for (let i = 0; i < 300; i++) {
		const snapshot = await env.ATTEMPTS.getByName(thread).snapshot();
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
	await start('thread-1', {
		task: 'Make the greeting say hi',
		mode: 'small',
		repo: 'greeting'
	});

	const snapshot = await settled('thread-1');
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
	await start('thread-2', { task: 'Anything', mode: 'medium', repo: 'failing' });

	expect(await settled('thread-2')).toMatchObject({
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
	const env = await worker.getEnv();
	const recorded = () =>
		env.DB.prepare('SELECT snapshot_id AS id, key FROM toolchain_snapshots WHERE repo = ?')
			.bind('toolchain')
			.first<{ id: string; key: string }>();

	await start('thread-3', { task: 'Look around', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-3')).toMatchObject({
		status: 'finished',
		toolchain: { tools: { jq: [expect.any(String)] }, restored: false }
	});
	const first = await recorded();
	expect(first).toMatchObject({ id: expect.any(String), key: expect.any(String) });

	await start('thread-4', { task: 'Look again', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-4')).toMatchObject({
		status: 'finished',
		toolchain: { restored: true }
	});
	expect(await recorded()).toEqual(first);

	const pinned = 'path:/opt/mise/installs/jq/1.8.2';
	await commit(work, { '.tool-versions': `jq ${pinned}\n` }, 'Pin jq');
	sh(work, 'push', '--quiet', join(dir, 'toolchain.git'), 'main');

	await start('thread-5', { task: 'Look once more', mode: 'small', repo: 'toolchain' });
	const third = await settled('thread-5');
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

	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('notes');
	const live: { type: string; entry?: { type: string } }[] = [];
	const { webSocket: socket } = await repo.fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	socket!.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));

	const sam = { name: 'Sam', kind: 'person' as const };
	const opened = await repo.openThread({
		author: sam,
		text: 'The notes need a title.',
		mode: 'small'
	});
	expect(opened).toMatchObject({ status: 'draft', headline: 'docs: tidy the notes' });

	await repo.reply(opened.id, { author: sam, text: 'Call it Notes.' });
	await repo.start(opened.id);

	let detail = await repo.thread(opened.id);
	for (let i = 0; i < 300 && detail?.summary.status === 'running'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(opened.id);
	}
	socket!.close();

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
	expect(await repo.threads()).toMatchObject([{ id: opened.id, status: 'needs-you' }]);
	expect(sh(join(dir, `notes--${opened.id}.git`), 'show', 'main:notes.md')).toBe(
		'# Notes\n\nSome notes'
	);

	const requests = await modelRequests();
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual(['intent', 'intent', 'code', 'code']);
});

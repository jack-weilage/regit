import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type { GatewayRequest } from '@regit/agent';
import type Forge from '../src/index.ts';
import type FakeModels from './fake-models.ts';
import { serveGit } from './git-server.ts';

const server = createTestHarness({
	workers: [
		{ configPath: './wrangler.jsonc', bindingOverrides: { MODELS: 'fake-models' } },
		{
			config: {
				name: 'fake-models',
				main: './test/fake-models.ts',
				compatibility_date: '2026-10-01'
			}
		}
	]
});
const worker = server.getWorker<Env, { default: typeof Forge }>();
const models = server.getWorker<unknown, { default: typeof FakeModels }>('fake-models');

let dir: string;
let git: Awaited<ReturnType<typeof serveGit>>;

async function script(replies: object[][]) {
	await (await models.getExport()).script(replies);
}

async function modelRequests() {
	return JSON.parse(await (await models.getExport()).requests()) as GatewayRequest[];
}

function sh(cwd: string, ...args: string[]) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
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
afterAll(() => server.close());

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'regit-forge-'));
	const seed = join(dir, 'seed');
	sh(dir, 'init', '--initial-branch', 'main', seed);
	await writeFile(join(seed, 'greeting.ts'), "export const greeting = 'hello';\n");
	sh(seed, 'add', '.');
	sh(seed, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', 'commit', '-m', 'init');
	sh(dir, 'clone', '--bare', seed, 'repo.git');
	git = await serveGit(dir);
});

afterEach(async () => {
	await git.close();
	await server.reset();
	await rm(dir, { recursive: true, force: true });
});

test('runs the agent in a container, checkpointing its work to the fork', async () => {
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
		repo: {
			remote: `http://host.docker.internal:${git.port}/repo.git`,
			token: 'artifact-token',
			branch: 'main'
		}
	});

	const snapshot = await settled(api, 'thread-1');
	expect(snapshot).toMatchObject({ status: 'finished', error: null });
	expect(snapshot.steps).toHaveLength(2);

	const sha = snapshot.steps[0]!.checkpoint;
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(sh(join(dir, 'repo.git'), 'rev-parse', 'main')).toBe(sha);
	expect(sh(join(dir, 'repo.git'), 'show', 'main:greeting.ts')).toBe(
		"export const greeting = 'hi';"
	);
	expect(sh(join(dir, 'repo.git'), 'log', '-1', '--format=%an %s', 'main')).toBe(
		'ReGit Say hi instead'
	);
	expect(git.requests).not.toHaveLength(0);
	expect(git.requests.every((headers) => headers.authorization === 'Bearer artifact-token')).toBe(
		true
	);

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
	await script([
		[
			{
				type: 'response.failed',
				response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
			}
		]
	]);
	const api = await worker.getExport();
	await api.startAttempt('thread-2', {
		task: 'Anything',
		mode: 'medium',
		repo: {
			remote: `http://host.docker.internal:${git.port}/repo.git`,
			token: 'artifact-token',
			branch: 'main'
		}
	});

	expect(await settled(api, 'thread-2')).toMatchObject({
		status: 'failed',
		error: 'No credits',
		steps: []
	});
});

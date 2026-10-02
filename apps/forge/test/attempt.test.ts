import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type Forge from '../src/index.ts';
import { serveGit } from './git-server.ts';

const server = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
const worker = server.getWorker<Env, { default: typeof Forge }>();
const tokens = { accessToken: 'access-1', refreshToken: 'refresh-1', accountId: 'account' };

let dir: string;
let git: Awaited<ReturnType<typeof serveGit>>;
let modelRequests: any[];

function eventStream(events: object[]) {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

function fakeModel(replies: object[][]) {
	const realFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		if (!request.url.startsWith('https://chatgpt.com/')) return realFetch(input, init);
		modelRequests.push({
			headers: Object.fromEntries(request.headers),
			body: await request.json()
		});
		const reply = replies.shift();
		if (!reply) throw new Error('The fake model ran out of replies');
		return eventStream([
			...reply,
			{
				type: 'response.completed',
				response: {
					usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }
				}
			}
		]);
	});
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
	modelRequests = [];
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
	vi.restoreAllMocks();
	await git.close();
	await server.reset();
	await rm(dir, { recursive: true, force: true });
});

test('runs the agent in a container, checkpointing its work to the fork', async () => {
	fakeModel([
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
	await api.connectChatGPT(tokens);
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

	expect(modelRequests[0].headers).toMatchObject({
		authorization: 'Bearer access-1',
		'chatgpt-account-id': 'account'
	});
	expect(modelRequests[1].body.input.at(-1)).toEqual({
		type: 'function_call_output',
		call_id: 'call_1',
		output: 'Edited greeting.ts'
	});
});

test('fails the attempt when ChatGPT is not connected', async () => {
	const api = await worker.getExport();
	await api.startAttempt('thread-2', {
		task: 'Anything',
		mode: 'small',
		repo: {
			remote: `http://host.docker.internal:${git.port}/repo.git`,
			token: 'artifact-token',
			branch: 'main'
		}
	});

	expect(await settled(api, 'thread-2')).toMatchObject({
		status: 'failed',
		error: expect.stringContaining('ChatGPT is not connected')
	});
});

test('persists tokens when ChatGPT is connected', async () => {
	const api = await worker.getExport();
	await api.connectChatGPT(tokens);

	const storage = await worker.getDurableObjectStorage('CHATGPT', { name: 'default' });
	const [row] = await storage.exec<{ value: string }>('SELECT value FROM tokens');
	expect(JSON.parse(row!.value)).toEqual(tokens);
});

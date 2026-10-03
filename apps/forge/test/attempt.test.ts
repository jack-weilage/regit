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

function submitReview(verdict: string, states: string[]) {
	return [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: 'review',
				name: 'submit_review',
				arguments: JSON.stringify({
					checks: states.map((state) => ({ state, evidence: 'Checked notes.md' })),
					findings: verdict === 'fail' ? ['The title is missing.'] : [],
					verdict
				})
			}
		}
	];
}

async function settled(thread: string) {
	const env = await worker.getEnv();
	for (let i = 0; i < 600; i++) {
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

test('records a failed reply in the thread', async () => {
	await seed('drafts', { 'README.md': '# Drafts\n' });
	await script([
		[
			{
				type: 'response.failed',
				response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
			}
		]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('drafts');
	const opened = await repo.openThread({
		repo: 'drafts',
		author: { name: 'Sam', kind: 'person' },
		text: 'Tidy things up.',
		mode: 'small'
	});

	let entries = (await repo.thread(opened.id))!.entries;
	for (let i = 0; i < 100 && entries.length < 2; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		entries = (await repo.thread(opened.id))!.entries;
	}
	expect(entries.at(-1)).toMatchObject({ type: 'event', text: "Couldn't reply: No credits" });
});

test('discards, reopens, deletes, restores and purges a thread', async () => {
	const offline = [{ type: 'response.failed', response: { error: { message: 'Offline' } } }];
	await script([offline, offline]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('lifecycle');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Try something.',
		mode: 'small'
	});

	await repo.discard(id, sam);
	expect((await repo.thread(id))!.summary.status).toBe('discarded');
	await repo.reopen(id, sam);
	const reopened = await repo.thread(id);
	expect(reopened!.summary.status).toBe('draft');
	expect(reopened!.entries.map((entry) => entry.type === 'event' && entry.text)).toEqual(
		expect.arrayContaining(['Discarded by Sam', 'Reopened by Sam'])
	);

	await repo.delete(id, sam);
	expect(await repo.threads()).toEqual([]);
	expect(await repo.thread(id)).toMatchObject({
		summary: { deleted: { by: 'Sam' } },
		entries: []
	});
	await expect(
		Promise.resolve().then(() => repo.reply(id, { author: sam, text: 'Hello?' }))
	).rejects.toThrow();

	await repo.restore(id);
	expect(await repo.threads()).toMatchObject([{ id, deleted: null }]);

	await repo.delete(id, sam);
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'lifecycle' });
	await sql.exec('UPDATE threads SET deleted_at = deleted_at - ? WHERE id = ?', 8 * 86_400_000, id);
	const later = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Another try.',
		mode: 'small'
	});
	await repo.delete(later.id, sam);

	for (let i = 0; i < 50 && (await repo.thread(id)); i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await repo.thread(id)).toBeNull();
	expect(await repo.thread(later.id)).toMatchObject({ summary: { deleted: { by: 'Sam' } } });
});

test('coordinates a thread from conversation to a finished attempt, live', async () => {
	await seed('notes', { 'notes.md': 'Some notes\n' });
	const propose = (name: string, headline: string) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: name,
				name,
				arguments: JSON.stringify({
					headline,
					purpose: 'Readers need a title.',
					doneWhen: ['notes.md starts with a title']
				})
			}
		}
	];
	await script([
		propose('propose_intent', 'docs: tidy the notes'),
		[{ type: 'response.output_text.delta', delta: 'Proposed a tidy-up.' }],
		propose('update_intent', 'docs(notes): add a title'),
		[{ type: 'response.output_text.delta', delta: 'Updated it.' }],
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
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		submitReview('pass', ['met'])
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
		repo: 'notes',
		author: sam,
		text: 'The notes need a title.',
		mode: 'small'
	});
	expect(opened).toMatchObject({ status: 'draft', headline: 'The notes need a title.' });
	const drafted = async (count: number) => {
		for (let i = 0; i < 100; i++) {
			const detail = await repo.thread(opened.id);
			const intents = detail!.entries.filter((entry) => entry.type === 'intent');
			if (intents.length === count) return detail!;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`The thread never had ${count} intents`);
	};
	expect((await drafted(1)).summary.headline).toBe('docs: tidy the notes');

	await repo.reply(opened.id, { author: sam, text: 'Call it Notes.' });
	await drafted(2);
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(opened.id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Updated it.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await repo.start(opened.id);

	let detail = await repo.thread(opened.id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
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
					: entry.type === 'review'
						? `review ${entry.verdict}`
						: `intent ${entry.intent.headline}`
		)
	).toEqual([
		'Sam: The notes need a title.',
		'intent docs: tidy the notes',
		'ReGit: Proposed a tidy-up.',
		'Sam: Call it Notes.',
		'intent docs(notes): add a title',
		'ReGit: Updated it.',
		'Started the attempt',
		'ReGit: Adding the title',
		'Checkpoint sha',
		'ReGit: Added the title.',
		'review pass',
		'The attempt finished'
	]);
	expect(live.filter((message) => message.type === 'entry')).toHaveLength(detail!.entries.length);
	const requests = await modelRequests();
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual([
		'conversation',
		'conversation',
		'conversation',
		'conversation',
		'code',
		'code',
		'review'
	]);
	const tools = (request: (typeof requests)[number]) =>
		(request.query as { tools: { name: string }[] }).tools.map((tool) => tool.name);
	expect(tools(requests[0]!)).toEqual([
		'read_file',
		'find_files',
		'search',
		'run',
		'propose_intent',
		'update_intent'
	]);
	expect(tools(requests[4]!)).toContain('write_file');
	const call = (50 * 0.1 + 10 * 0.5) / 1_000_000;
	expect(detail!.usage).toEqual({
		rows: [
			{
				task: 'conversation',
				model: 'gpt-6-luna',
				tokens: 240,
				cost: expect.closeTo(4 * call, 10)
			},
			{ task: 'attempt', model: 'gpt-6-luna', tokens: 120, cost: expect.closeTo(2 * call, 10) },
			{
				task: 'review',
				model: 'gpt-6.1-sol',
				tokens: 60,
				cost: expect.closeTo((50 * 2 + 10 * 10) / 1_000_000, 10)
			}
		],
		context: { used: 60, limit: 1_050_000 }
	});
	expect(await repo.threads()).toMatchObject([{ id: opened.id, status: 'needs-you' }]);
	expect(sh(join(dir, `notes--${opened.id}.git`), 'show', 'main:notes.md')).toBe(
		'# Notes\n\nSome notes'
	);
});

test('steers a running attempt with messages read after the current step', async () => {
	await seed('steer', { 'notes.md': 'Some notes\n' });
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'propose',
					name: 'propose_intent',
					arguments: JSON.stringify({
						headline: 'docs: add a title',
						purpose: 'Readers need a title.',
						doneWhen: ['notes.md starts with a title']
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }],
		[
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
		[{ type: 'response.output_text.delta', delta: 'Kept it short.' }],
		submitReview('pass', ['met'])
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('steer');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'steer',
		author: sam,
		text: 'Add a title.',
		mode: 'small'
	});
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Proposed.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	await repo.start(id);
	await repo.reply(id, { author: sam, text: 'Keep the title short.' });
	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(id);
	}

	expect(detail!.summary.status).toBe('needs-you');
	expect(detail!.entries.find((entry) => entry.type === 'message' && entry.steering)).toMatchObject(
		{ text: 'Keep the title short.', steering: { read: true } }
	);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding.at(-1)!.query)).toContain('Sam: Keep the title short.');
});

test('sends work that fails review back to the agent, then finishes when it passes', async () => {
	await seed('reviewed', { 'notes.md': 'Some notes\n' });
	await script([
		[{ type: 'response.output_text.delta', delta: 'Sure.' }],
		[{ type: 'response.output_text.delta', delta: 'Done, I think.' }],
		submitReview('fail', ['unmet']),
		[
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
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		submitReview('pass', ['met'])
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('reviewed');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'reviewed',
		author: sam,
		text: 'Add a title.',
		mode: 'small'
	});
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Sure.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await repo.intentProposed(id, {
		headline: 'docs: add a title',
		purpose: 'Readers need a title.',
		doneWhen: ['notes.md starts with a title']
	});
	await repo.start(id);

	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(id);
	}

	expect(detail!.summary.status).toBe('needs-you');
	expect(
		detail!.entries.flatMap((entry) => (entry.type === 'review' ? [entry] : []))
	).toMatchObject([
		{ round: 1, verdict: 'fail', checks: ['unmet'] },
		{ round: 2, verdict: 'pass', checks: ['met'] }
	]);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding[1]!.query)).toContain('A reviewer checked your work');
	expect(JSON.stringify(coding[1]!.query)).toContain('The title is missing.');
	expect(
		detail!.entries.some((entry) => entry.type === 'message' && entry.text.includes('reviewer'))
	).toBe(false);
});

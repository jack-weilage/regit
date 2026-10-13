import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll } from 'vitest';
import type { GatewayRequest, JevRequest, JevResponse } from '@regit/agent';
import type { Machine, Mode, ThreadDetail } from '@regit/core';
import type FakeModels from './fake-models.ts';
import { startGitServer } from './git-process.ts';
import { startSandbox } from './sandbox-process.ts';

export async function setup({ containers = false } = {}) {
	const dir = await mkdtemp(join(tmpdir(), 'regit-forge-'));
	const git = await startGitServer(dir);
	const sandbox = containers
		? null
		: await startSandbox(await mkdtemp(join(tmpdir(), 'regit-sandbox-')));
	const host = containers ? 'host.docker.internal' : '127.0.0.1';

	const server = createTestHarness({
		workers: [
			{
				configPath: containers ? './wrangler.jsonc' : './test/wrangler.jsonc',
				bindingOverrides: { MODELS: 'fake-models', ARTIFACTS: 'fake-artifacts' },
				...(sandbox && { vars: { SANDBOX_URL: `http://127.0.0.1:${sandbox.port}` } })
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
					vars: { GIT_REMOTE: `http://${host}:${git.port}` }
				}
			}
		]
	});
	const worker = server.getWorker<Env>();
	const models = server.getWorker<unknown, { default: typeof FakeModels }>('fake-models');

	async function script(repo: string, replies: object[][]) {
		await (await models.getExport()).script(repo, replies);
	}

	async function scriptDecisions(repo: string, next: JevResponse[]) {
		await (await models.getExport()).scriptDecisions(repo, next);
	}

	async function decisionRequests(repo: string) {
		return JSON.parse(await (await models.getExport()).decisionRequests(repo)) as JevRequest[];
	}

	async function modelRequests(repo: string) {
		return JSON.parse(await (await models.getExport()).requests(repo)) as GatewayRequest[];
	}

	function sh(cwd: string, ...args: string[]) {
		return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
	}

	async function seed(name: string, files: Record<string, string>, branch = 'main') {
		const work = join(dir, `${name}-work`);
		sh(dir, 'init', '--quiet', '--initial-branch', branch, work);
		await commit(work, files, 'init');
		sh(dir, 'clone', '--quiet', '--bare', work, `${name}.git`);
		return work;
	}

	async function commit(work: string, files: Record<string, string>, message: string) {
		for (const [path, content] of Object.entries(files)) {
			await mkdir(dirname(join(work, path)), { recursive: true });
			await writeFile(join(work, path), content);
		}
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

	async function start(
		thread: string,
		{ task, ...input }: { task: string; mode: Mode; repo: string; machine?: Machine }
	) {
		const env = await worker.getEnv();
		await env.ATTEMPTS.getByName(thread).converse({
			...input,
			author: 'Sam',
			text: task,
			entry: ''
		});
	}

	async function settled(thread: string, timeoutMs = 120_000) {
		const env = await worker.getEnv();
		let snapshot = null;
		for (let i = 0; i < timeoutMs / 200; i++) {
			snapshot = await env.ATTEMPTS.getByName(thread).snapshot();
			if (snapshot && !['queued', 'running'].includes(snapshot.status)) return snapshot;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(`The attempt did not settle: ${JSON.stringify(snapshot)}`);
	}

	async function untilRequests(repo: string, thread: string, count: number) {
		for (let i = 0; i < 300; i++) {
			const requests = await modelRequests(repo);
			const matching = requests.filter(
				(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === thread
			);
			if (matching.length >= count) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`Never saw ${count} requests from ${thread}`);
	}

	async function startedThread(
		name: string,
		steps: object[][],
		branch?: string,
		files: Record<string, string> = {}
	) {
		await seed(name, { 'notes.md': 'Some notes\n', ...files }, branch);
		await script(name, steps);
		const env = await worker.getEnv();
		await env.DB.prepare('INSERT INTO repos (name, created_at) VALUES (?, ?)')
			.bind(name, Date.now())
			.run();
		await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
			.bind(name, 'owner', 'owner')
			.run();
		const repo = env.REPOS.getByName(name);
		const sam = { id: 'owner', name: 'Sam', kind: 'person' as const };
		const { id } = await repo.openThread({
			repo: name,
			author: sam,
			text: 'Add a title.',
			mode: 'small',
			machine: 'standard-1'
		});
		return { env, repo, sam, id };
	}

	beforeAll(async () => {
		await server.listen();
		await worker.applyD1Migrations('DB');
	});
	afterAll(async () => {
		await server.close();
		git.close();
		sandbox?.close();
		await rm(dir, { recursive: true, force: true });
	});

	return {
		dir,
		git,
		server,
		worker,
		script,
		modelRequests,
		scriptDecisions,
		decisionRequests,
		sh,
		seed,
		commit,
		start,
		settled,
		untilRequests,
		startedThread
	};
}

export async function untilThread(
	repo: ReturnType<Env['REPOS']['getByName']>,
	id: string,
	check: (detail: ThreadDetail) => boolean
) {
	for (let i = 0; i < 300; i++) {
		const detail = (await repo.thread(id)) as ThreadDetail;
		if (check(detail)) return detail;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const detail = (await repo.thread(id)) as ThreadDetail;
	throw new Error(
		`The thread never got there: ${detail.summary.status} ${JSON.stringify(detail.entries.slice(-4))}`
	);
}

export const sleepCall = [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'sleep',
			name: 'run',
			arguments: JSON.stringify({ command: 'sleep 30' })
		}
	}
];

export const writeNotes = (content: string) => [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'write',
			name: 'run',
			arguments: JSON.stringify({ command: `printf '${content}' > notes.md` })
		}
	}
];

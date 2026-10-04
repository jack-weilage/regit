import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHarness } from 'wrangler';
import { afterAll, beforeAll } from 'vitest';
import type { GatewayRequest, JevRequest, JevResponse } from '@regit/agent';
import type { AttemptInput } from '../src/attempt-sandbox.ts';
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
				configPath: './wrangler.jsonc',
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

	async function script(replies: object[][]) {
		await (await models.getExport()).script(replies);
	}

	async function scriptDecisions(next: JevResponse[]) {
		await (await models.getExport()).scriptDecisions(next);
	}

	async function decisionRequests() {
		return JSON.parse(await (await models.getExport()).decisionRequests()) as JevRequest[];
	}

	async function modelRequests() {
		return JSON.parse(await (await models.getExport()).requests()) as GatewayRequest[];
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
		let snapshot = null;
		for (let i = 0; i < 600; i++) {
			snapshot = await env.ATTEMPTS.getByName(thread).snapshot();
			if (snapshot && !['queued', 'running'].includes(snapshot.status)) return snapshot;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error(`The attempt did not settle: ${JSON.stringify(snapshot)}`);
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
		submitReview,
		settled
	};
}

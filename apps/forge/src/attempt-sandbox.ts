import { DurableObject } from 'cloudflare:workers';
import type { AttemptUpdate } from './repo-coordinator.ts';
import {
	codingInstructions,
	modes,
	openaiModel,
	runAttempt,
	sandboxTools,
	sandboxWorkspace,
	type AgentOutcome,
	type Fetch,
	type Mode,
	type Step,
	type Toolchain,
	type Turn
} from '@regit/agent';

export interface AttemptInput {
	task: string;
	mode: Mode;
	repo: string;
}

export type AttemptStatus = 'queued' | 'running' | 'finished' | 'stopped' | 'failed' | 'cancelled';

export interface AttemptSnapshot {
	status: AttemptStatus;
	error: string | null;
	toolchain: { tools: Toolchain; restored: boolean } | null;
	steps: (Step & { checkpoint: string | null })[];
}

interface Fork {
	name: string;
	remote: string;
	branch: string;
}

interface ToolchainSnapshot {
	id: string;
	key: string;
	image: string;
}

type AttemptRow = {
	task: string;
	mode: Mode;
	repo: string;
	fork: string | null;
	remote: string | null;
	branch: string | null;
	status: AttemptStatus;
	error: string | null;
	toolchain: string | null;
	restored: number | null;
};

type StepRow = {
	turns: string;
	input_tokens: number | null;
	cached_input_tokens: number | null;
	cache_write_tokens: number | null;
	output_tokens: number | null;
	checkpoint: string | null;
};

const author = { name: 'ReGit', email: 'agent@regit.dev' };
const sandboxPort = 8080;
const sliceMs = 10 * 60 * 1000;
const healthTimeoutMs = 5 * 60 * 1000;

const outcomes: Record<AgentOutcome, AttemptStatus> = {
	finished: 'finished',
	'step-limit': 'stopped',
	aborted: 'cancelled'
};

export class AttemptSandbox extends DurableObject<Env> {
	#sql = this.ctx.storage.sql;
	#controller?: AbortController;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS attempt (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				task TEXT NOT NULL,
				mode TEXT NOT NULL,
				repo TEXT NOT NULL,
				fork TEXT,
				remote TEXT,
				branch TEXT,
				status TEXT NOT NULL,
				error TEXT,
				toolchain TEXT,
				restored INTEGER
			);
			CREATE TABLE IF NOT EXISTS steps (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				turns TEXT NOT NULL,
				input_tokens INTEGER,
				cached_input_tokens INTEGER,
				cache_write_tokens INTEGER,
				output_tokens INTEGER,
				checkpoint TEXT
			);
		`);
	}

	async start({ task, mode, repo }: AttemptInput) {
		if (this.#attempt()) throw new Error('This attempt has already started');
		this.#sql.exec(
			`INSERT INTO attempt (id, task, mode, repo, status) VALUES (1, ?, ?, ?, 'queued')`,
			task,
			mode,
			repo
		);
		await this.ctx.storage.setAlarm(Date.now());
	}

	snapshot(): AttemptSnapshot | null {
		const attempt = this.#attempt();
		if (!attempt) return null;
		const steps = this.#sql.exec<StepRow>('SELECT * FROM steps ORDER BY seq').toArray();
		return {
			status: attempt.status,
			error: attempt.error,
			toolchain: attempt.toolchain
				? { tools: JSON.parse(attempt.toolchain) as Toolchain, restored: attempt.restored === 1 }
				: null,
			steps: steps.map((row) => ({
				turns: JSON.parse(row.turns) as Turn[],
				usage:
					row.input_tokens === null
						? undefined
						: {
								inputTokens: row.input_tokens,
								cachedInputTokens: row.cached_input_tokens ?? 0,
								cacheWriteTokens: row.cache_write_tokens ?? 0,
								outputTokens: row.output_tokens ?? 0
							},
				checkpoint: row.checkpoint
			}))
		};
	}

	async cancel() {
		const attempt = this.#attempt();
		if (!attempt || !isActive(attempt.status)) return;
		await this.#finish(attempt, 'cancelled');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
		if (this.ctx.container?.running) await this.ctx.container.destroy();
	}

	override async alarm() {
		const attempt = this.#attempt();
		if (!attempt || !isActive(attempt.status)) return;
		this.#setStatus('running');

		const controller = (this.#controller = new AbortController());
		const deadline = Date.now() + sliceMs;
		try {
			const fork = await this.#fork(attempt);
			const token = await this.#token(fork);
			const fetch = await this.#sandbox(attempt, fork, token);
			const workspace = sandboxWorkspace(fetch);
			const { model, effort } = modes[attempt.mode];
			const run = runAttempt({
				model: openaiModel({
					gateway: { run: (request) => this.env.MODELS.run(request) },
					model,
					effort,
					sessionId: this.ctx.id.toString(),
					metadata: {
						thread: this.ctx.id.name ?? this.ctx.id.toString(),
						mode: attempt.mode,
						task: 'code'
					}
				}),
				tools: sandboxTools(fetch),
				checkpoints: {
					commit: (request) => workspace.commit(request),
					push: (request) => this.#push(fork, token, () => workspace.push(request))
				},
				author,
				push: { ref: fork.branch },
				instructions: codingInstructions,
				history: this.#history(attempt),
				signal: controller.signal
			});

			let next = await run.next();
			while (!next.done) {
				if (next.value.type === 'step') {
					this.#saveStep(next.value);
					await this.#report(attempt, { type: 'step', step: next.value });
					if (Date.now() > deadline) {
						await run.return('aborted');
						await this.ctx.storage.setAlarm(Date.now());
						return;
					}
				}
				next = await run.next();
			}
			if (this.#attempt()?.status === 'running') await this.#finish(attempt, outcomes[next.value]);
		} catch (error) {
			if (this.#attempt()?.status !== 'running') return;
			// TODO: retry transient model and sandbox failures instead of failing the attempt
			await this.#finish(attempt, 'failed', error instanceof Error ? error.message : String(error));
		} finally {
			this.#controller = undefined;
		}
	}

	async #finish(attempt: AttemptRow, status: AttemptStatus, error: string | null = null) {
		this.#setStatus(status, error);
		await this.#report(attempt, { type: 'status', status, error });
	}

	async #report(attempt: AttemptRow, update: AttemptUpdate) {
		try {
			await this.env.REPOS.getByName(attempt.repo).attemptUpdated(this.ctx.id.name!, update);
		} catch (error) {
			console.warn('Could not report the attempt to its repository', error);
		}
	}

	#attempt() {
		return this.#sql.exec<AttemptRow>('SELECT * FROM attempt').toArray()[0];
	}

	#setStatus(status: AttemptStatus, error: string | null = null) {
		this.#sql.exec('UPDATE attempt SET status = ?, error = ?', status, error);
	}

	#history(attempt: AttemptRow): Turn[] {
		const steps = this.#sql
			.exec<{ turns: string }>('SELECT turns FROM steps ORDER BY seq')
			.toArray();
		return [
			{ role: 'user', text: attempt.task },
			...steps.flatMap((row) => JSON.parse(row.turns) as Turn[])
		];
	}

	#saveStep({ turns, usage, checkpoint }: Step & { checkpoint?: string }) {
		this.#sql.exec(
			'INSERT INTO steps (turns, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, checkpoint) VALUES (?, ?, ?, ?, ?, ?)',
			JSON.stringify(turns),
			usage?.inputTokens ?? null,
			usage?.cachedInputTokens ?? null,
			usage?.cacheWriteTokens ?? null,
			usage?.outputTokens ?? null,
			checkpoint ?? null
		);
	}

	async #fork(attempt: AttemptRow): Promise<Fork> {
		if (attempt.fork && attempt.remote && attempt.branch) {
			return { name: attempt.fork, remote: attempt.remote, branch: attempt.branch };
		}
		const name = `${attempt.repo}--${this.ctx.id.name}`;
		using base = await this.env.ARTIFACTS.get(attempt.repo);
		const fork = await base
			.fork(name, { description: attempt.task.slice(0, 200) })
			.catch(async (error) => {
				if ((error as ArtifactsError).code !== 'ALREADY_EXISTS') throw error;
				using existing = await this.env.ARTIFACTS.get(name);
				return existing.info();
			});
		this.#sql.exec(
			'UPDATE attempt SET fork = ?, remote = ?, branch = ?',
			fork.name,
			fork.remote,
			fork.defaultBranch
		);
		return { name: fork.name, remote: fork.remote, branch: fork.defaultBranch };
	}

	async #token(fork: Fork) {
		using repo = await this.env.ARTIFACTS.get(fork.name);
		const { plaintext } = await repo.createToken('write', 60 * 60);
		return plaintext;
	}

	async #allowGit(fork: Fork, token: string, push: boolean) {
		const remote = new URL(fork.remote);
		if (remote.protocol !== 'https:') return;
		const proxy = this.ctx.exports.GitProxy({ props: { remote: fork.remote, token, push } });
		await this.ctx.container!.interceptOutboundHttps(remote.hostname, proxy);
	}

	async #push(fork: Fork, token: string, push: () => Promise<void>) {
		await this.#allowGit(fork, token, true);
		try {
			await push();
		} finally {
			await this.#allowGit(fork, token, false);
		}
	}

	// TODO: size the instance per mode
	async #sandbox(attempt: AttemptRow, fork: Fork, token: string): Promise<Fetch> {
		const container = this.ctx.container!;
		const fetch: Fetch = (url, init) => container.getTcpPort(sandboxPort).fetch(url, init);
		const workspace = sandboxWorkspace(fetch);
		await this.#allowGit(fork, token, false);
		if (container.running) {
			await waitUntilHealthy(fetch);
			return fetch;
		}

		const image = container.images.sandbox!;
		const cached = await this.env.TOOLCHAINS.get<ToolchainSnapshot>(attempt.repo, 'json');
		let restored = cached?.image === image ? cached : null;
		try {
			await this.#start(restored ? { containerSnapshot: { id: restored.id } } : { image }, fetch);
		} catch (error) {
			if (!restored) throw error;
			restored = null;
			await this.env.TOOLCHAINS.delete(attempt.repo);
			await this.#start({ image }, fetch);
		}

		await workspace.clone({ remote: fork.remote, branch: fork.branch });
		const tools = await workspace.toolchain();
		this.#sql.exec(
			'UPDATE attempt SET toolchain = ?, restored = ?',
			JSON.stringify(tools),
			restored ? 1 : 0
		);

		// TODO: if image updates keep making snapshots cold, back up /opt/mise per toolchain key with @cloudflare/sandbox's DirectoryBackup, which restores into newer images
		const key = await digest({ image, tools });
		if (key !== restored?.key) {
			try {
				const snapshot = await container.snapshotContainer({
					name: `toolchain-${key.slice(0, 12)}`
				});
				await this.env.TOOLCHAINS.put(
					attempt.repo,
					JSON.stringify({ id: snapshot.id, key, image })
				);
			} catch (error) {
				console.warn('Could not snapshot the toolchain', error);
			}
		}
		return fetch;
	}

	async #start(source: { image: string } | { containerSnapshot: { id: string } }, fetch: Fetch) {
		const container = this.ctx.container!;
		container.start({ ...source, enableInternet: true, instance: 'standard-1' });
		try {
			await waitUntilHealthy(fetch);
		} catch (error) {
			if (container.running) await container.destroy();
			throw error;
		}
	}
}

async function digest(value: unknown) {
	const bytes = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify(value))
	);
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isActive(status: AttemptStatus) {
	return status === 'queued' || status === 'running';
}

async function waitUntilHealthy(fetch: Fetch) {
	let lastError: unknown;
	const deadline = Date.now() + healthTimeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch('http://sandbox/health', { signal: AbortSignal.timeout(1000) });
			await response.body?.cancel();
			if (response.ok) return;
		} catch (error) {
			lastError = error;
		}
		await scheduler.wait(200);
	}
	const reason =
		lastError instanceof Error ? lastError.message : String(lastError ?? 'no response');
	throw new Error(`The sandbox did not become healthy: ${reason}`, { cause: lastError });
}

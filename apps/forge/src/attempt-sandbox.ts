import { DurableObject } from 'cloudflare:workers';
import {
	chatgptModel,
	codingInstructions,
	modes,
	runAttempt,
	sandboxTools,
	sandboxWorkspace,
	type AgentOutcome,
	type Fetch,
	type Mode,
	type Step,
	type Turn
} from '@regit/agent';

export interface AttemptInput {
	task: string;
	mode: Mode;
	repo: { remote: string; token: string; branch: string };
}

export type AttemptStatus = 'queued' | 'running' | 'finished' | 'stopped' | 'failed' | 'cancelled';

export interface AttemptSnapshot {
	status: AttemptStatus;
	error: string | null;
	steps: (Step & { checkpoint: string | null })[];
}

type AttemptRow = {
	task: string;
	mode: Mode;
	remote: string;
	token: string;
	branch: string;
	status: AttemptStatus;
	error: string | null;
};

type StepRow = {
	turns: string;
	input_tokens: number | null;
	cached_input_tokens: number | null;
	output_tokens: number | null;
	checkpoint: string | null;
};

const author = { name: 'ReGit', email: 'agent@regit.dev' };
const sandboxPort = 8080;
const sliceMs = 10 * 60 * 1000;

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
				remote TEXT NOT NULL,
				token TEXT NOT NULL,
				branch TEXT NOT NULL,
				status TEXT NOT NULL,
				error TEXT
			);
			CREATE TABLE IF NOT EXISTS steps (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				turns TEXT NOT NULL,
				input_tokens INTEGER,
				cached_input_tokens INTEGER,
				output_tokens INTEGER,
				checkpoint TEXT
			);
		`);
	}

	async start({ task, mode, repo }: AttemptInput) {
		if (this.#attempt()) throw new Error('This attempt has already started');
		this.#sql.exec(
			`INSERT INTO attempt (id, task, mode, remote, token, branch, status) VALUES (1, ?, ?, ?, ?, ?, 'queued')`,
			task,
			mode,
			repo.remote,
			repo.token,
			repo.branch
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
			steps: steps.map((row) => ({
				turns: JSON.parse(row.turns) as Turn[],
				usage:
					row.input_tokens === null
						? undefined
						: {
								inputTokens: row.input_tokens,
								cachedInputTokens: row.cached_input_tokens ?? 0,
								outputTokens: row.output_tokens ?? 0
							},
				checkpoint: row.checkpoint
			}))
		};
	}

	async cancel() {
		const attempt = this.#attempt();
		if (!attempt || !isActive(attempt.status)) return;
		this.#setStatus('cancelled');
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
			const fetch = await this.#sandbox(attempt);
			const { model, effort } = modes[attempt.mode];
			// TODO: for the MVP deploy, call models through AI Gateway (env.AI.gateway, BYOK, cf-aig-metadata per thread) instead of the ChatGPT subscription
			const account = this.env.CHATGPT.getByName('default');
			const run = runAttempt({
				model: chatgptModel({
					auth: { tokens: () => account.tokens(), refresh: () => account.refresh() },
					model,
					effort,
					sessionId: this.ctx.id.toString()
				}),
				tools: sandboxTools(fetch),
				checkpoints: sandboxWorkspace(fetch),
				author,
				push: { token: attempt.token, ref: attempt.branch },
				instructions: codingInstructions,
				history: this.#history(attempt),
				signal: controller.signal
			});

			let next = await run.next();
			while (!next.done) {
				if (next.value.type === 'step') {
					this.#saveStep(next.value);
					if (Date.now() > deadline) {
						await run.return('aborted');
						await this.ctx.storage.setAlarm(Date.now());
						return;
					}
				}
				next = await run.next();
			}
			if (this.#attempt()?.status === 'running') this.#setStatus(outcomes[next.value]);
		} catch (error) {
			if (this.#attempt()?.status !== 'running') return;
			// TODO: retry transient model and sandbox failures instead of failing the attempt
			this.#setStatus('failed', error instanceof Error ? error.message : String(error));
		} finally {
			this.#controller = undefined;
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
			'INSERT INTO steps (turns, input_tokens, cached_input_tokens, output_tokens, checkpoint) VALUES (?, ?, ?, ?, ?)',
			JSON.stringify(turns),
			usage?.inputTokens ?? null,
			usage?.cachedInputTokens ?? null,
			usage?.outputTokens ?? null,
			checkpoint ?? null
		);
	}

	// TODO: inject the Artifacts token with interceptOutboundHttps so it never enters the container
	// TODO: size the instance per mode, and snapshot the workspace instead of re-cloning after restarts
	async #sandbox(attempt: AttemptRow): Promise<Fetch> {
		const container = this.ctx.container!;
		if (!container.running) {
			container.start({
				image: container.images.sandbox!,
				enableInternet: true,
				instance: 'standard-1'
			});
		}
		const port = container.getTcpPort(sandboxPort);
		const fetch: Fetch = (url, init) => port.fetch(url, init);
		await waitUntilHealthy(fetch);
		await sandboxWorkspace(fetch).clone({
			remote: attempt.remote,
			token: attempt.token,
			branch: attempt.branch
		});
		return fetch;
	}
}

function isActive(status: AttemptStatus) {
	return status === 'queued' || status === 'running';
}

async function waitUntilHealthy(fetch: Fetch) {
	let lastError: unknown;
	for (let attempt = 0; attempt < 150; attempt++) {
		try {
			const response = await fetch('http://sandbox/health', { signal: AbortSignal.timeout(1000) });
			await response.body?.cancel();
			if (response.ok) return;
		} catch (error) {
			lastError = error;
		}
		await scheduler.wait(200);
	}
	throw new Error('The sandbox did not become healthy', { cause: lastError });
}

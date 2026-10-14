import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { previews, toolchainSnapshots } from '@regit/db';
import { db } from './db.ts';
import { containerRun } from './container-run.ts';
import {
	defaultMachine,
	machines,
	summarize,
	type DiffFile,
	type Revision,
	type Machine,
	type Retry,
	type RetryFailure,
	type StartupStage,
	type AgentActivity,
	type ToolCallRecord,
	idlePhase,
	type ThreadOverlap,
	type ThreadSummary,
	type CheckResult
} from '@regit/core';
import type { AttemptUpdate } from './repo-coordinator.ts';
import {
	askRequest,
	askThreads,
	askThreadsTools,
	askVerdict,
	automationTools,
	checksNotice,
	dueChecks,
	runChecks,
	backoff,
	compactThreshold,
	errorMessage,
	isTransient,
	ModelError,
	modelRetries,
	resumeStep,
	SandboxUnavailableError,
	sleep,
	combineTools,
	mergeSkills,
	browserSkill,
	checksSkill,
	servicesSkill,
	skillTools,
	threadsSkill,
	toolchainsSkill,
	verificationSkill,
	repositoryGuidance,
	withSkills,
	intentTools,
	launchTools,
	modelClient,
	modes,
	openaiModel,
	parseDiff,
	runAttempt,
	sandboxTools,
	sandboxWorkspace,
	searcher,
	StepActivity,
	threadInstructions,
	threadTools,
	type AgentOutcome,
	type Fetch,
	type InflightStep,
	type RetryPolicy,
	type ServiceInfo,
	type Skill,
	type Mode,
	type ModelChoice,
	type Step,
	type ToolExecutor,
	type ToolName,
	type ToolResult,
	type Toolchain,
	type Turn,
	type PlannedCheck
} from '@regit/agent';

export interface ConverseInput {
	repo: string;
	mode: Mode;
	machine?: Machine;
	context?: string;
	author: string;
	text: string;
	entry: string;
	sync?: boolean;
}

export type AttemptStatus =
	'queued' | 'running' | 'interrupted' | 'finished' | 'stopped' | 'failed' | 'cancelled';

export interface AttemptSnapshot {
	status: AttemptStatus;
	machine: Machine;
	error: string | null;
	toolchain: { tools: Toolchain; restored: boolean } | null;
	steps: (Step & { checkpoint: string | null })[];
}

interface Fork {
	name: string;
	remote: string;
	branch: string;
}

interface Target {
	repo: string;
	remote: string;
	branch: string;
}

type AgentRow = {
	mode: Mode;
	repo: string;
	fork: string | null;
	remote: string | null;
	branch: string | null;
	status: AttemptStatus;
	error: string | null;
	toolchain: string | null;
	restored: number | null;
	base: string | null;
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
const idleTimeoutMs = 5 * 60 * 1000;
const snapshotHeadroomBytes = 2e9;
const snapshotRefreshMs = 24 * 60 * 60 * 1000;
const maxStoredChanges = 1_500_000;
const turnRetries: RetryPolicy = { limit: 5, baseMs: 15_000, maxMs: 5 * 60 * 1000 };
const pushRetries: RetryPolicy = { limit: 4, baseMs: 1000, maxMs: 8000 };
const reportRetries: RetryPolicy = { limit: 3, baseMs: 250, maxMs: 2000 };
const mainTokenTtlS = 60 * 60;
const mainTokenRefreshMs = 20 * 60 * 1000;

// The models modes had before threads pinned theirs.
// TODO: drop once threads started before 2026-10-14 have all settled
const unpinned: Record<Mode, ModelChoice> = {
	small: { model: 'gpt-6-luna', effort: 'medium' },
	medium: { model: 'gpt-6.1-sol', effort: 'medium' },
	large: { model: 'gpt-6.1-sol', effort: 'high' }
};

const outcomes: Record<AgentOutcome, AttemptStatus> = {
	finished: 'finished',
	'step-limit': 'stopped',
	aborted: 'cancelled'
};

export class AttemptSandbox extends DurableObject<Env> {
	#sql = this.ctx.storage.sql;
	#controller?: AbortController;
	#activity: AgentWork = idle();
	#published = 0;
	#publishing?: ReturnType<typeof setTimeout>;
	#capturing = false;
	#wakeRetry?: () => void;
	#main?: { remote: string; token: string; expires: number };

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (ctx.container?.running) {
			void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(idleTimeoutMs));
		}
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS agent (
				id INTEGER PRIMARY KEY CHECK (id = 1),
				mode TEXT NOT NULL,
				repo TEXT NOT NULL,
				fork TEXT,
				remote TEXT,
				branch TEXT,
				status TEXT NOT NULL,
				error TEXT,
				toolchain TEXT,
				restored INTEGER,
				base TEXT
			);
			CREATE TABLE IF NOT EXISTS inbox (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				author TEXT NOT NULL,
				text TEXT NOT NULL,
				entry TEXT
			);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS evidence (
				key TEXT PRIMARY KEY,
				at INTEGER NOT NULL
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

	async converse({ repo, mode, machine, context, author, text, entry, sync }: ConverseInput) {
		this.#setMeta('repo', repo);
		if (sync) this.#setMeta('sync', '1');
		if (machine) this.#setMeta('machine', machine);
		if (!this.#agent()) {
			this.#sql.exec(
				`INSERT INTO agent (id, mode, repo, status) VALUES (1, ?, ?, 'finished')`,
				mode,
				repo
			);
			this.#setMeta('model', JSON.stringify(modes[mode]));
			if (context) {
				const seed = `This thread was spun off from another one. What it found:\n\n${context}`;
				this.#saveStep({ turns: [{ role: 'user', text: seed }] });
			}
		}
		this.#sql.exec('UPDATE agent SET mode = ?', mode);
		this.#sql.exec("DELETE FROM meta WHERE key = 'check-rounds'");
		this.#sql.exec('INSERT INTO inbox (author, text, entry) VALUES (?, ?, ?)', author, text, entry);
		if (isActive(this.#agent()!.status)) return;
		this.#setStatus('queued');
		await this.ctx.storage.setAlarm(Date.now());
	}

	async revision(): Promise<Revision | null> {
		const attempt = this.#agent();
		if (!attempt) return null;
		if (isActive(attempt.status) || this.#controller || this.#capturing)
			throw new Error('Stop the agent before capturing a revision');
		if (!attempt.fork || !attempt.branch || !attempt.base) return null;
		this.#capturing = true;
		try {
			const { fetch } = await this.#wake();
			const sha = await this.#head(fetch);
			if (!sha) return null;
			await this.#advanceBase(attempt, fetch);
			return {
				proposal: this.#thread(),
				repository: attempt.fork,
				branch: attempt.branch,
				base: attempt.base,
				sha,
				at: Date.now()
			};
		} finally {
			this.#capturing = false;
		}
	}

	snapshot(): AttemptSnapshot | null {
		const attempt = this.#agent();
		if (!attempt) return null;
		const steps = this.#sql.exec<StepRow>('SELECT * FROM steps ORDER BY seq').toArray();
		return {
			status: attempt.status,
			machine: this.#machine(),
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
		const attempt = this.#agent();
		if (!attempt || !isActive(attempt.status)) return;
		this.#forgetRetries();
		await this.#finish(attempt, 'cancelled');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
		if (this.ctx.container?.running) await this.ctx.container.destroy();
	}

	// A shipped thread's fork is rebased onto the published commit on its next turn; until then, compare that commit.
	forkRef() {
		const attempt = this.#agent();
		if (!attempt?.fork || !attempt.branch) return null;
		const pending = this.#meta('rebase');
		const published = pending ? (JSON.parse(pending) as { sha: string }).sha : undefined;
		return { repository: attempt.fork, branch: attempt.branch, published };
	}

	published(publication: { sha: string; branch: string; from: string }) {
		this.#setMeta('rebase', JSON.stringify(publication));
		this.#setMeta('changes', '[]');
		this.#setMeta(
			'shipped-notice',
			`This thread shipped as ${publication.sha.slice(0, 7)} to \`${publication.branch}\`, so its changes are on \`${publication.branch}\` now and no longer need shipping. Anything this thread does from here builds on that commit and ships separately.`
		);
	}

	// What became of what this thread shipped once it landed, told on its agent's next turn.
	verdict(notice: string) {
		if (!this.#agent()) return;
		const notices = JSON.parse(this.#meta('verdict-notices') ?? '[]') as string[];
		this.#setMeta('verdict-notices', JSON.stringify([...notices, notice]));
	}

	async stop() {
		this.#sql.exec('DELETE FROM inbox');
		const attempt = this.#agent();
		if (!attempt || !isActive(attempt.status)) return;
		this.#forgetRetries();
		this.#setStatus('interrupted');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
		this.#clearActivity();
	}

	// Picks a failed turn back up: an interrupted step resumes, then the agent continues.
	async resume() {
		const attempt = this.#agent();
		if (!attempt || isActive(attempt.status)) return;
		if (attempt.status === 'failed' && attempt.error) this.#setMeta('retried', attempt.error);
		this.#saveRetry(null);
		this.#setStatus('queued');
		await this.ctx.storage.setAlarm(Date.now());
	}

	async retryNow() {
		if (this.#wakeRetry) return this.#wakeRetry();
		if (this.#agent()?.status === 'queued' && this.#retry())
			await this.ctx.storage.setAlarm(Date.now());
	}

	async destroy() {
		await this.cancel();
		// TODO: garbage collect the thread's fork once the thread is purged.
		await this.ctx.storage.deleteAlarm();
		await this.ctx.storage.deleteAll();
	}

	services(): ServiceInfo[] {
		return JSON.parse(this.#meta('services') ?? '[]') as ServiceInfo[];
	}

	async serviceAction(action: 'start' | 'stop' | 'restart', name: string) {
		if (this.#capturing) throw new Error('A revision is being captured');
		const { fetch, repo } = await this.#wake();
		const workspace = sandboxWorkspace(fetch);
		try {
			if (action === 'start') await workspace.startService(this.#serviceRequest(name));
			if (action === 'stop') await workspace.stopService(name);
			if (action === 'restart') await workspace.restartService(name);
		} finally {
			await this.#syncServices(fetch, repo);
		}
	}

	async serviceLogs(name: string) {
		const { fetch } = await this.#wake();
		return sandboxWorkspace(fetch).serviceLogs(name, 200);
	}

	override async fetch(request: Request) {
		const url = new URL(request.url);
		const label = url.hostname.split('.')[0]!;
		const name = label.slice(label.indexOf('-') + 1);
		let service = this.services().find((service) => service.name === name);
		if (!service) return new Response(`There is no service named ${name}`, { status: 404 });
		if (service.status !== 'running' || !(this.env.SANDBOX_URL || this.ctx.container?.running)) {
			try {
				const { fetch, repo } = await this.#wake();
				service = (await this.#syncServices(fetch, repo)).find((service) => service.name === name);
				if (service?.status !== 'running') {
					await sandboxWorkspace(fetch).startService(this.#serviceRequest(name));
					service = (await this.#syncServices(fetch, repo)).find(
						(service) => service.name === name
					);
				}
			} catch (error) {
				return new Response(error instanceof Error ? error.message : String(error), {
					status: 502
				});
			}
		}
		if (!service) return new Response(`${name} stopped`, { status: 502 });
		const headers = new Headers(request.headers);
		headers.delete('accept-encoding');
		const forwarded = new Request(request, { headers });
		const path = `/preview/${service.port}${url.pathname}${url.search}`;
		if (this.env.SANDBOX_URL) {
			const base = `${this.env.SANDBOX_URL}/${this.ctx.id.name ?? this.ctx.id.toString()}`;
			return plain(await globalThis.fetch(`${base}${path}`, forwarded));
		}
		const container = this.ctx.container!;
		try {
			return plain(
				await container
					.getTcpPort(service.port)
					.fetch(`http://localhost:${service.port}${url.pathname}${url.search}`, forwarded.clone())
			);
		} catch {
			return plain(
				await container.getTcpPort(sandboxPort).fetch(`http://sandbox${path}`, forwarded)
			);
		}
	}

	changes(): DiffFile[] | null {
		const changes = this.#meta('changes');
		return changes ? (JSON.parse(changes) as DiffFile[]) : null;
	}

	override async alarm() {
		const attempt = this.#agent();
		if (!attempt || !isActive(attempt.status)) return;
		await this.#run(attempt);
	}

	async #run(attempt: AgentRow) {
		this.#setStatus('running');

		const controller = (this.#controller = new AbortController());
		const deadline = Date.now() + sliceMs;
		const retry = this.#retry();
		if (retry) this.#saveRetry({ ...retry, next: null });
		this.#think('Starting');
		try {
			const fork = await this.#fork(attempt);
			const token = await this.#token(fork);
			const fetch = await this.#sandbox({ repo: attempt.repo, ...fork }, token);
			const rebuilt = !!this.#meta('rebuilt');
			if (!attempt.base) {
				attempt.base = await this.#startingPoint(attempt, fetch, fork, token);
				this.#sql.exec('UPDATE agent SET base = ?', attempt.base);
			}
			const unrebased = await this.#rebase(attempt, fetch, fork, token);

			const pending = await this.#drain(attempt.repo);
			const syncing = !!this.#meta('sync');
			const synced = syncing ? await this.#sync(attempt, fetch, fork, token, unrebased) : null;
			if (synced) await this.#recheckBehind(attempt, fetch);
			else await this.#reportBehind(attempt, fetch);
			const opening: Turn[] = [
				...this.#rebuiltNotes(),
				...this.#retriedNotes(),
				...this.#shippedNotes(),
				...(synced ? [] : await this.#conflictNotes(attempt, fetch)),
				...this.#checkNotes(),
				...this.#overlapNotes(),
				...pending,
				...(synced ? [{ role: 'notification' as const, text: synced }] : [])
			];
			const inflight = this.#inflight();
			const resume = inflight ? resumeStep(inflight, rebuilt) : undefined;
			// An interrupted step's results come before anything new, so these join after it.
			const carried = resume ? opening : [];
			if (opening.length && !resume) this.#saveStep({ turns: opening });
			if (this.#retry()?.failures.at(-1)?.label !== 'Model request')
				await this.#recovered(attempt.repo);
			if (syncing && !synced && !pending.length && !resume) {
				this.#clearActivity();
				return await this.#finish(attempt, 'finished');
			}
			const workspace = sandboxWorkspace(fetch);
			const { model, effort } = this.#model(attempt.mode);
			const skills = await this.#skills(fetch, [
				threadsSkill,
				servicesSkill,
				toolchainsSkill,
				verificationSkill,
				checksSkill
			]);
			const guidance = await repositoryGuidance(this.#tools(fetch));
			const run = runAttempt({
				model: modelClient({
					resolveImage: (url) => this.#resolveImage(attempt.repo, url),
					gateway: { run: (request) => this.env.MODELS.run(request) },
					model,
					effort,
					compactThreshold: compactThreshold(model),
					sessionId: this.#thread(),
					metadata: {
						repo: attempt.repo,
						thread: this.#thread(),
						mode: attempt.mode,
						task: 'agent'
					}
				}),
				tools: combineTools(
					skillTools(skills),
					guidance.tools,
					intentTools({
						update: (intent) =>
							this.env.REPOS.getByName(attempt.repo).intentProposed(this.#thread(), intent),
						record: async (results) =>
							this.env.REPOS.getByName(attempt.repo).doneWhenRecorded(
								this.#thread(),
								results,
								await this.#tree(fetch)
							)
					}),
					launchTools((suggestion, start) =>
						this.env.REPOS.getByName(attempt.repo).launchThread(this.#thread(), suggestion, start)
					),
					threadTools({
						list: () => this.env.REPOS.getByName(attempt.repo).otherThreads(this.#thread()),
						send: (to, text) =>
							this.env.REPOS.getByName(attempt.repo).messageThread(this.#thread(), to, text)
					}),
					automationTools({
						create: (spec) =>
							this.env.REPOS.getByName(attempt.repo).createAutomation(this.#thread(), spec),
						list: () => this.env.REPOS.getByName(attempt.repo).automations(this.#thread()),
						cancel: (id) =>
							this.env.REPOS.getByName(attempt.repo).cancelAutomation(this.#thread(), id, {
								name: 'ReGit',
								kind: 'agent'
							})
					}),
					askThreadsTools((question) => this.#askThreads(attempt.repo, question))
				),
				checkpoints: {
					commit: (request) => workspace.commit(request),
					push: (request) => this.#push(fork, token, () => workspace.push(request))
				},
				author,
				push: { ref: fork.branch },
				instructions: withSkills(`${threadInstructions}\n\n${guidance.instructions}`, skills),
				history: this.#history(),
				signal: controller.signal,
				resume,
				retries: this.#scaled(modelRetries),
				wait: (ms, signal) => this.#wait(ms, signal),
				steer: async () => [
					...carried.splice(0),
					...(await this.#conflictNotes(attempt, fetch)),
					...this.#overlapNotes(),
					...(await this.#drain(attempt.repo))
				]
			});

			const step = new StepActivity();
			this.#think();
			let next = await run.next();
			while (!next.done) {
				const event = next.value;
				if (event.type === 'retry') {
					step.take();
					this.#activity.text = '';
					this.#activity.calls = [];
					const { label, error, attempt: number, limit, delayMs } = event;
					this.#failed(label, error, 'model request', number, limit, delayMs);
				} else if (event.type === 'compacting') {
					if (this.#activity.status?.label !== 'Compacting the context')
						this.#think('Compacting the context');
				} else if (event.type === 'reply') {
					const { reply, usage } = event;
					this.#setMeta('inflight', JSON.stringify({ reply, usage, results: [] }));
				} else if (event.type !== 'step') {
					if (event.type === 'result') this.#keepResult(event.result);
					this.#stream(step, event);
				} else {
					this.#sql.exec("DELETE FROM meta WHERE key = 'inflight'");
					this.#saveStep(event);
					await this.#recovered(attempt.repo);
					const tools = step.take();
					await this.#report(attempt.repo, {
						type: 'step',
						step: event,
						model,
						tools: controller.signal.aborted ? [] : tools
					});
					this.#stepped(event.turns);
					if (event.checkpoint) await this.#recheckBehind(attempt, fetch);
					await this.#syncServices(fetch, attempt.repo);
					if (Date.now() > deadline) {
						await run.return('aborted');
						await this.ctx.storage.setAlarm(Date.now());
						return;
					}
				}
				next = await run.next();
			}
			this.#clearActivity();
			if (this.#agent()?.status !== 'running') return;
			await this.#saveChanges(attempt, fetch);
			if (next.value === 'finished') {
				await this.#handoffChecks(attempt, fetch);
				if (this.#agent()?.status !== 'running') return;
				await this.#settle(attempt);
			} else await this.#finish(attempt, outcomes[next.value]);
		} catch (error) {
			this.#clearActivity();
			const status = this.#agent()?.status;
			if (status !== 'running') return;
			const message = errorMessage(error);
			const label = failureLabel(error);
			const failures = Number(this.#meta('turn-failures') ?? 0) + 1;
			const policy = this.#scaled(turnRetries);
			if (isTransient(error) && failures < policy.limit) {
				const delayMs = backoff(failures, policy.baseMs, policy.maxMs, error);
				this.#failed(label, message, 'turn', failures + 1, policy.limit, delayMs);
				this.#setMeta('turn-failures', String(failures));
				this.#setStatus('queued');
				await this.ctx.storage.setAlarm(Date.now() + delayMs);
				return;
			}
			const earlier = this.#retry()?.failures ?? [];
			this.#saveRetry(null);
			await this.#finish(attempt, 'failed', message, [
				...earlier,
				{ at: Date.now(), label, error: message }
			]);
		} finally {
			this.#controller = undefined;
		}
	}

	async #settle(attempt: AgentRow) {
		const queued =
			this.#sql.exec('SELECT 1 FROM inbox LIMIT 1').toArray().length > 0 ||
			!!this.#meta('sync') ||
			!!this.#meta('check-notice');
		if (!queued) return await this.#finish(attempt, 'finished');
		this.#setStatus('running');
		await this.#report(attempt.repo, { type: 'status', status: 'running', error: null });
		await this.ctx.storage.setAlarm(Date.now());
	}

	// New threads start from the newest commit main's deploy checks passed on, so they don't inherit its failures.
	async #startingPoint(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		const head = await this.#head(fetch);
		const green = await this.env.REPOS.getByName(attempt.repo).green();
		if (!head || !green || green === head || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(green))
			return head;
		if (!(await this.#shell(fetch, `git merge-base --is-ancestor ${green} HEAD`)).ok) return head;
		await this.#git(fetch, `git reset --hard ${green}`);
		await this.#push(fork, token, () =>
			sandboxWorkspace(fetch).push({ ref: fork.branch, force: true })
		);
		return green;
	}

	// Runs the repository's handoff checks; blocking failures go back to the agent for a few rounds before a person sees them.
	// A turn that changed nothing since the last checks isn't sent back again: the agent stopped on purpose.
	async #handoffChecks(attempt: AgentRow, fetch: Fetch) {
		if (!attempt.base) return;
		const signal = this.#controller?.signal;
		const cancel = () =>
			void sandboxWorkspace(fetch)
				.cancelChecks()
				.catch((error: unknown) => console.warn('Could not cancel the checks', error));
		signal?.addEventListener('abort', cancel, { once: true });
		try {
			const tree = (await this.#git(fetch, 'git rev-parse HEAD^{tree}')).trim();
			if (tree === this.#meta('handoff-tree')) return;
			const results = await this.#check(attempt, attempt.base, fetch, signal);
			if (signal?.aborted) return;
			this.#setMeta('handoff-tree', tree);
			const notice = results && checksNotice(results);
			const rounds = Number(this.#meta('check-rounds') ?? 0);
			if (!notice || rounds >= maxCheckRounds) {
				this.#sql.exec("DELETE FROM meta WHERE key = 'check-rounds'");
				return;
			}
			this.#setMeta('check-rounds', String(rounds + 1));
			this.#setMeta('check-notice', notice);
		} catch (error) {
			console.warn('Could not run the checks', error);
		} finally {
			signal?.removeEventListener('abort', cancel);
		}
	}

	// Runs the handoff checks on the workspace, reusing passes whose inputs haven't changed, and reports them.
	async #check(
		attempt: AgentRow,
		base: string,
		fetch: Fetch,
		signal?: AbortSignal
	): Promise<CheckResult[] | null> {
		const workspace = sandboxWorkspace(fetch);
		const plan = await workspace.checks({ base, commit: 'HEAD' });
		let results: CheckResult[] = [];
		if (plan.error) {
			results = [
				{ name: 'checks.yml', kind: 'run', status: 'failed', reused: false, output: plan.error }
			];
		} else if (dueChecks(plan.checks, 'handoff').length) {
			this.#think('Running checks');
			let diff: Promise<string> | undefined;
			results = await runChecks({
				checks: plan.checks,
				action: 'handoff',
				signal,
				environment: attempt.toolchain ?? '',
				intent: () => this.env.REPOS.getByName(attempt.repo).intent(this.#thread()),
				evidence: {
					passed: (key) =>
						this.#sql
							.exec(
								'SELECT 1 FROM evidence WHERE key = ? AND at > ?',
								key,
								Date.now() - evidenceTtlMs
							)
							.toArray().length > 0,
					record: (key) =>
						void this.#sql.exec(
							'INSERT INTO evidence (key, at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET at = excluded.at',
							key,
							Date.now()
						)
				},
				run: (check: PlannedCheck) =>
					workspace.runCheck({
						name: check.name,
						command: check.run!,
						timeoutSeconds: check.timeoutSeconds
					}),
				ask: async (check: PlannedCheck, context?: string) => {
					diff ??= workspace.diff({ base });
					const request = askRequest(check.ask!, await diff, context);
					const metadata = { repo: attempt.repo, thread: this.#thread(), task: 'check' };
					return askVerdict(await this.env.MODELS.decide(request, metadata));
				}
			});
		}
		if (signal?.aborted) return null;
		for (const file of plan.governing)
			results.push({
				name: file.slice(file.lastIndexOf('/') + 1),
				kind: 'run',
				status: 'warned',
				reused: false,
				output: governs[file] ?? ''
			});
		if (!results.length) return null;
		const run = { action: 'handoff' as const, at: Date.now(), results };
		await this.#report(attempt.repo, { type: 'checks', run });
		return results;
	}

	#checkNotes(): Turn[] {
		const notice = this.#meta('check-notice');
		if (!notice) return [];
		this.#sql.exec("DELETE FROM meta WHERE key = 'check-notice'");
		return [{ role: 'notification', text: notice }];
	}

	async #saveChanges(attempt: AgentRow, fetch: Fetch) {
		if (!attempt.base) return;
		try {
			await this.#advanceBase(attempt, fetch);
			let files = parseDiff(await sandboxWorkspace(fetch).diff({ base: attempt.base }));
			if (JSON.stringify(files).length > maxStoredChanges) {
				files = files.map((file) => ({ ...file, hunks: [], tooLarge: true }));
			}
			this.#setMeta('changes', JSON.stringify(files));
			await this.#report(attempt.repo, {
				type: 'changes',
				tree: await this.#tree(fetch),
				summary: summarize(files),
				paths: [
					...new Set(files.flatMap(({ path, oldPath }) => (oldPath ? [oldPath, path] : [path])))
				]
			});
		} catch (error) {
			console.warn('Could not save the changes', error);
		}
	}

	async #wake(): Promise<{ fetch: Fetch; repo: string }> {
		const attempt = this.#agent();
		if (!attempt) throw new Error("This thread hasn't started a sandbox yet");
		const fork = await this.#fork(attempt);
		const token = await this.#token(fork);
		return {
			fetch: await this.#sandbox({ repo: attempt.repo, ...fork }, token),
			repo: attempt.repo
		};
	}

	// Moves work done since shipping onto the shipped commit. When it doesn't apply, main is merged in for the agent to resolve, returning the shipped commit.
	async #rebase(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		const pending = this.#meta('rebase');
		if (!pending) return null;
		const { sha, branch, from } = JSON.parse(pending) as {
			sha: string;
			branch: string;
			from: string;
		};
		await this.#fetchMain(attempt, fetch, branch);
		const rebased = await this.#shell(fetch, `${gitAsReGit} rebase --onto ${sha} ${from}`);
		if (!rebased.ok) {
			await this.#shell(fetch, 'git rebase --abort');
			this.#sql.exec("DELETE FROM meta WHERE key IN ('rebase', 'shipped-notice')");
			this.#setMeta('sync', '1');
			return sha;
		}
		await this.#push(fork, token, () =>
			sandboxWorkspace(fetch).push({ ref: fork.branch, force: true })
		);
		attempt.base = sha;
		this.#sql.exec('UPDATE agent SET base = ?', sha);
		this.#sql.exec("DELETE FROM meta WHERE key = 'rebase'");
		return null;
	}

	// Merges main into the thread so its agent can bring it up to date, as asked or after a conflicting ship.
	async #sync(
		attempt: AgentRow,
		fetch: Fetch,
		fork: Fork,
		token: string,
		shipped: string | null = null
	) {
		this.#sql.exec("DELETE FROM meta WHERE key = 'sync'");
		const { branch, ref } = await this.#fetchMain(attempt, fetch);
		if ((await this.#shell(fetch, `git merge-base --is-ancestor ${ref} HEAD`)).ok) return null;
		const head = (await this.#git(fetch, `git rev-parse ${ref}`)).trim();
		const landed = (
			await this.#git(fetch, `git log --format='- %h %s' -20 ${attempt.base}..${ref}`)
		).trim();
		const merged = await this.#shell(fetch, `${gitAsReGit} merge --no-edit ${ref}`);
		const conflicts = merged.ok
			? []
			: (await this.#git(fetch, 'git diff --name-only --diff-filter=U'))
					.split('\n')
					.filter(Boolean);
		if (!merged.ok && !conflicts.length) {
			await this.#shell(fetch, 'git merge --abort');
			throw new Error(`Merging ${branch} failed: ${merged.output}`);
		}
		attempt.base = head;
		this.#sql.exec('UPDATE agent SET base = ?', head);
		this.#setMeta('notified', JSON.stringify(conflicts));
		const what = landed ? `\n\nWhat landed on \`${branch}\`:\n${landed}` : '';
		const why = shipped
			? `This thread shipped as ${shipped.slice(0, 7)}, but the work done since it was captured couldn't be replayed on top of it. `
			: '';
		if (merged.ok) {
			await this.#push(fork, token, () => sandboxWorkspace(fetch).push({ ref: fork.branch }));
			return `${why}\`${branch}\` moved to ${head.slice(0, 7)}, and it merged into this thread cleanly. Re-run the relevant checks against the merged code, then reply with the outcome.${what}`;
		}
		return `${why}\`${branch}\` moved to ${head.slice(0, 7)}, and merging it into this thread conflicts in ${conflicts.join(', ')}. Resolve every conflict marker so both the landed changes and what this thread set out to do still hold, run the relevant checks, then reply with the outcome.${what}`;
	}

	behindMain(behind: ThreadSummary['behind']) {
		if (this.#agent()) this.#setMeta('behind', JSON.stringify(behind));
	}

	#rebuiltNotes(): Turn[] {
		if (!this.#meta('rebuilt')) return [];
		this.#sql.exec("DELETE FROM meta WHERE key = 'rebuilt'");
		return [
			{
				role: 'notification',
				text: "Your sandbox was rebuilt from this thread's branch since your last turn. Your checkpointed changes are intact, but files Git ignores (installed dependencies, build output, local databases), anything outside the workspace and processes you started are gone. The workspace was prepared again and saved services were restarted; recreate anything else you still need."
			}
		];
	}

	#shippedNotes(): Turn[] {
		const shipped = this.#meta('shipped-notice');
		const verdicts = JSON.parse(this.#meta('verdict-notices') ?? '[]') as string[];
		this.#sql.exec("DELETE FROM meta WHERE key IN ('shipped-notice', 'verdict-notices')");
		return [...(shipped ? [shipped] : []), ...verdicts].map((text) => ({
			role: 'notification' as const,
			text
		}));
	}

	#retriedNotes(): Turn[] {
		const error = this.#meta('retried');
		if (!error) return [];
		this.#sql.exec("DELETE FROM meta WHERE key = 'retried'");
		return [
			{
				role: 'notification',
				text: `Your last turn failed: ${error}\n\nA person asked you to try again. Continue where you left off.`
			}
		];
	}

	// Tells the agent once about each file that newly conflicts with main, fetching main so it can inspect it; its workspace is left as is.
	async #conflictNotes(attempt: AgentRow, fetch: Fetch): Promise<Turn[]> {
		const behind = JSON.parse(this.#meta('behind') ?? 'null') as ThreadSummary['behind'];
		const conflicts = behind?.conflicts ?? [];
		const told = JSON.parse(this.#meta('notified') ?? '[]') as string[];
		this.#setMeta('notified', JSON.stringify(conflicts));
		if (!behind || conflicts.every((file) => told.includes(file))) return [];
		const commits = behind.commits === 1 ? '1 new commit' : `${behind.commits} new commits`;
		const main = await this.#hasMain(attempt, fetch, behind.sha);
		const inspect = main
			? ` See what landed with \`git log HEAD..${main}\` and \`git diff HEAD...${main} -- ${conflicts.join(' ')}\`.`
			: '';
		return [
			{
				role: 'notification',
				text: `\`${behind.branch}\` has ${commits} (latest ${behind.sha.slice(0, 7)} "${behind.headline}") that conflict with this thread's changes in ${conflicts.join(', ')}. \`${behind.branch}\` has not been merged into your workspace, so your files are unchanged.${inspect} Avoid deepening the conflict in those files where you can, and mention it in your reply; a person can bring the thread up to date.`
			}
		];
	}

	// Makes sure the workspace's copy of main includes the given commit, fetching it when it doesn't, and names that copy.
	async #hasMain(attempt: AgentRow, fetch: Fetch, sha: string) {
		const has = async () => {
			const ref = this.#meta('main-ref');
			const ok =
				!!ref && (await this.#shell(fetch, `git merge-base --is-ancestor ${sha} ${ref}`)).ok;
			return ok ? ref.replace('refs/remotes/', '') : null;
		};
		const known = await has();
		if (known) return known;
		try {
			await this.#fetchMain(attempt, fetch);
			return await has();
		} catch (error) {
			console.warn('Could not fetch the default branch for a conflict notice', error);
			return null;
		}
	}

	overlapping(overlaps: ThreadOverlap[]) {
		if (this.#agent()) this.#setMeta('overlaps', JSON.stringify(overlaps));
	}

	// Tells the agent once about each file that would conflict with another live thread.
	#overlapNotes(): Turn[] {
		const overlaps = JSON.parse(this.#meta('overlaps') ?? '[]') as ThreadOverlap[];
		const told = JSON.parse(this.#meta('overlaps-notified') ?? '[]') as string[];
		const key = (thread: string, file: string) => `${thread} ${file}`;
		this.#setMeta(
			'overlaps-notified',
			JSON.stringify(
				overlaps.flatMap(({ thread, files }) => files.map((file) => key(thread, file)))
			)
		);
		const fresh = overlaps
			.map(({ files, ...overlap }) => ({
				...overlap,
				files: files.filter((file) => !told.includes(key(overlap.thread, file)))
			}))
			.filter(({ files }) => files.length);
		if (!fresh.length) return [];
		// TODO: consider a small-model summary of how the conflicting changes differ if agents struggle to reconcile them.
		const lines = fresh.map(
			({ thread, headline, purpose, files }) =>
				`- Thread ${thread} ("${headline || 'New thread'}"): ${files.join(', ')}${purpose ? `\n  Its intent: ${purpose}` : ''}`
		);
		return [
			{
				role: 'notification',
				text: `Other threads that haven't shipped have changes that would conflict with this thread's:\n${lines.join('\n')}\nTheir changes are not in your workspace; whichever thread ships second resolves the conflict. To see what they changed there and why, use ask_threads, which doesn't interrupt them. Use message_thread only if the two threads then need to agree on how the shared code should end up, and mention the conflict in your reply.`
			}
		];
	}

	async #reportBehind(attempt: AgentRow, fetch: Fetch) {
		try {
			const { branch, ref } = await this.#fetchMain(attempt, fetch);
			const commits = Number(await this.#git(fetch, `git rev-list --count HEAD..${ref}`));
			let behind = null;
			if (commits) {
				const [sha = '', ...subject] = (
					await this.#git(fetch, `git log -1 --format="%H %s" ${ref}`)
				)
					.trim()
					.split(' ');
				const conflicts = await this.#conflictsWith(fetch, ref);
				behind = { branch, commits, sha, headline: subject.join(' '), conflicts };
			}
			this.#setMeta('behind', JSON.stringify(behind));
			await this.#report(attempt.repo, { type: 'behind', behind, branch });
		} catch (error) {
			console.warn('Could not compare the thread with its default branch', error);
		}
	}

	// Landings report main's moves, so after the thread's own commits it only rechecks against the main it already knows.
	async #recheckBehind(attempt: AgentRow, fetch: Fetch) {
		const known = JSON.parse(this.#meta('behind') ?? 'null') as ThreadSummary['behind'];
		if (!known) return;
		try {
			if (!(await this.#shell(fetch, `git cat-file -e ${known.sha}^{commit}`)).ok)
				return await this.#reportBehind(attempt, fetch);
			const commits = Number(await this.#git(fetch, `git rev-list --count HEAD..${known.sha}`));
			const behind = commits
				? { ...known, commits, conflicts: await this.#conflictsWith(fetch, known.sha) }
				: null;
			if (JSON.stringify(behind) === JSON.stringify(known)) return;
			this.#setMeta('behind', JSON.stringify(behind));
			await this.#report(attempt.repo, { type: 'behind', behind, branch: known.branch });
		} catch (error) {
			console.warn('Could not compare the thread with its default branch', error);
		}
	}

	async #conflictsWith(fetch: Fetch, ref: string) {
		const merged = await this.#shell(
			fetch,
			`git merge-tree --write-tree --name-only --no-messages HEAD ${ref}`
		);
		return merged.ok ? [] : merged.output.trim().split('\n').slice(1).filter(Boolean);
	}

	// Points the workspace's upstream remote at main's repository and fetches its default branch, or the given one.
	async #fetchMain(attempt: AgentRow, fetch: Fetch, branch?: string) {
		using canonical = await this.env.ARTIFACTS.get(attempt.repo);
		const info = await canonical.info();
		await this.#git(
			fetch,
			`git remote set-url ${upstream} '${info.remote}' 2>/dev/null || git remote add ${upstream} '${info.remote}'`
		);
		if (!branch) {
			const head = await this.#shell(fetch, `git ls-remote --symref ${upstream} HEAD`);
			branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head.output)?.[1] ?? info.defaultBranch;
		}
		const ref = `refs/remotes/${upstream}/${branch}`;
		await this.#git(fetch, `git fetch --no-tags ${upstream} '+refs/heads/${branch}:${ref}'`);
		this.#setMeta('main-ref', ref);
		return { branch, ref };
	}

	// Moves the base up to main when the agent merged main in itself, so main's commits don't count as the thread's changes.
	async #advanceBase(attempt: AgentRow, fetch: Fetch) {
		const main = this.#meta('main-ref');
		if (!attempt.base || !main) return;
		const merged = await this.#shell(fetch, `git merge-base HEAD ${main}`);
		const base = merged.output.trim();
		if (!merged.ok || base === attempt.base) return;
		if (!(await this.#shell(fetch, `git merge-base --is-ancestor ${attempt.base} ${base}`)).ok)
			return;
		attempt.base = base;
		this.#sql.exec('UPDATE agent SET base = ?', base);
	}

	async #shell(fetch: Fetch, command: string) {
		const output = await this.#tools(fetch).execute({
			id: 'git',
			name: 'run',
			arguments: JSON.stringify({ command })
		});
		const text = typeof output === 'string' ? output : output.text;
		const [status = '', ...rest] = text.split('\n');
		return { ok: status === 'exit code 0', output: rest.join('\n') };
	}

	// The tree done-when results are recorded on; null when it can't be read, which leaves them outdated.
	async #tree(fetch: Fetch) {
		return (await this.#git(fetch, 'git rev-parse HEAD^{tree}').catch(() => '')).trim() || null;
	}

	async #git(fetch: Fetch, command: string) {
		const { ok, output } = await this.#shell(fetch, command);
		if (!ok) throw new Error(`${command} failed: ${output}`);
		return output;
	}

	#serviceRequest(name: string) {
		const known = this.services().find((service) => service.name === name);
		if (!known || known.saved) return { name };
		const { name: _, command, port, cwd, env } = known;
		return { name, command, port, ...(cwd && { cwd }), ...(env && { env }) };
	}

	async #syncServices(fetch: Fetch, repo: string) {
		try {
			const services = await sandboxWorkspace(fetch).services();
			const json = JSON.stringify(services);
			if (json !== this.#meta('services')) {
				this.#setMeta('services', json);
				await this.#report(repo, {
					type: 'services',
					services,
					preview: await this.#previewHost(repo)
				});
			}
			return services;
		} catch (error) {
			console.warn('Could not list services', error);
			return this.services();
		}
	}

	async #restoreServices(fetch: Fetch) {
		const workspace = sandboxWorkspace(fetch);
		const services = this.services().filter(
			(service) => service.status === 'running' || service.status === 'starting'
		);
		if (!services.length) return;
		await this.#stage(`Start ${services.map((service) => service.name).join(', ')}`, async () => {
			for (const service of services) {
				await workspace.startService(this.#serviceRequest(service.name)).catch((error: unknown) => {
					console.warn(`Could not restart ${service.name}`, error);
				});
			}
		});
	}

	async #skills(fetch: Fetch, builtIn: Skill[]) {
		const repo = await sandboxWorkspace(fetch)
			.skills()
			.catch((error: unknown) => {
				console.warn('Could not read the repository skills', error);
				return [];
			});
		return mergeSkills([...builtIn, browserSkill], repo);
	}

	async #askThreads(repo: string, question: string) {
		const coordinator = this.env.REPOS.getByName(repo);
		const thread = this.#thread();
		const { answer, usage } = await askThreads({
			model: openaiModel({
				gateway: { run: (request) => this.env.MODELS.run(request) },
				model: searcher.model,
				effort: searcher.effort,
				sessionId: `${thread}/search`,
				metadata: { repo, thread, mode: this.#meta('mode') ?? 'medium', task: 'search' }
			}),
			source: {
				list: () => coordinator.otherThreads(thread),
				read: (id) => coordinator.threadDigest(id),
				search: (id, query) => coordinator.searchThread(id, query),
				diff: (id, path) => coordinator.threadDiff(id, path)
			},
			question
		});
		if (usage.length)
			await this.#report(repo, { type: 'usage', task: 'search', model: searcher.model, usage });
		return answer;
	}

	#think(label = 'Thinking') {
		this.#activity.status = { label, since: Date.now() };
		this.#publish(true);
	}

	#stream(step: StepActivity, event: Parameters<StepActivity['apply']>[0]) {
		step.apply(event);
		this.#activity.text = step.text;
		this.#activity.calls = step.calls;
		this.#activity.status = null;
		this.#publish(event.type !== 'text');
	}

	#stepped(turns: Turn[]) {
		this.#activity.text = '';
		this.#activity.calls = [];
		if (turns.some((turn) => turn.role === 'tool')) this.#think();
		else this.#activity.status = null;
	}

	#clearActivity() {
		this.#activity = { ...idle(), retry: this.#retry() };
		this.#publish(true);
	}

	#retry() {
		return JSON.parse(this.#meta('retry') ?? 'null') as Retry | null;
	}

	#saveRetry(retry: Retry | null) {
		if (retry) this.#setMeta('retry', JSON.stringify(retry));
		else this.#sql.exec("DELETE FROM meta WHERE key IN ('retry', 'turn-failures')");
		this.#activity.retry = retry;
		this.#publish(true);
	}

	#forgetRetries() {
		this.#wakeRetry?.();
		this.#sql.exec(
			"DELETE FROM meta WHERE key IN ('retry', 'turn-failures', 'inflight', 'retried')"
		);
		this.#activity.retry = null;
	}

	#failed(
		label: string,
		error: string,
		what: string,
		attempt: number,
		limit: number,
		delayMs: number
	) {
		const failures = [...(this.#retry()?.failures ?? []), { at: Date.now(), label, error }];
		this.#saveRetry({ what, failures, attempt, limit, next: Date.now() + delayMs });
	}

	// Waits out a retry delay, cut short when a person asks to retry now or the turn stops.
	async #wait(ms: number, signal?: AbortSignal) {
		const wake = new AbortController();
		this.#wakeRetry = () => wake.abort();
		try {
			await sleep(ms, signal ? AbortSignal.any([signal, wake.signal]) : wake.signal);
		} finally {
			this.#wakeRetry = undefined;
		}
		const retry = this.#retry();
		if (retry && !signal?.aborted) this.#saveRetry({ ...retry, next: null });
	}

	async #recovered(repo: string) {
		const retry = this.#retry();
		if (!retry) return;
		this.#saveRetry(null);
		await this.#report(repo, { type: 'recovered', failures: retry.failures });
	}

	async #withRetries(label: string, what: string, policy: RetryPolicy, run: () => Promise<void>) {
		for (let attempt = 1; ; attempt++) {
			try {
				return await run();
			} catch (error) {
				const signal = this.#controller?.signal;
				if (attempt >= policy.limit || !isTransient(error) || signal?.aborted) throw error;
				const delayMs = backoff(attempt, policy.baseMs, policy.maxMs, error);
				this.#failed(label, errorMessage(error), what, attempt + 1, policy.limit, delayMs);
				await this.#wait(delayMs, signal);
			}
		}
	}

	#scaled(policy: RetryPolicy): RetryPolicy {
		const scale = Number(this.env.RETRY_DELAY_SCALE || 1);
		return { ...policy, baseMs: policy.baseMs * scale, maxMs: policy.maxMs * scale };
	}

	#inflight() {
		return JSON.parse(this.#meta('inflight') ?? 'null') as InflightStep | null;
	}

	// A thread keeps the model it started with, so its history always replays to the model that wrote it.
	#model(mode: Mode): ModelChoice {
		const pinned = this.#meta('model');
		if (pinned) return JSON.parse(pinned) as ModelChoice;
		const choice = unpinned[mode];
		this.#setMeta('model', JSON.stringify(choice));
		return choice;
	}

	#keepResult(result: ToolResult) {
		const inflight = this.#inflight();
		if (!inflight) return;
		inflight.results.push(result);
		this.#setMeta('inflight', JSON.stringify(inflight));
	}

	async #stage<T>(
		label: string,
		run: (progress: (output: string) => void) => Promise<T>,
		done?: (result: T) => string,
		output?: (result: T) => string
	) {
		const stage: StartupStage = { label, status: 'running', startedAt: Date.now() };
		(this.#activity.startup ??= { cold: false, stages: [] }).stages.push(stage);
		this.#publish(true);
		try {
			const result = await run((progress) => {
				stage.output = progress;
				this.#publish();
			});
			Object.assign(stage, {
				status: 'done',
				label: done?.(result) ?? label,
				output: output?.(result)
			});
			return result;
		} catch (error) {
			stage.status = 'failed';
			stage.output = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			stage.finishedAt = Date.now();
			this.#publish(true);
		}
	}

	async #startupDone() {
		const startup = this.#activity.startup;
		if (!startup) return;
		this.#activity.startup = null;
		if (this.#activity.status) this.#activity.status.since = Date.now();
		this.#publish(true);
		const repo = this.#meta('repo');
		if (startup.cold && repo) await this.#report(repo, { type: 'startup', stages: startup.stages });
	}

	#publish(now = false) {
		const wait = this.#published + publishIntervalMs - Date.now();
		if (!now && wait > 0) {
			this.#publishing ??= setTimeout(() => this.#publish(true), wait);
			return;
		}
		clearTimeout(this.#publishing);
		this.#publishing = undefined;
		this.#published = Date.now();
		const repo = this.#meta('repo');
		if (!repo) return;
		void this.#report(repo, {
			type: 'activity',
			activity: structuredClone(published(this.#activity))
		});
	}

	async #previewHost(repo: string) {
		let id = this.#meta('preview');
		if (!id) {
			id = [...crypto.getRandomValues(new Uint8Array(10))]
				.map((byte) => byte.toString(16).padStart(2, '0'))
				.join('');
			await db.insert(previews).values({
				id,
				repo,
				thread: this.ctx.id.name ?? this.ctx.id.toString(),
				createdAt: new Date()
			});
			this.#setMeta('preview', id);
		}
		return `${id}-{name}.${this.env.PREVIEW_DOMAIN}`;
	}

	async #resolveImage(repo: string, url: string) {
		const prefix = `/${encodeURIComponent(repo)}/images/`;
		if (!url.startsWith(prefix) || !/^[0-9a-f-]{36}$/.test(url.slice(prefix.length))) {
			throw new Error('Invalid repository image reference');
		}
		const image = await this.env.REPOS.getByName(repo).image(url.slice(prefix.length));
		if (!image) throw new Error('Image is no longer available');
		return `data:${image.mime};base64,${Buffer.from(image.data).toString('base64')}`;
	}

	#tools(fetch: Fetch, only?: ToolName[]): ToolExecutor {
		const tools = sandboxTools(
			fetch,
			only,
			this.env.SANDBOX_URL
				? undefined
				: async (args, signal) => {
						const container = this.ctx.container!;
						try {
							return await containerRun(
								container,
								args,
								await this.#environment(this.#meta('repo')!),
								signal
							);
						} catch (error) {
							if (signal?.aborted || container.running) throw error;
							throw new SandboxUnavailableError(`The sandbox stopped: ${errorMessage(error)}`, {
								cause: error
							});
						}
					}
		);
		return this.#imageTools(tools, this.#meta('repo')!, this.#thread());
	}

	#imageTools(tools: ToolExecutor, repo: string, thread: string): ToolExecutor {
		return {
			specs: tools.specs,
			execute: async (call, signal) => {
				const output = await tools.execute(call, signal);
				if (typeof output === 'string') return output;
				const id = await this.env.REPOS.getByName(repo).saveImage(thread, output.imageUrl);
				const imageUrl = `/${encodeURIComponent(repo)}/images/${id}`;
				return { text: `${output.text}\nShare with ![description](${imageUrl})`, imageUrl };
			}
		};
	}

	async #head(fetch: Fetch) {
		const output = await this.#tools(fetch).execute({
			id: 'base',
			name: 'run',
			arguments: JSON.stringify({ command: 'git rev-parse HEAD' })
		});
		return (typeof output === 'string' ? output : output.text).split('\n')[1]?.trim() || null;
	}

	async #finish(
		attempt: AgentRow,
		status: AttemptStatus,
		error: string | null = null,
		failures?: RetryFailure[]
	) {
		if (['finished', 'stopped', 'failed'].includes(status)) this.#controller = undefined;
		if (status === 'finished' || status === 'stopped') await this.#recovered(attempt.repo);
		this.#setStatus(status, error);
		await this.#report(attempt.repo, {
			type: 'status',
			status,
			error,
			...(failures && { failures })
		});
	}

	// Live activity is superseded by the next update, so only lasting updates are retried.
	async #report(repo: string, update: AttemptUpdate) {
		const limit = update.type === 'activity' ? 1 : reportRetries.limit;
		for (let attempt = 1; ; attempt++) {
			try {
				return await this.env.REPOS.getByName(repo).attemptUpdated(this.#thread(), update);
			} catch (error) {
				if (attempt >= limit || !isTransient(error))
					return console.warn('Could not report the attempt to its repository', error);
				await scheduler.wait(backoff(attempt, reportRetries.baseMs, reportRetries.maxMs, error));
			}
		}
	}

	#machine() {
		return (this.#meta('machine') as Machine | null) ?? defaultMachine;
	}

	#thread() {
		return this.ctx.id.name!;
	}

	// What the sandbox tells programs about where they run: an AI agent's thread, by the AI_AGENT convention.
	async #environment(repo: string) {
		return {
			AI_AGENT: 'regit',
			REGIT_REPO: repo,
			REGIT_THREAD: this.#thread(),
			REGIT_PREVIEW_HOST: await this.#previewHost(repo)
		};
	}

	#meta(key: string) {
		return this.#sql
			.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
			.toArray()[0]?.value;
	}

	#setMeta(key: string, value: string) {
		this.#sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
			key,
			value
		);
	}

	async #drain(repo: string): Promise<Turn[]> {
		const messages = this.#sql
			.exec<{
				author: string;
				text: string;
				entry: string | null;
			}>('DELETE FROM inbox RETURNING author, text, entry')
			.toArray();
		const entries = messages.flatMap((message) => (message.entry ? [message.entry] : []));
		if (entries.length) await this.#report(repo, { type: 'read', entries });
		return messages.map(({ author, text }) => ({ role: 'user', text: `${author}: ${text}` }));
	}

	#agent() {
		return this.#sql.exec<AgentRow>('SELECT * FROM agent').toArray()[0];
	}

	#setStatus(status: AttemptStatus, error: string | null = null) {
		this.#sql.exec('UPDATE agent SET status = ?, error = ?', status, error);
	}

	#history(): Turn[] {
		return this.#sql
			.exec<{ turns: string }>('SELECT turns FROM steps ORDER BY seq')
			.toArray()
			.flatMap((row) => JSON.parse(row.turns) as Turn[]);
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

	async #fork(attempt: AgentRow): Promise<Fork> {
		if (attempt.fork && attempt.remote && attempt.branch) {
			return { name: attempt.fork, remote: attempt.remote, branch: attempt.branch };
		}
		// TODO: move thread forks to their own namespace so pushes to them stop starting RepoPushed; fork() can't target one, so it means create-and-push.
		const name = `${attempt.repo}--${this.ctx.id.name}`;
		using base = await this.env.ARTIFACTS.get(attempt.repo);
		const fork = await base
			.fork(name, { description: `ReGit thread ${this.#thread()}` })
			.catch(async (error) => {
				if ((error as ArtifactsError).code !== 'ALREADY_EXISTS') throw error;
				using existing = await this.env.ARTIFACTS.get(name);
				return existing.info();
			});
		this.#sql.exec(
			'UPDATE agent SET fork = ?, remote = ?, branch = ?',
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

	// The fork is pushed to only while a checkpoint is pushed; main stays readable so the agent can fetch it.
	async #allowGit(target: { remote: string }, token: string, push: boolean) {
		if (new URL(target.remote).protocol !== 'https:') return;
		const targets = [{ remote: target.remote, token, push }];
		const main = await this.#mainAccess();
		if (main) targets.push({ ...main, push: false });
		for (const host of new Set(targets.map(({ remote }) => new URL(remote).hostname))) {
			const proxy = this.ctx.exports.GitProxy({ props: { targets } });
			await this.ctx.container!.interceptOutboundHttps(host, proxy);
		}
	}

	async #mainAccess() {
		const repo = this.#meta('repo');
		if (!repo) return null;
		if (this.#main && this.#main.expires - Date.now() > mainTokenRefreshMs) return this.#main;
		using canonical = await this.env.ARTIFACTS.get(repo);
		const { remote } = await canonical.info();
		const { plaintext } = await canonical.createToken('read', mainTokenTtlS);
		this.#main = { remote, token: plaintext, expires: Date.now() + mainTokenTtlS * 1000 };
		return this.#main;
	}

	async #push(fork: Fork, token: string, push: () => Promise<unknown>) {
		await this.#withRetries('Push', 'push', this.#scaled(pushRetries), async () => {
			await this.#allowGit(fork, token, true);
			try {
				await push();
			} finally {
				await this.#allowGit(fork, token, false);
			}
		});
	}

	async #sandbox(target: Target, token: string): Promise<Fetch> {
		if (this.env.SANDBOX_URL) return this.#localSandbox(target);
		const container = this.ctx.container!;
		const fetch: Fetch = (url, init) => container.getTcpPort(sandboxPort).fetch(url, init);
		const workspace = sandboxWorkspace(fetch);
		await this.#allowGit(target, token, false);
		if (container.running) {
			await waitUntilHealthy(fetch);
			if (this.#meta('workspace') !== target.remote) {
				this.#activity.startup = { cold: false, stages: [] };
				try {
					await this.#cloneWorkspace(target, fetch);
					await this.#stage('Install toolchains', () => workspace.toolchain());
					await this.#hooks(fetch);
					await this.#restoreServices(fetch);
					this.#setMeta('workspace', target.remote);
				} finally {
					await this.#startupDone();
				}
			}
			return fetch;
		}
		if (this.#meta('workspace')) this.#setMeta('rebuilt', '1');
		this.#activity.startup = { cold: true, stages: [] };
		try {
			return await this.#coldSandbox(target, fetch);
		} finally {
			await this.#startupDone();
		}
	}

	async #coldSandbox(target: Target, fetch: Fetch): Promise<Fetch> {
		const container = this.ctx.container!;
		const workspace = sandboxWorkspace(fetch);

		const image = container.images.sandbox!;
		const forRepo = eq(toolchainSnapshots.repo, target.repo);
		const [cached] = await db.select().from(toolchainSnapshots).where(forRepo);
		const disk = machines[this.#machine()].diskGb * 1e9;
		const fits = (cached?.size ?? 0) + snapshotHeadroomBytes <= disk;
		let restored = cached?.image === image && fits ? cached : null;
		const { vcpu } = machines[this.#machine()];
		const boot = `Start a ${vcpu === 0.5 ? '½' : vcpu} vCPU sandbox`;
		try {
			await this.#stage(restored ? 'Restore the sandbox' : boot, () =>
				this.#start(
					restored ? { containerSnapshot: { id: restored.snapshotId } } : { image },
					fetch
				)
			);
		} catch (error) {
			if (!restored) throw error;
			restored = null;
			this.#activity.startup = { cold: true, stages: [] };
			await db.delete(toolchainSnapshots).where(forRepo);
			await this.#stage(boot, () => this.#start({ image }, fetch));
		}

		const { preserved, setup } = await this.#cloneWorkspace(target, fetch);
		const tools = await this.#stage(
			'Install toolchains',
			() => workspace.toolchain(),
			(tools) =>
				Object.keys(tools).length
					? `Install ${Object.entries(tools)
							.map(([tool, versions]) => `${tool} ${versions.join(', ')}`)
							.join(', ')}`
					: 'Check toolchains'
		);
		this.#sql.exec(
			'UPDATE agent SET toolchain = ?, restored = ?',
			JSON.stringify(tools),
			restored ? 1 : 0
		);

		// TODO: if image updates keep making snapshots cold, back up /opt/mise per toolchain key with @cloudflare/sandbox's DirectoryBackup, which restores into newer images
		const key = await digest({ image, tools, setup });
		const current = key === restored?.key;
		const aged = !restored || Date.now() - restored.createdAt.getTime() > snapshotRefreshMs;
		if (preserved && current) {
			await this.#stage('Use cached setup', async () => {});
		} else {
			await this.#hook(fetch, 'setup');
			if (!current || aged) {
				await this.#stage(
					'Cache the prepared sandbox',
					async () => {
						try {
							const snapshot = await container.snapshotContainer({
								name: `setup-${key.slice(0, 12)}`
							});
							// TODO: delete superseded snapshots and old deploy images, which share the account's 50 GB image storage
							const row = {
								snapshotId: snapshot.id,
								key,
								image,
								size: snapshot.size,
								createdAt: new Date()
							};
							await db
								.insert(toolchainSnapshots)
								.values({ repo: target.repo, ...row })
								.onConflictDoUpdate({ target: toolchainSnapshots.repo, set: row });
							return { saved: true, output: '' };
						} catch (error) {
							console.warn('Could not cache the prepared sandbox', error);
							return {
								saved: false,
								output: error instanceof Error ? error.message : String(error)
							};
						}
					},
					(result) =>
						result.saved ? 'Cache the prepared sandbox' : 'Continue without a setup cache',
					(result) => result.output
				);
			}
		}
		await this.#hook(fetch, 'resume');
		await this.#restoreServices(fetch);
		this.#setMeta('workspace', target.remote);
		return fetch;
	}

	async #cloneWorkspace(target: Target, fetch: Fetch) {
		this.#setMeta('workspace', '');
		const workspace = sandboxWorkspace(fetch);
		for (const service of await workspace.services()) await workspace.stopService(service.name);
		return this.#stage(`Clone ${target.repo}`, () =>
			workspace.clone({ remote: target.remote, branch: target.branch })
		);
	}

	async #hooks(fetch: Fetch) {
		for (const name of ['setup', 'resume'] as const) {
			await this.#hook(fetch, name);
		}
	}

	async #hook(fetch: Fetch, name: 'setup' | 'resume') {
		const label = `Run .agents/${name}`;
		let printed = '';
		const { ran } = await this.#stage(
			label,
			(progress) =>
				sandboxWorkspace(fetch).hook(name, (chunk) => {
					printed = (printed + chunk).slice(-streamedOutputChars);
					progress(printed);
				}),
			undefined,
			(result) => result.output
		);
		const startup = this.#activity.startup;
		if (ran || !startup) return;
		startup.stages = startup.stages.filter((stage) => stage.label !== label);
		this.#publish(true);
	}

	async #localSandbox(target: Target): Promise<Fetch> {
		const base = `${this.env.SANDBOX_URL}/${this.ctx.id.name ?? this.ctx.id.toString()}`;
		const fetch: Fetch = (url, init) =>
			globalThis.fetch(`${base}${new URL(String(url)).pathname}`, init);
		if (this.#meta('workspace') !== target.remote) {
			this.#activity.startup = { cold: false, stages: [] };
			try {
				await this.#cloneWorkspace(target, fetch);
				await this.#stage('Install toolchains', () => sandboxWorkspace(fetch).toolchain());
				await this.#hooks(fetch);
				await this.#restoreServices(fetch);
				this.#setMeta('workspace', target.remote);
			} finally {
				await this.#startupDone();
			}
		}
		return fetch;
	}

	async #start(source: { image: string } | { containerSnapshot: { id: string } }, fetch: Fetch) {
		const container = this.ctx.container!;
		const repo = this.#meta('repo');
		container.start({
			...source,
			enableInternet: true,
			instance: this.#machine(),
			...(repo && { env: await this.#environment(repo) })
		});
		await container.setInactivityTimeout(idleTimeoutMs);
		// TODO: observe startup failures with container.monitor(), accounting for its eviction delay in the idle policy.
		try {
			await waitUntilHealthy(fetch);
		} catch (error) {
			if (container.running) await container.destroy();
			throw error;
		}
	}
}

const publishIntervalMs = 250;
const streamedOutputChars = 4000;
const governs: Record<string, string> = {
	'.agents/checks.yml':
		'This thread changes .agents/checks.yml, which decides what must pass before main deploys. It applies once this ships.',
	'.agents/deploy':
		"This thread changes .agents/deploy, which runs with the repository's deploy secrets once this ships."
};
const maxCheckRounds = 3;
// The workspace's remote for main's repository, beside origin, the thread's fork.
const upstream = 'upstream';
const evidenceTtlMs = 30 * 24 * 60 * 60 * 1000;

const gitAsReGit = `git -c core.hooksPath=/dev/null -c user.name='${author.name}' -c user.email=${author.email}`;

// The agent's activity as the turn changes it. A status outlasts sandbox startup, so it's kept apart from the
// published phase, which shows one of them at a time.
interface AgentWork {
	startup: { cold: boolean; stages: StartupStage[] } | null;
	status: { label: string; since: number } | null;
	text: string;
	calls: ToolCallRecord[];
	retry: Retry | null;
}

function idle(): AgentWork {
	return { startup: null, status: null, text: '', calls: [], retry: null };
}

function published({ startup, status, text, calls, retry }: AgentWork): AgentActivity {
	const agent = startup
		? { type: 'starting' as const, stages: startup.stages }
		: text || calls.length
			? { type: 'streaming' as const, text, calls }
			: status
				? { type: 'thinking' as const, ...status }
				: idlePhase;
	return { agent, retry };
}

function failureLabel(error: unknown) {
	if (error instanceof SandboxUnavailableError) return 'Sandbox';
	if (error instanceof ModelError) return 'Model request';
	if ((error as { name?: unknown } | null)?.name === 'ArtifactsError') return 'Git';
	return /\bgit\b/.test(errorMessage(error)) ? 'Git' : 'Turn';
}

async function digest(value: unknown) {
	const bytes = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(JSON.stringify(value))
	);
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function plain(response: Response) {
	if (response.webSocket || !response.headers.has('content-encoding')) return response;
	const headers = new Headers(response.headers);
	headers.delete('content-encoding');
	headers.delete('content-length');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function isActive(status: AttemptStatus) {
	return ['queued', 'running'].includes(status);
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
	throw new SandboxUnavailableError(`The sandbox did not become healthy: ${reason}`, {
		cause: lastError
	});
}

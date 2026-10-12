import { DurableObject } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { previews, toolchainSnapshots } from '@regit/db';
import { db } from './db.ts';
import { containerRun } from './container-run.ts';
import {
	defaultMachine,
	machines,
	maxReviewRounds,
	summarize,
	type DiffFile,
	type Revision,
	type Candidate,
	type Assessment,
	type Machine,
	type StartupStage,
	type ThreadActivity
} from '@regit/core';
import type { AttemptUpdate } from './repo-coordinator.ts';
import {
	askThreads,
	askThreadsTools,
	codingInstructions,
	combineTools,
	mergeSkills,
	browserSkill,
	servicesSkill,
	skillTools,
	threadsSkill,
	toolchainsSkill,
	verificationSkill,
	repositoryGuidance,
	withSkills,
	intentTools,
	modes,
	openaiModel,
	parseDiff,
	readOnlyTools,
	reviewers,
	reviewFeedback,
	reviewIntent,
	runAgent,
	runAttempt,
	sandboxTools,
	sandboxWorkspace,
	searcher,
	StepActivity,
	suggestTools,
	threadInstructions,
	threadTools,
	type AgentOutcome,
	type Fetch,
	type ServiceInfo,
	type Skill,
	type Intent,
	type Mode,
	type Step,
	type ToolExecutor,
	type ToolName,
	type Toolchain,
	type Turn
} from '@regit/agent';

export interface AttemptInput {
	proposal?: string;
	intentVersion?: string;
	requiredCommits?: string[];
	task: string;
	mode: Mode;
	machine?: Machine;
	repo: string;
	intent?: Intent;
}

export interface ConverseInput {
	proposal?: string;
	intentVersion?: string;
	repo: string;
	mode: Mode;
	machine?: Machine;
	context?: string;
	author: string;
	text: string;
	entry: string;
}

export type AttemptStatus =
	| 'queued'
	| 'running'
	| 'reviewing'
	| 'shipping'
	| 'interrupted'
	| 'finished'
	| 'stopped'
	| 'failed'
	| 'cancelled';

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
	intent: string | null;
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
const maxStoredChanges = 1_500_000;

const outcomes: Record<AgentOutcome, AttemptStatus> = {
	finished: 'finished',
	'step-limit': 'stopped',
	aborted: 'cancelled'
};

export class AttemptSandbox extends DurableObject<Env> {
	#sql = this.ctx.storage.sql;
	#controller?: AbortController;
	#conversation?: AbortController;
	#activity: ThreadActivity = idle();
	#published = 0;
	#publishing?: ReturnType<typeof setTimeout>;
	#verifying = false;
	#assessment?: Promise<Assessment>;
	#capturing = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		if (ctx.container?.running) {
			void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(idleTimeoutMs));
		}
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
			CREATE TABLE IF NOT EXISTS reviews (
				round INTEGER PRIMARY KEY,
				verdict TEXT NOT NULL,
				checks TEXT NOT NULL,
				findings TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS conversation (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				turns TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS inbox (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				author TEXT NOT NULL,
				text TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
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
		for (const [table, column] of [
			['inbox', 'entry'],
			['attempt', 'intent'],
			['attempt', 'base'],
			['reviews', 'head'],
			['reviews', 'intent']
		] as const) {
			const columns = this.#sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray();
			if (!columns.some(({ name }) => name === column)) {
				this.#sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
			}
		}
	}

	async converse({
		repo,
		mode,
		machine,
		context,
		author,
		text,
		entry,
		proposal,
		intentVersion
	}: ConverseInput) {
		if (this.#capturing || this.#meta('verifierInput'))
			throw new Error('This run cannot accept messages now');
		if (
			this.#attempt() &&
			((proposal && proposal !== this.#proposal()) ||
				(intentVersion && intentVersion !== this.#meta('intentVersion')))
		) {
			throw new Error('A new accepted intent requires a new run');
		}
		if (proposal) this.#setMeta('proposal', proposal);
		if (intentVersion) this.#setMeta('intentVersion', intentVersion);
		this.#setMeta('repo', repo);
		this.#setMeta('mode', mode);
		if (machine) this.#setMeta('machine', machine);
		if (context && !this.#sql.exec('SELECT 1 FROM conversation LIMIT 1').toArray().length) {
			const seed = `This thread was spun off from another one. What it found:\n\n${context}`;
			this.#sql.exec(
				'INSERT INTO conversation (turns) VALUES (?)',
				JSON.stringify([{ role: 'user', text: seed }])
			);
		}
		this.#sql.exec('INSERT INTO inbox (author, text, entry) VALUES (?, ?, ?)', author, text, entry);
		const attempt = this.#attempt();
		if (attempt && !isActive(attempt.status)) {
			this.#setMeta('cycle', String(this.#reviewCount()));
			this.#setStatus('queued');
		}
		const current = this.#attempt();
		if (!current || current.status === 'queued' || !isActive(current.status)) {
			await this.ctx.storage.setAlarm(Date.now());
		}
	}

	async start(input: AttemptInput) {
		const serialized = JSON.stringify(input);
		if (this.#meta('startInput') === serialized) return;
		if (this.#meta('startInput') || this.#attempt() || this.#meta('verifierInput'))
			throw new Error('This run has already started');
		const { task, mode, machine, repo, intent, proposal, intentVersion } = input;
		this.#setMeta('startInput', serialized);
		if (proposal) this.#setMeta('proposal', proposal);
		if (intentVersion) this.#setMeta('intentVersion', intentVersion);
		this.#setMeta('repo', repo);
		if (machine) this.#setMeta('machine', machine);
		this.#sql.exec(
			`INSERT INTO attempt (id, task, mode, repo, status, intent) VALUES (1, ?, ?, ?, 'queued', ?)`,
			task,
			mode,
			repo,
			intent ? JSON.stringify(intent) : null
		);
		await this.ctx.storage.setAlarm(Date.now());
	}

	async revision(): Promise<Revision | null> {
		const attempt = this.#attempt();
		if (!attempt) return null;
		if (isActive(attempt.status) || this.#controller || this.#conversation || this.#capturing)
			throw new Error('Stop the run before capturing a revision');
		if (!attempt.fork || !attempt.branch || !attempt.base) return null;
		this.#capturing = true;
		try {
			const { fetch } = await this.#wake();
			const sha = await this.#head(fetch);
			if (!sha) return null;
			const run = this.ctx.id.name!;
			return {
				id: `${run}:${sha}`,
				proposal: this.#proposal(),
				run,
				intent: this.#meta('intentVersion') ?? 'legacy',
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

	async assessCandidate(input: {
		repo: string;
		proposal: string;
		intentVersion: string;
		intent: Intent;
		candidate: Candidate;
		mode: Mode;
		machine: Machine;
	}): Promise<Assessment> {
		const key = JSON.stringify(input);
		if (this.#attempt() || this.#meta('repo'))
			throw new Error('Assessment requires an independent verifier');
		const previous = this.#meta('verifierInput');
		if (previous && previous !== key)
			throw new Error('This verifier belongs to a different candidate or intent');
		const completed = this.#meta('assessment');
		if (completed) return JSON.parse(completed) as Assessment;
		if (this.#assessment) return this.#assessment;
		this.#setMeta('verifierInput', key);
		this.#setMeta('machine', input.machine);
		this.#verifying = true;
		this.#assessment = this.#assess(input);
		try {
			return await this.#assessment;
		} finally {
			this.#assessment = undefined;
			this.#verifying = false;
		}
	}

	async #assess(input: {
		repo: string;
		proposal: string;
		intentVersion: string;
		intent: Intent;
		candidate: Candidate;
		mode: Mode;
		machine: Machine;
	}): Promise<Assessment> {
		const { candidate } = input;
		if (![candidate.sha, candidate.expectedHead].every((sha) => /^[0-9a-f]{40}$/.test(sha))) {
			throw new Error('Invalid candidate commit');
		}
		if (this.ctx.container?.running) await this.ctx.container.destroy();
		using repository = await this.env.ARTIFACTS.get(candidate.repository);
		const info = await repository.info();
		const { plaintext: token } = await repository.createToken('read', 60 * 60);
		const fetch = await this.#sandbox(
			{ repo: input.repo, remote: info.remote, branch: candidate.branch },
			token
		);
		const workspace = sandboxWorkspace(fetch);
		for (const service of await workspace.services()) await workspace.stopService(service.name);
		await workspace.clone({ remote: info.remote, branch: candidate.branch });
		const tools = this.#imageTools(sandboxTools(fetch, readOnlyTools), input.repo, input.proposal);
		const command = (command: string) =>
			tools.execute({ id: 'verify', name: 'run', arguments: JSON.stringify({ command }) });
		const pinned = await command(
			`git checkout --detach ${candidate.sha} && git reset --hard ${candidate.sha} && git clean -fdx`
		);
		if (typeof pinned !== 'string' || !pinned.startsWith('exit code 0\n'))
			throw new Error('Could not pin the candidate workspace');
		if ((await this.#head(fetch)) !== candidate.sha)
			throw new Error('Candidate HEAD does not match');
		await workspace.toolchain();
		await workspace.hook('setup');
		await workspace.hook('resume');
		const guidance = await repositoryGuidance(tools);
		const skills = await this.#skills(fetch, [verificationSkill, servicesSkill, toolchainsSkill]);
		const { model, effort } = reviewers[input.mode];
		const { review } = await reviewIntent({
			model: openaiModel({
				resolveImage: (url) => this.#resolveImage(input.repo, url),
				gateway: { run: (request) => this.env.MODELS.run(request) },
				model,
				effort,
				sessionId: `${this.ctx.id.name}/assessment`,
				metadata: { thread: input.proposal, mode: input.mode, task: 'review' }
			}),
			tools: guidance.tools,
			guidance: guidance.instructions,
			skills,
			intent: input.intent,
			base: candidate.expectedHead,
			summary:
				'Assess this exact integration candidate. Do not repair it. Your review is model judgment, not trusted execution proof or authorization.'
		});
		const clean = await command(
			'status=$(git status --porcelain --untracked-files=all) && test -z "$status" && echo REGIT_CLEAN'
		);
		if (
			(await this.#head(fetch)) !== candidate.sha ||
			typeof clean !== 'string' ||
			!clean.split('\n').includes('REGIT_CLEAN')
		) {
			throw new Error('The reviewer mutated the candidate workspace');
		}
		const assessment: Assessment = {
			id: crypto.randomUUID(),
			revision: candidate.sha,
			intent: input.intentVersion,
			producer: this.ctx.id.name!,
			...review,
			at: Date.now()
		};
		this.#setMeta('assessment', JSON.stringify(assessment));
		return assessment;
	}

	snapshot(): AttemptSnapshot | null {
		const attempt = this.#attempt();
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
		const attempt = this.#attempt();
		if (!attempt || !isActive(attempt.status)) return;
		await this.#finish(attempt, 'cancelled');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
		if (this.ctx.container?.running) await this.ctx.container.destroy();
	}

	async stop() {
		this.#conversation?.abort();
		this.#sql.exec('DELETE FROM inbox');
		const attempt = this.#attempt();
		if (!attempt || !isActive(attempt.status)) return;
		this.#setStatus('interrupted');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
	}

	async destroy() {
		await this.cancel();
		// TODO: garbage collect retained forks only when no revisions reference them.
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
		const attempt = this.#attempt();
		if (attempt?.status === 'shipping')
			await this.#finish(attempt, 'failed', 'Legacy shipping is disabled');
		else if (attempt && isActive(attempt.status)) await this.#runAttempt(attempt);
		else if (this.#sql.exec('SELECT 1 FROM inbox LIMIT 1').toArray().length) await this.#converse();
	}

	async #converse() {
		const controller = (this.#conversation = new AbortController());
		const repo = this.#meta('repo')!;
		this.#think('Starting');
		const mode = this.#meta('mode') as Mode;
		const thread = this.#proposal();
		try {
			using base = await this.env.ARTIFACTS.get(repo);
			const info = await base.info();
			const { plaintext: token } = await base.createToken('read', 60 * 60);
			const fetch = await this.#sandbox(
				{ repo, remote: info.remote, branch: info.defaultBranch },
				token
			);
			const { model, effort } = modes[mode];
			const coordinator = this.env.REPOS.getByName(repo);
			const skills = await this.#skills(fetch, [threadsSkill, servicesSkill, verificationSkill]);
			const guidance = await repositoryGuidance(this.#tools(fetch, readOnlyTools));
			const tools = combineTools(
				skillTools(skills),
				guidance.tools,
				intentTools((intent) => coordinator.intentProposed(thread, intent)),
				suggestTools((suggestion) => coordinator.suggestThread(thread, suggestion)),
				threadTools({
					list: () => coordinator.otherThreads(thread),
					send: (to, text) => coordinator.messageThread(thread, to, text)
				}),
				askThreadsTools((question) => this.#askThreads(repo, question))
			);

			for (let turns = await this.#drain(repo); turns.length; turns = await this.#drain(repo)) {
				this.#saveConversation(turns);
				const history = this.#sql
					.exec<{ turns: string }>('SELECT turns FROM conversation ORDER BY seq')
					.toArray()
					.flatMap((row) => JSON.parse(row.turns) as Turn[]);
				const run = runAgent({
					model: openaiModel({
						resolveImage: (url) => this.#resolveImage(repo, url),
						gateway: { run: (request) => this.env.MODELS.run(request) },
						model,
						effort,
						sessionId: `${thread}/conversation`,
						metadata: { thread, mode, task: 'conversation' }
					}),
					tools,
					instructions: withSkills(`${threadInstructions}\n\n${guidance.instructions}`, skills),
					history,
					signal: controller.signal,
					steer: () => this.#drain(repo)
				});
				const step = new StepActivity();
				this.#think();
				for await (const event of run) {
					if (event.type !== 'step') {
						this.#stream(step, event);
						continue;
					}
					this.#saveConversation(event.turns);
					const tools = step.take();
					await this.#report(repo, {
						type: 'reply',
						step: event,
						tools: controller.signal.aborted ? [] : tools
					});
					this.#stepped(event.turns);
					await this.#syncServices(fetch, repo);
				}
				if (controller.signal.aborted) return;
			}
			this.#clearActivity();
		} catch (error) {
			this.#sql.exec('DELETE FROM inbox');
			this.#clearActivity();
			if (controller.signal.aborted) return;
			const reason = error instanceof Error ? error.message : String(error);
			await this.#report(repo, { type: 'conversation-failed', error: reason });
		} finally {
			this.#conversation = undefined;
		}
	}

	async #runAttempt(attempt: AttemptRow) {
		const resumingReview = attempt.status === 'reviewing';
		if (!resumingReview) this.#setStatus('running');

		const controller = (this.#controller = new AbortController());
		const deadline = Date.now() + sliceMs;
		if (!resumingReview) this.#think('Starting');
		try {
			const fork = await this.#fork(attempt);
			const token = await this.#token(fork);
			const fetch = await this.#sandbox({ repo: attempt.repo, ...fork }, token);
			if (!attempt.base) {
				attempt.base = await this.#head(fetch);
				const input = JSON.parse(this.#meta('startInput') ?? '{}') as AttemptInput;
				for (const sha of input.requiredCommits ?? []) {
					if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Invalid dependency commit');
					const result = await sandboxTools(fetch).execute({
						id: 'dependency',
						name: 'run',
						arguments: JSON.stringify({ command: `git merge-base --is-ancestor ${sha} HEAD` })
					});
					if (result !== 'exit code 0')
						throw new Error('Run base does not contain the pinned dependency');
				}
				this.#sql.exec('UPDATE attempt SET base = ?', attempt.base);
			}
			if (resumingReview) return await this.#review(attempt, fetch);

			const pending = await this.#drain(attempt.repo);
			if (pending.length) this.#saveStep({ turns: pending });
			const workspace = sandboxWorkspace(fetch);
			const { model, effort } = modes[attempt.mode];
			const skills = await this.#skills(fetch, [
				threadsSkill,
				servicesSkill,
				toolchainsSkill,
				verificationSkill
			]);
			const guidance = await repositoryGuidance(this.#tools(fetch));
			const run = runAttempt({
				model: openaiModel({
					resolveImage: (url) => this.#resolveImage(attempt.repo, url),
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
				tools: combineTools(
					skillTools(skills),
					guidance.tools,
					intentTools(
						async (intent) => {
							await this.env.REPOS.getByName(attempt.repo).intentProposed(this.#proposal(), intent);
						},
						['update_intent']
					),
					suggestTools((suggestion) =>
						this.env.REPOS.getByName(attempt.repo).suggestThread(this.#proposal(), suggestion)
					),
					threadTools({
						list: () => this.env.REPOS.getByName(attempt.repo).otherThreads(this.#proposal()),
						send: (to, text) =>
							this.env.REPOS.getByName(attempt.repo).messageThread(this.#proposal(), to, text)
					}),
					askThreadsTools((question) => this.#askThreads(attempt.repo, question))
				),
				checkpoints: {
					commit: (request) => workspace.commit(request),
					push: (request) => this.#push(fork, token, () => workspace.push(request))
				},
				author,
				push: { ref: fork.branch },
				instructions: withSkills(`${codingInstructions}\n\n${guidance.instructions}`, skills),
				history: this.#history(attempt),
				signal: controller.signal,
				steer: () => this.#drain(attempt.repo)
			});

			const step = new StepActivity();
			this.#think();
			let next = await run.next();
			while (!next.done) {
				if (next.value.type !== 'step') this.#stream(step, next.value);
				else {
					this.#saveStep(next.value);
					const tools = step.take();
					await this.#report(attempt.repo, {
						type: 'step',
						step: next.value,
						tools: controller.signal.aborted ? [] : tools
					});
					this.#stepped(next.value.turns);
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
			if (this.#attempt()?.status !== 'running') return;
			await this.#saveChanges(attempt, fetch);
			if (next.value === 'finished' && attempt.intent) await this.#review(attempt, fetch);
			else await this.#finish(attempt, outcomes[next.value]);
		} catch (error) {
			this.#clearActivity();
			const status = this.#attempt()?.status;
			if (status !== 'running' && status !== 'reviewing') return;
			// TODO: retry transient model and sandbox failures instead of failing the attempt
			await this.#finish(attempt, 'failed', error instanceof Error ? error.message : String(error));
		} finally {
			this.#controller = undefined;
		}
	}

	async #review(attempt: AttemptRow, fetch: Fetch) {
		const head = await this.#head(fetch);
		const [last] = this.#sql
			.exec<{ head: string | null; intent: string | null }>(
				'SELECT head, intent FROM reviews ORDER BY round DESC LIMIT 1'
			)
			.toArray();
		if (last && head && last.head === head && last.intent === attempt.intent) {
			return await this.#settle(attempt, null);
		}

		this.#setStatus('reviewing');
		await this.#report(attempt.repo, { type: 'status', status: 'reviewing', error: null });

		const intent = JSON.parse(attempt.intent!) as Intent;
		const total = this.#reviewCount() + 1;
		const round = total - Number(this.#meta('cycle') ?? 0);
		const { model, effort } = reviewers[attempt.mode];
		const thread = this.ctx.id.name ?? this.ctx.id.toString();
		const guidance = await repositoryGuidance(this.#tools(fetch, readOnlyTools));
		const skills = await this.#skills(fetch, [verificationSkill, servicesSkill, toolchainsSkill]);
		const { review, usage } = await reviewIntent({
			model: openaiModel({
				resolveImage: (url) => this.#resolveImage(attempt.repo, url),
				gateway: { run: (request) => this.env.MODELS.run(request) },
				model,
				effort,
				sessionId: `${thread}/review`,
				metadata: { thread, mode: attempt.mode, task: 'review' }
			}),
			tools: guidance.tools,
			guidance: guidance.instructions,
			skills,
			intent,
			base: attempt.base,
			summary: this.#summary(),
			signal: this.#controller?.signal
		});
		this.#sql.exec(
			'INSERT INTO reviews (round, verdict, checks, findings, head, intent) VALUES (?, ?, ?, ?, ?, ?)',
			total,
			review.verdict,
			JSON.stringify(review.checks),
			JSON.stringify(review.findings),
			head,
			attempt.intent
		);
		await this.#report(attempt.repo, {
			type: 'review',
			round,
			verdict: review.verdict,
			checks: review.checks.map((check) => check.state),
			model,
			usage
		});

		const sendBack = review.verdict === 'fail' && round < maxReviewRounds;
		await this.#settle(attempt, sendBack ? reviewFeedback(intent, review) : null);
	}

	async #settle(attempt: AttemptRow, feedback: string | null) {
		const queued = this.#sql.exec('SELECT 1 FROM inbox LIMIT 1').toArray().length > 0;
		if (!feedback && !queued) return await this.#finish(attempt, 'finished');
		if (feedback) {
			this.#saveStep({ turns: [{ role: 'user', text: feedback }] });
		} else {
			this.#setMeta('cycle', String(this.#reviewCount()));
		}
		this.#setStatus('running');
		await this.#report(attempt.repo, { type: 'status', status: 'running', error: null });
		await this.ctx.storage.setAlarm(Date.now());
	}

	async #saveChanges(attempt: AttemptRow, fetch: Fetch) {
		if (!attempt.base) return;
		try {
			let files = parseDiff(await sandboxWorkspace(fetch).diff({ base: attempt.base }));
			if (JSON.stringify(files).length > maxStoredChanges) {
				files = files.map((file) => ({ ...file, hunks: [], tooLarge: true }));
			}
			this.#setMeta('changes', JSON.stringify(files));
			await this.#report(attempt.repo, { type: 'changes', summary: summarize(files) });
		} catch (error) {
			console.warn('Could not save the changes', error);
		}
	}

	async #wake(): Promise<{ fetch: Fetch; repo: string }> {
		const attempt = this.#attempt();
		if (attempt?.fork) {
			const fork = await this.#fork(attempt);
			const token = await this.#token(fork);
			return {
				fetch: await this.#sandbox({ repo: attempt.repo, ...fork }, token),
				repo: attempt.repo
			};
		}
		const repo = this.#meta('repo');
		if (!repo) throw new Error("This thread hasn't started a sandbox yet");
		using base = await this.env.ARTIFACTS.get(repo);
		const info = await base.info();
		const { plaintext: token } = await base.createToken('read', 60 * 60);
		const fetch = await this.#sandbox(
			{ repo, remote: info.remote, branch: info.defaultBranch },
			token
		);
		return { fetch, repo };
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
		const thread = this.#proposal();
		const { answer, usage } = await askThreads({
			model: openaiModel({
				gateway: { run: (request) => this.env.MODELS.run(request) },
				model: searcher.model,
				effort: searcher.effort,
				sessionId: `${thread}/search`,
				metadata: { thread, mode: this.#meta('mode') ?? 'medium', task: 'search' }
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
		this.#activity = idle();
		this.#publish(true);
	}

	async #stage<T>(
		label: string,
		run: () => Promise<T>,
		done?: (result: T) => string,
		output?: (result: T) => string
	) {
		const stage: StartupStage = { label, status: 'running', startedAt: Date.now() };
		(this.#activity.startup ??= { cold: false, stages: [] }).stages.push(stage);
		this.#publish(true);
		try {
			const result = await run();
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
		if (this.#verifying || this.#meta('verifierInput')) return;
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
		void this.#report(repo, { type: 'activity', activity: structuredClone(this.#activity) });
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
				: async (args, signal) =>
						containerRun(
							this.ctx.container!,
							args,
							{ REGIT_PREVIEW_HOST: await this.#previewHost(this.#meta('repo')!) },
							signal
						)
		);
		return this.#imageTools(tools, this.#meta('repo')!, this.#proposal());
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
		const tools = this.#verifying ? sandboxTools(fetch, readOnlyTools) : this.#tools(fetch);
		const output = await tools.execute({
			id: 'base',
			name: 'run',
			arguments: JSON.stringify({ command: 'git rev-parse HEAD' })
		});
		return (typeof output === 'string' ? output : output.text).split('\n')[1]?.trim() || null;
	}

	#summary() {
		const steps = this.#sql
			.exec<{ turns: string }>('SELECT turns FROM steps ORDER BY seq DESC')
			.toArray();
		for (const row of steps) {
			const reply = (JSON.parse(row.turns) as Turn[]).findLast(
				(turn) => turn.role === 'assistant' && turn.text.trim()
			);
			if (reply?.role === 'assistant') return reply.text.trim();
		}
		return '';
	}

	async #finish(attempt: AttemptRow, status: AttemptStatus, error: string | null = null) {
		if (['finished', 'stopped', 'failed'].includes(status)) this.#controller = undefined;
		this.#setStatus(status, error);
		await this.#report(attempt.repo, { type: 'status', status, error });
	}

	async #report(repo: string, update: AttemptUpdate) {
		if (this.#verifying || this.#meta('verifierInput')) return;
		try {
			await this.env.REPOS.getByName(repo).attemptUpdated(
				this.#proposal(),
				update,
				this.ctx.id.name!
			);
		} catch (error) {
			console.warn('Could not report the attempt to its repository', error);
		}
	}

	#machine() {
		return (this.#meta('machine') as Machine | null) ?? defaultMachine;
	}

	#proposal() {
		return this.#meta('proposal') ?? this.ctx.id.name!;
	}

	#reviewCount() {
		return this.#sql.exec('SELECT round FROM reviews').toArray().length;
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

	#saveConversation(turns: Turn[]) {
		this.#sql.exec('INSERT INTO conversation (turns) VALUES (?)', JSON.stringify(turns));
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

	async #allowGit(target: { remote: string }, token: string, push: boolean) {
		const remote = new URL(target.remote);
		if (remote.protocol !== 'https:') return;
		const proxy = this.ctx.exports.GitProxy({ props: { remote: target.remote, token, push } });
		await this.ctx.container!.interceptOutboundHttps(remote.hostname, proxy);
	}

	async #push(fork: Fork, token: string, push: () => Promise<unknown>) {
		await this.#allowGit(fork, token, true);
		try {
			await push();
		} finally {
			await this.#allowGit(fork, token, false);
		}
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
		const [cached] = this.#verifying
			? []
			: await db.select().from(toolchainSnapshots).where(forRepo);
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

		const { preserved } = await this.#cloneWorkspace(target, fetch, !!restored);
		if (this.#verifying) return fetch;
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
			'UPDATE attempt SET toolchain = ?, restored = ?',
			JSON.stringify(tools),
			restored ? 1 : 0
		);

		// TODO: if image updates keep making snapshots cold, back up /opt/mise per toolchain key with @cloudflare/sandbox's DirectoryBackup, which restores into newer images
		const key = await digest({ image, tools, revision: await this.#head(fetch) });
		if (preserved && key === restored?.key) {
			await this.#stage('Use cached setup', async () => {});
		} else {
			await this.#hook(fetch, 'setup');
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
						return { saved: false, output: error instanceof Error ? error.message : String(error) };
					}
				},
				(result) =>
					result.saved ? 'Cache the prepared sandbox' : 'Continue without a setup cache',
				(result) => result.output
			);
		}
		await this.#hook(fetch, 'resume');
		await this.#restoreServices(fetch);
		this.#setMeta('workspace', target.remote);
		return fetch;
	}

	async #cloneWorkspace(target: Target, fetch: Fetch, preserveSetup = false) {
		this.#setMeta('workspace', '');
		const workspace = sandboxWorkspace(fetch);
		for (const service of await workspace.services()) await workspace.stopService(service.name);
		return this.#stage(`Clone ${target.repo}`, () =>
			workspace.clone({ remote: target.remote, branch: target.branch, preserveSetup })
		);
	}

	async #hooks(fetch: Fetch) {
		for (const name of ['setup', 'resume'] as const) {
			await this.#hook(fetch, name);
		}
	}

	async #hook(fetch: Fetch, name: 'setup' | 'resume') {
		const label = `Run .agents/${name}`;
		const { ran } = await this.#stage(
			label,
			() => sandboxWorkspace(fetch).hook(name),
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
				if (!this.#verifying) {
					await this.#stage('Install toolchains', () => sandboxWorkspace(fetch).toolchain());
					await this.#hooks(fetch);
					await this.#restoreServices(fetch);
					this.#setMeta('workspace', target.remote);
				}
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
			...(repo && { env: { REGIT_PREVIEW_HOST: await this.#previewHost(repo) } })
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

function idle(): ThreadActivity {
	return { startup: null, status: null, text: '', calls: [] };
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
	return ['queued', 'running', 'reviewing', 'shipping'].includes(status);
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

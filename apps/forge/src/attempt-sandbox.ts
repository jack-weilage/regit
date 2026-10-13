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
	type StartupStage,
	type ThreadActivity,
	type ThreadSummary
} from '@regit/core';
import type { AttemptUpdate } from './repo-coordinator.ts';
import {
	askThreads,
	askThreadsTools,
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
	type Mode,
	type Step,
	type ToolExecutor,
	type ToolName,
	type Toolchain,
	type Turn
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

const outcomes: Record<AgentOutcome, AttemptStatus> = {
	finished: 'finished',
	'step-limit': 'stopped',
	aborted: 'cancelled'
};

export class AttemptSandbox extends DurableObject<Env> {
	#sql = this.ctx.storage.sql;
	#controller?: AbortController;
	#activity: ThreadActivity = idle();
	#published = 0;
	#publishing?: ReturnType<typeof setTimeout>;
	#capturing = false;

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
			if (context) {
				const seed = `This thread was spun off from another one. What it found:\n\n${context}`;
				this.#saveStep({ turns: [{ role: 'user', text: seed }] });
			}
		}
		this.#sql.exec('UPDATE agent SET mode = ?', mode);
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
		await this.#finish(attempt, 'cancelled');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
		if (this.ctx.container?.running) await this.ctx.container.destroy();
	}

	forkRef() {
		const attempt = this.#agent();
		return attempt?.fork && attempt.branch
			? { repository: attempt.fork, branch: attempt.branch }
			: null;
	}

	published(publication: { sha: string; branch: string; from: string }) {
		this.#setMeta('rebase', JSON.stringify(publication));
		this.#setMeta('changes', '[]');
	}

	async stop() {
		this.#sql.exec('DELETE FROM inbox');
		const attempt = this.#agent();
		if (!attempt || !isActive(attempt.status)) return;
		this.#setStatus('interrupted');
		this.#controller?.abort();
		await this.ctx.storage.deleteAlarm();
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
		if (attempt && isActive(attempt.status)) await this.#run(attempt);
	}

	async #run(attempt: AgentRow) {
		this.#setStatus('running');

		const controller = (this.#controller = new AbortController());
		const deadline = Date.now() + sliceMs;
		this.#think('Starting');
		try {
			const fork = await this.#fork(attempt);
			const token = await this.#token(fork);
			const fetch = await this.#sandbox({ repo: attempt.repo, ...fork }, token);
			if (!attempt.base) {
				attempt.base = await this.#head(fetch);
				this.#sql.exec('UPDATE agent SET base = ?', attempt.base);
			}
			await this.#rebase(attempt, fetch, fork, token);

			const pending = await this.#drain(attempt.repo);
			const syncing = !!this.#meta('sync');
			const synced = syncing ? await this.#sync(attempt, fetch, fork, token) : null;
			if (synced) await this.#recheckBehind(attempt, fetch, fork, token);
			else await this.#reportBehind(attempt, fetch, fork, token);
			const opening: Turn[] = [
				...this.#rebuiltNotes(),
				...(synced ? [] : this.#conflictNotes()),
				...pending,
				...(synced ? [{ role: 'notification' as const, text: synced }] : [])
			];
			if (opening.length) this.#saveStep({ turns: opening });
			if (syncing && !synced && !pending.length) {
				this.#clearActivity();
				return await this.#finish(attempt, 'finished');
			}
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
					intentTools((intent) =>
						this.env.REPOS.getByName(attempt.repo).intentProposed(this.#thread(), intent)
					),
					suggestTools((suggestion) =>
						this.env.REPOS.getByName(attempt.repo).suggestThread(this.#thread(), suggestion)
					),
					threadTools({
						list: () => this.env.REPOS.getByName(attempt.repo).otherThreads(this.#thread()),
						send: (to, text) =>
							this.env.REPOS.getByName(attempt.repo).messageThread(this.#thread(), to, text)
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
				steer: async () => [...this.#conflictNotes(), ...(await this.#drain(attempt.repo))]
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
					if (next.value.checkpoint) await this.#recheckBehind(attempt, fetch, fork, token);
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
			if (next.value === 'finished') await this.#settle(attempt);
			else await this.#finish(attempt, outcomes[next.value]);
		} catch (error) {
			this.#clearActivity();
			const status = this.#agent()?.status;
			if (status !== 'running') return;
			// TODO: retry transient model and sandbox failures instead of failing the attempt
			await this.#finish(attempt, 'failed', error instanceof Error ? error.message : String(error));
		} finally {
			this.#controller = undefined;
		}
	}

	async #settle(attempt: AgentRow) {
		const queued =
			this.#sql.exec('SELECT 1 FROM inbox LIMIT 1').toArray().length > 0 || !!this.#meta('sync');
		if (!queued) return await this.#finish(attempt, 'finished');
		this.#setStatus('running');
		await this.#report(attempt.repo, { type: 'status', status: 'running', error: null });
		await this.ctx.storage.setAlarm(Date.now());
	}

	async #saveChanges(attempt: AgentRow, fetch: Fetch) {
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
		const attempt = this.#agent();
		if (!attempt) throw new Error("This thread hasn't started a sandbox yet");
		const fork = await this.#fork(attempt);
		const token = await this.#token(fork);
		return {
			fetch: await this.#sandbox({ repo: attempt.repo, ...fork }, token),
			repo: attempt.repo
		};
	}

	async #rebase(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		const pending = this.#meta('rebase');
		if (!pending) return;
		const { sha, branch, from } = JSON.parse(pending) as {
			sha: string;
			branch: string;
			from: string;
		};
		await this.#fetchMain(attempt, fetch, fork, token, branch);
		// TODO: let the agent resolve conflicts when later work no longer applies on top of the published commit.
		await this.#git(
			fetch,
			`${gitAsReGit} rebase --onto ${sha} ${from} || (git rebase --abort; exit 1)`
		);
		await this.#push(fork, token, () =>
			sandboxWorkspace(fetch).push({ ref: fork.branch, force: true })
		);
		attempt.base = sha;
		this.#sql.exec('UPDATE agent SET base = ?', sha);
		this.#sql.exec("DELETE FROM meta WHERE key = 'rebase'");
	}

	// Merges main into the thread so its agent can bring it up to date, as asked or after a conflicting ship.
	async #sync(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		this.#sql.exec("DELETE FROM meta WHERE key = 'sync'");
		const branch = await this.#fetchMain(attempt, fetch, fork, token, 'HEAD');
		if ((await this.#shell(fetch, 'git merge-base --is-ancestor FETCH_HEAD HEAD')).ok) return null;
		const head = (await this.#git(fetch, 'git rev-parse FETCH_HEAD')).trim();
		const landed = (
			await this.#git(fetch, `git log --format='- %h %s' -20 ${attempt.base}..FETCH_HEAD`)
		).trim();
		const merged = await this.#shell(fetch, `${gitAsReGit} merge --no-edit FETCH_HEAD`);
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
		if (merged.ok) {
			await this.#push(fork, token, () => sandboxWorkspace(fetch).push({ ref: fork.branch }));
			return `\`${branch}\` moved to ${head.slice(0, 7)}, and it merged into this thread cleanly. Re-run the relevant checks against the merged code, then reply with the outcome.${what}`;
		}
		return `\`${branch}\` moved to ${head.slice(0, 7)}, and merging it into this thread conflicts in ${conflicts.join(', ')}. Resolve every conflict marker so both the landed changes and what this thread set out to do still hold, run the relevant checks, then reply with the outcome.${what}`;
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

	// Tells the agent once about each file that newly conflicts with main; its workspace is left as is.
	#conflictNotes(): Turn[] {
		const behind = JSON.parse(this.#meta('behind') ?? 'null') as ThreadSummary['behind'];
		const conflicts = behind?.conflicts ?? [];
		const told = JSON.parse(this.#meta('notified') ?? '[]') as string[];
		this.#setMeta('notified', JSON.stringify(conflicts));
		if (!behind || conflicts.every((file) => told.includes(file))) return [];
		const commits = behind.commits === 1 ? '1 new commit' : `${behind.commits} new commits`;
		return [
			{
				role: 'notification',
				text: `\`${behind.branch}\` has ${commits} (latest ${behind.sha.slice(0, 7)} "${behind.headline}") that conflict with this thread's changes in ${conflicts.join(', ')}. \`${behind.branch}\` has not been merged into your workspace, so your files are unchanged. Avoid deepening the conflict in those files where you can, and mention it in your reply; a person can bring the thread up to date.`
			}
		];
	}

	async #reportBehind(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		try {
			const branch = await this.#fetchMain(attempt, fetch, fork, token, 'HEAD');
			const commits = Number(await this.#git(fetch, 'git rev-list --count HEAD..FETCH_HEAD'));
			let behind = null;
			if (commits) {
				const [sha = '', ...subject] = (
					await this.#git(fetch, 'git log -1 --format="%H %s" FETCH_HEAD')
				)
					.trim()
					.split(' ');
				const conflicts = await this.#conflictsWith(fetch, 'FETCH_HEAD');
				behind = { branch, commits, sha, headline: subject.join(' '), conflicts };
			}
			this.#setMeta('behind', JSON.stringify(behind));
			await this.#report(attempt.repo, { type: 'behind', behind, branch });
		} catch (error) {
			console.warn('Could not compare the thread with its default branch', error);
		}
	}

	// Landings report main's moves, so after the thread's own commits it only rechecks against the main it already knows.
	async #recheckBehind(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string) {
		const known = JSON.parse(this.#meta('behind') ?? 'null') as ThreadSummary['behind'];
		if (!known) return;
		try {
			if (!(await this.#shell(fetch, `git cat-file -e ${known.sha}^{commit}`)).ok)
				return await this.#reportBehind(attempt, fetch, fork, token);
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

	async #fetchMain(attempt: AgentRow, fetch: Fetch, fork: Fork, token: string, ref: string) {
		using canonical = await this.env.ARTIFACTS.get(attempt.repo);
		const info = await canonical.info();
		const { plaintext } = await canonical.createToken('read', 60 * 60);
		await this.#allowGit(info, plaintext, false);
		try {
			await this.#git(fetch, `git fetch --no-tags ${info.remote} ${ref}`);
			const head = await this.#shell(fetch, `git ls-remote --symref ${info.remote} HEAD`);
			return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(head.output)?.[1] ?? info.defaultBranch;
		} finally {
			await this.#allowGit(fork, token, false);
		}
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

	async #finish(attempt: AgentRow, status: AttemptStatus, error: string | null = null) {
		if (['finished', 'stopped', 'failed'].includes(status)) this.#controller = undefined;
		this.#setStatus(status, error);
		await this.#report(attempt.repo, { type: 'status', status, error });
	}

	async #report(repo: string, update: AttemptUpdate) {
		try {
			await this.env.REPOS.getByName(repo).attemptUpdated(this.#thread(), update);
		} catch (error) {
			console.warn('Could not report the attempt to its repository', error);
		}
	}

	#machine() {
		return (this.#meta('machine') as Machine | null) ?? defaultMachine;
	}

	#thread() {
		return this.ctx.id.name!;
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
const gitAsReGit = `git -c core.hooksPath=/dev/null -c user.name='${author.name}' -c user.email=${author.email}`;

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
	throw new Error(`The sandbox did not become healthy: ${reason}`, { cause: lastError });
}

import { DurableObject } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { canAccessRepository, repos, toolchainSnapshots } from '@regit/db';
import {
	ciPrepareStep,
	ciSecretPattern,
	ciSecretRule,
	defaultMachine,
	machines,
	type Author,
	type CiApi,
	type CiRun,
	type CiStatus,
	type CiStepStatus,
	type Machine,
	type QueuedCiRun
} from '@regit/core';
import { sandboxTools, sandboxWorkspace, type Fetch } from '@regit/agent';
import { waitUntilHealthy } from './attempt-sandbox.ts';
import { db } from './db.ts';
import type { Landing } from './landing.ts';

interface Pending extends QueuedCiRun {
	by: string | null;
}

type RunRow = {
	id: string;
	sha: string;
	branch: string;
	headline: string;
	status: CiStatus;
	by: string | null;
	started_at: number;
	finished_at: number | null;
	error: string | null;
};

type StepRow = {
	run: string;
	idx: number;
	name: string;
	command: string;
	status: CiStepStatus;
	started_at: number | null;
	finished_at: number | null;
	exit_code: number | null;
	log_offset: number;
	log_size: number;
};

const job = 'ci';
const config = '.agents/ci.yml';
const pollMs = 2000;
const retryPollMs = 5000;
const maxPollFailures = 12;
const maxRunMs = 60 * 60 * 1000;
const idleTimeoutMs = 10 * 60 * 1000;
const snapshotHeadroomBytes = 2e9;
const maxLog = 512 * 1024;
const keptRuns = 50;
const runColumns = 'id, sha, branch, headline, status, by, started_at, finished_at, error';
const stepColumns =
	'run, idx, name, command, status, started_at, finished_at, exit_code, log_offset, length(log) AS log_size';

// Runs the steps in .agents/ci.yml at each commit that lands on the default branch, one run at a time.
export class RepoCi extends DurableObject<Env> implements CiApi {
	#sql = this.ctx.storage.sql;
	#preparing = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS runs (
				id TEXT PRIMARY KEY,
				sha TEXT NOT NULL,
				branch TEXT NOT NULL,
				headline TEXT NOT NULL,
				status TEXT NOT NULL,
				by TEXT,
				started_at INTEGER NOT NULL,
				finished_at INTEGER,
				error TEXT
			);
			CREATE TABLE IF NOT EXISTS steps (
				run TEXT NOT NULL,
				idx INTEGER NOT NULL,
				name TEXT NOT NULL,
				command TEXT NOT NULL,
				status TEXT NOT NULL,
				started_at INTEGER,
				finished_at INTEGER,
				exit_code INTEGER,
				log TEXT NOT NULL DEFAULT '',
				log_offset INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (run, idx)
			);
			CREATE TABLE IF NOT EXISTS secrets (
				name TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
		`);
	}

	// A newer landing replaces one still waiting, so after a run only the latest commit runs.
	async landed({ repo, ref, after, headline }: Landing) {
		this.#setMeta('repo', repo);
		const [latest] = this.#runRows(1);
		if (latest?.sha === after && !latest.by) return;
		await this.#queue({ sha: after, branch: ref.slice('refs/heads/'.length), headline, by: null });
	}

	runs() {
		const pending = this.#pending();
		return {
			runs: this.#runRows(keptRuns).map((row) => this.#toRun(row)),
			queued: pending && { sha: pending.sha, branch: pending.branch, headline: pending.headline }
		};
	}

	log(id: string, step: string) {
		return (
			this.#sql
				.exec<{ log: string }>('SELECT log FROM steps WHERE run = ? AND name = ?', id, step)
				.toArray()[0]?.log ?? null
		);
	}

	secrets() {
		return this.#sql
			.exec<{ name: string }>('SELECT name FROM secrets ORDER BY name')
			.toArray()
			.map(({ name }) => name);
	}

	async setSecret(name: string, value: string, by: Author) {
		await this.#owner(by);
		if (!ciSecretPattern.test(name)) throw new Error(ciSecretRule);
		if (!value || value.length > 32_768) throw new Error('Secrets hold 1 to 32,768 characters');
		if (!this.secrets().includes(name) && this.secrets().length >= 100)
			throw new Error('A repository holds at most 100 secrets');
		this.#sql.exec(
			'INSERT INTO secrets (name, value) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET value = excluded.value',
			name,
			value
		);
	}

	async deleteSecret(name: string, by: Author) {
		await this.#owner(by);
		this.#sql.exec('DELETE FROM secrets WHERE name = ?', name);
	}

	async rerun(id: string, by: Author) {
		await this.#owner(by);
		const run = this.#run(id);
		if (!run) throw new Error(`There is no CI run ${id}`);
		await this.#queue({ sha: run.sha, branch: run.branch, headline: run.headline, by: by.name });
	}

	async cancel(id: string, by: Author) {
		await this.#owner(by);
		const run = this.#run(id);
		if (!run || !isActive(run.status)) return;
		if (run.status === 'running') {
			await sandboxWorkspace(this.#fetch())
				.stopJob(job)
				.catch((error: unknown) => console.warn('Could not stop the CI step', error));
		}
		await this.#finish(run, 'cancelled', `Cancelled by ${by.name}`);
	}

	override async alarm() {
		const current = this.#current();
		if (current?.status === 'running') return await this.#poll(current);
		if (current) {
			if (this.#preparing) return;
			await this.#finish(current, 'failed', 'Interrupted while preparing');
		}
		const pending = this.#pending();
		if (!pending) return;
		this.#sql.exec("DELETE FROM meta WHERE key = 'pending'");
		try {
			await this.#start(pending);
		} catch (error) {
			// Boot and clone failures happen before a run exists; the alarm retries them with backoff.
			if (!this.#pending()) this.#setMeta('pending', JSON.stringify(pending));
			throw error;
		}
	}

	async #queue(pending: Pending) {
		this.#setMeta('pending', JSON.stringify(pending));
		if (!this.#current()) await this.ctx.storage.setAlarm(Date.now());
	}

	async #start(pending: Pending) {
		const repo = this.#repo();
		this.#preparing = true;
		let run: RunRow | undefined;
		try {
			const { fetch, remote } = await this.#sandbox(repo);
			const workspace = sandboxWorkspace(fetch);
			await workspace.clone({ remote, branch: pending.branch });
			if (!pending.by && (await workspace.headBranch({ remote })) !== pending.branch) return;
			const checkout = await this.#shell(
				fetch,
				`git checkout --quiet --force --detach ${pending.sha}`
			);
			if (!checkout.ok) throw new Error(`Could not check out ${pending.sha}: ${checkout.output}`);
			const steps = await workspace.ci().then(
				({ steps }) => steps,
				(error: Error) => error
			);
			if (!steps && !pending.by) return;

			run = this.#insert(pending, steps instanceof Error || !steps ? [] : steps);
			await this.#report(run);
			if (!steps) throw new Error(`There is no ${config} at ${pending.sha.slice(0, 7)}`);
			if (steps instanceof Error) throw steps;

			this.#append(run.id, 0, '▸ Install toolchains\n');
			const tools = await workspace.toolchain();
			const versions = Object.entries(tools).map(([tool, all]) => `${tool} ${all.join(', ')}\n`);
			this.#append(run.id, 0, versions.join(''));
			this.#append(run.id, 0, '▸ Run .agents/setup\n');
			const setup = await workspace.hook('setup');
			this.#append(run.id, 0, setup.ran ? `${setup.output}\n` : 'There is no .agents/setup\n');

			if (this.#run(run.id)?.status !== 'preparing') return;
			this.#setStep(run.id, 0, 'passed');
			this.#sql.exec("UPDATE runs SET status = 'running' WHERE id = ?", run.id);
			await this.#startStep(this.#run(run.id)!, this.#steps(run.id)[1]!);
		} catch (error) {
			if (!run) throw error;
			const message = error instanceof Error ? error.message : String(error);
			this.#append(run.id, 0, `${message}\n`);
			await this.#finish(this.#run(run.id)!, 'failed', message.split('\n')[0]!);
		} finally {
			this.#preparing = false;
		}
	}

	async #startStep(run: RunRow, step: StepRow) {
		await sandboxWorkspace(this.#fetch()).startJob({
			name: job,
			command: step.command,
			env: {
				...Object.fromEntries(
					this.#sql
						.exec<{ name: string; value: string }>('SELECT name, value FROM secrets')
						.toArray()
						.map(({ name, value }) => [name, value])
				),
				REGIT_REPO: this.#repo(),
				REGIT_BRANCH: run.branch,
				REGIT_SHA: run.sha,
				REGIT_LAST_PASSED_SHA: this.#lastPassed() ?? ''
			}
		});
		this.#setStep(run.id, step.idx, 'running');
		await this.#report(run);
		await this.ctx.storage.setAlarm(Date.now() + pollMs);
	}

	async #poll(run: RunRow) {
		const step = this.#steps(run.id).find((step) => step.status === 'running');
		if (!step) return await this.#finish(run, 'failed', 'Lost track of the running step');
		try {
			const workspace = sandboxWorkspace(this.#fetch());
			let offset = step.log_offset;
			let output = '';
			let read;
			for (let page = 0; page < 16; page++) {
				read = await workspace.readJob({ name: job, offset });
				output += read.output;
				offset = read.offset;
				if (!read.output) break;
			}
			this.#sql.exec("DELETE FROM meta WHERE key = 'poll-failures'");
			if (this.#run(run.id)?.status !== 'running') return;
			this.#append(run.id, step.idx, output);
			this.#sql.exec(
				'UPDATE steps SET log_offset = ? WHERE run = ? AND idx = ?',
				offset,
				run.id,
				step.idx
			);
			if (read!.status === 'unknown')
				return await this.#finish(run, 'failed', 'The sandbox restarted during the run');
			if (read!.status === 'exited') {
				const exitCode = read!.exitCode;
				this.#setStep(run.id, step.idx, exitCode === 0 ? 'passed' : 'failed', exitCode);
				if (exitCode !== 0)
					return await this.#finish(run, 'failed', `${step.name} exited with code ${exitCode}`);
				const next = this.#steps(run.id).find((later) => later.status === 'pending');
				return next ? await this.#startStep(run, next) : await this.#finish(run, 'passed', null);
			}
			if (Date.now() - run.started_at > maxRunMs) {
				await workspace.stopJob(job);
				return await this.#finish(run, 'failed', 'Timed out after 60 minutes');
			}
			if (output) await this.#report(run);
			await this.ctx.storage.setAlarm(Date.now() + pollMs);
		} catch (error) {
			// A deploy of forge restarts this object, and the sandbox can be briefly unreachable.
			const failures = Number(this.#meta('poll-failures') ?? 0) + 1;
			this.#setMeta('poll-failures', String(failures));
			if (failures < maxPollFailures)
				return await this.ctx.storage.setAlarm(Date.now() + retryPollMs);
			this.#sql.exec("DELETE FROM meta WHERE key = 'poll-failures'");
			const message = error instanceof Error ? error.message : String(error);
			await this.#finish(run, 'failed', `Lost the sandbox: ${message}`);
		}
	}

	async #finish(run: RunRow, status: CiStatus, error: string | null) {
		const [updated] = this.#sql
			.exec<RunRow>(
				`UPDATE runs SET status = ?, finished_at = ?, error = ?
				 WHERE id = ? AND status IN ('preparing', 'running') RETURNING ${runColumns}`,
				status,
				Date.now(),
				error,
				run.id
			)
			.toArray();
		if (!updated) return;
		const stopped = status === 'cancelled' ? 'cancelled' : 'failed';
		for (const step of this.#steps(run.id)) {
			if (step.status === 'running') this.#setStep(run.id, step.idx, stopped);
			if (step.status === 'pending') this.#setStep(run.id, step.idx, 'skipped');
		}
		const kept = 'SELECT id FROM runs ORDER BY started_at DESC LIMIT ?';
		this.#sql.exec(`DELETE FROM steps WHERE run NOT IN (${kept})`, keptRuns);
		this.#sql.exec(`DELETE FROM runs WHERE id NOT IN (${kept})`, keptRuns);
		await this.#report(updated);
		if (this.#pending()) await this.ctx.storage.setAlarm(Date.now());
	}

	async #sandbox(repo: string): Promise<{ fetch: Fetch; remote: string }> {
		using canonical = await this.env.ARTIFACTS.get(repo);
		const { remote } = await canonical.info();
		const fetch = this.#fetch();
		if (this.env.SANDBOX_URL) return { fetch, remote };

		const { plaintext: token } = await canonical.createToken('read', 60 * 60);
		const container = this.ctx.container!;
		if (new URL(remote).protocol === 'https:') {
			const proxy = this.ctx.exports.GitProxy({ props: { remote, token, push: false } });
			await container.interceptOutboundHttps(new URL(remote).hostname, proxy);
		}
		if (container.running) {
			await waitUntilHealthy(fetch);
			return { fetch, remote };
		}

		const [row] = await db.select().from(repos).where(eq(repos.name, repo));
		const machine = (
			row && Object.hasOwn(machines, row.machine) ? row.machine : defaultMachine
		) as Machine;
		const image = container.images.sandbox!;
		const [cached] = await db
			.select()
			.from(toolchainSnapshots)
			.where(eq(toolchainSnapshots.repo, repo));
		const fits = (cached?.size ?? 0) + snapshotHeadroomBytes <= machines[machine].diskGb * 1e9;
		const start = async (source: { image: string } | { containerSnapshot: { id: string } }) => {
			container.start({ ...source, enableInternet: true, instance: machine });
			await container.setInactivityTimeout(idleTimeoutMs);
			try {
				await waitUntilHealthy(fetch);
			} catch (error) {
				if (container.running) await container.destroy();
				throw error;
			}
		};
		// Threads cache the repository's prepared sandbox; CI reuses it when it matches this image.
		if (cached && fits && sameImage(cached.image, image)) {
			try {
				await start({ containerSnapshot: { id: cached.snapshotId } });
				return { fetch, remote };
			} catch (error) {
				console.warn('Could not restore the prepared sandbox for CI', error);
			}
		}
		await start({ image });
		return { fetch, remote };
	}

	#fetch(): Fetch {
		if (this.env.SANDBOX_URL) {
			const base = `${this.env.SANDBOX_URL}/ci-${this.#repo()}`;
			return (url, init) => globalThis.fetch(`${base}${new URL(String(url)).pathname}`, init);
		}
		const container = this.ctx.container!;
		if (!container.running) throw new Error('The CI sandbox stopped');
		return (url, init) => container.getTcpPort(8080).fetch(url, init);
	}

	async #shell(fetch: Fetch, command: string) {
		const output = await sandboxTools(fetch, ['run']).execute({
			id: 'ci',
			name: 'run',
			arguments: JSON.stringify({ command })
		});
		const text = typeof output === 'string' ? output : output.text;
		const [status = '', ...rest] = text.split('\n');
		return { ok: status === 'exit code 0', output: rest.join('\n') };
	}

	#insert(pending: Pending, steps: { name: string; command: string }[]) {
		const now = Date.now();
		const [run] = this.#sql
			.exec<RunRow>(
				`INSERT INTO runs (id, sha, branch, headline, status, by, started_at)
				 VALUES (?, ?, ?, ?, 'preparing', ?, ?) RETURNING ${runColumns}`,
				crypto.randomUUID().replaceAll('-', '').slice(0, 12),
				pending.sha,
				pending.branch,
				pending.headline,
				pending.by,
				now
			)
			.toArray();
		const all = [{ name: ciPrepareStep, command: 'mise install && .agents/setup' }, ...steps];
		for (const [idx, { name, command }] of all.entries()) {
			this.#sql.exec(
				'INSERT INTO steps (run, idx, name, command, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
				run!.id,
				idx,
				name,
				command,
				idx ? 'pending' : 'running',
				idx ? null : now
			);
		}
		return run!;
	}

	#setStep(run: string, idx: number, status: CiStepStatus, exitCode: number | null = null) {
		this.#sql.exec(
			`UPDATE steps SET status = ?1, exit_code = ?2,
			 started_at = CASE WHEN ?1 = 'running' THEN ?3 ELSE started_at END,
			 finished_at = CASE WHEN ?1 IN ('running', 'skipped') THEN NULL ELSE ?3 END
			 WHERE run = ?4 AND idx = ?5`,
			status,
			exitCode,
			Date.now(),
			run,
			idx
		);
	}

	#append(run: string, idx: number, text: string) {
		if (!text) return;
		const [step] = this.#sql
			.exec<{ log: string }>('SELECT log FROM steps WHERE run = ? AND idx = ?', run, idx)
			.toArray();
		const log = (step?.log ?? '') + text;
		const kept = log.length > maxLog ? `… earlier output trimmed …\n${log.slice(-maxLog)}` : log;
		this.#sql.exec('UPDATE steps SET log = ? WHERE run = ? AND idx = ?', kept, run, idx);
	}

	async #report(run: RunRow) {
		try {
			const current = this.#run(run.id) ?? run;
			await this.env.REPOS.getByName(this.#repo()).ciUpdated(this.#toRun(current));
		} catch (error) {
			console.warn('Could not report the CI run to its repository', error);
		}
	}

	async #owner(by: Author) {
		if (by.kind !== 'person' || !(await canAccessRepository(db, this.#repo(), by.id, 'owner')))
			throw new Error('Repository owner permission is required');
	}

	#toRun(row: RunRow): CiRun {
		return {
			id: row.id,
			sha: row.sha,
			branch: row.branch,
			headline: row.headline,
			status: row.status,
			by: row.by,
			startedAt: row.started_at,
			finishedAt: row.finished_at,
			error: row.error,
			steps: this.#steps(row.id).map((step) => ({
				name: step.name,
				command: step.command,
				status: step.status,
				startedAt: step.started_at,
				finishedAt: step.finished_at,
				exitCode: step.exit_code,
				logSize: step.log_size
			}))
		};
	}

	#runRows(limit: number) {
		return this.#sql
			.exec<RunRow>(`SELECT ${runColumns} FROM runs ORDER BY started_at DESC LIMIT ?`, limit)
			.toArray();
	}

	#run(id: string) {
		return this.#sql.exec<RunRow>(`SELECT ${runColumns} FROM runs WHERE id = ?`, id).toArray()[0];
	}

	#steps(run: string) {
		return this.#sql
			.exec<StepRow>(`SELECT ${stepColumns} FROM steps WHERE run = ? ORDER BY idx`, run)
			.toArray();
	}

	#current() {
		return this.#sql
			.exec<RunRow>(
				`SELECT ${runColumns} FROM runs WHERE status IN ('preparing', 'running') LIMIT 1`
			)
			.toArray()[0];
	}

	#lastPassed() {
		return this.#sql
			.exec<{ sha: string }>(
				"SELECT sha FROM runs WHERE status = 'passed' ORDER BY started_at DESC LIMIT 1"
			)
			.toArray()[0]?.sha;
	}

	#pending() {
		const value = this.#meta('pending');
		return value ? (JSON.parse(value) as Pending) : null;
	}

	#repo() {
		const repo = this.#meta('repo') ?? this.ctx.id.name;
		if (!repo) throw new Error("This CI doesn't know its repository yet");
		return repo;
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
}

function isActive(status: CiStatus) {
	return status === 'preparing' || status === 'running';
}

// Container applications push the same build under their own names; the digest identifies it.
function sameImage(a: string, b: string) {
	const digest = (image: string) => image.split('@')[1] ?? image;
	return digest(a) === digest(b);
}

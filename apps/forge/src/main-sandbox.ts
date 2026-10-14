import { DurableObject } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { repos } from '@regit/db';
import {
	dueChecks,
	runChecks,
	sandboxWorkspace,
	type DeployResponse,
	type Fetch,
	type PlannedCheck
} from '@regit/agent';
import { defaultDeployMachine, machines, type CheckResult, type Machine } from '@regit/core';
import { db } from './db.ts';
import { open } from './secrets.ts';

export const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const sandboxPort = 8080;
const idleTimeoutMs = 15 * 60 * 1000;
const healthTimeoutMs = 5 * 60 * 1000;
const evidenceTtlMs = 30 * 24 * 60 * 60 * 1000;
const snapshotHeadroomBytes = 2e9;
const snapshotRefreshMs = 24 * 60 * 60 * 1000;

// The container with its toolchains and the check checkout's dependencies installed, which a cold start resumes from.
interface Snapshot {
	id: string;
	image: string;
	size: number;
	at: number;
}

export interface MainCheck {
	repo: string;
	sha: string;
	// The last commit that passed, or the empty tree; checks limited by `when` run when their paths changed since.
	base: string;
	only?: string[];
}

// One per repository: checks commits that landed on main and deploys them, in a container no agent works in.
export class MainSandbox extends DurableObject<Env> {
	#sql = this.ctx.storage.sql;
	#pending: Promise<unknown> = Promise.resolve();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS evidence (
				key TEXT PRIMARY KEY,
				at INTEGER NOT NULL
			);
		`);
	}

	#serial<T>(run: () => Promise<T>): Promise<T> {
		const next = this.#pending.then(run);
		this.#pending = next.catch(() => {});
		return next;
	}

	commits({ repo, from, to }: { repo: string; from: string | null; to: string }) {
		return this.#serial(async () => {
			const { fetch } = await this.#workspace(repo);
			return (await sandboxWorkspace(fetch).commits({ from, to })).commits;
		});
	}

	// Runs the deploy checks defined at the commit, reusing passes whose inputs and toolchain are unchanged.
	check({ repo, sha, base, only }: MainCheck): Promise<CheckResult[]> {
		return this.#serial(async () => {
			const { fetch, toolchain } = await this.#workspace(repo);
			const workspace = sandboxWorkspace(fetch);
			const plan = await workspace.checks({ base, commit: sha });
			if (plan.error)
				return [
					{ name: 'checks.yml', kind: 'run', status: 'failed', reused: false, output: plan.error }
				];
			const checks = only ? plan.checks.filter(({ name }) => only.includes(name)) : plan.checks;
			if (!dueChecks(checks, 'deploy').length) return [];
			const results = await runChecks({
				checks,
				action: 'deploy',
				environment: toolchain,
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
						commit: sha,
						timeoutSeconds: check.timeoutSeconds
					}),
				ask: () => Promise.reject(new Error('Ask checks only run before handoff'))
			});
			await this.#snapshot();
			return results;
		});
	}

	// Runs .agents/deploy at the commit with the repository's deploy secrets, which only this call ever opens.
	deploy({ repo, sha }: { repo: string; sha: string }): Promise<DeployResponse> {
		return this.#serial(async () => {
			const { fetch } = await this.#workspace(repo);
			const coordinator = this.env.REPOS.getByName(repo);
			const sealed = await coordinator.sealedDeploySecrets();
			const env = sealed.length ? await open(this.env, repo, sealed) : {};
			const deployed = (await coordinator.main()).deployed?.sha ?? null;
			this.ctx.storage.kv.put('deployed-since-start', true);
			return sandboxWorkspace(fetch).deploy({ commit: sha, env, deployed });
		});
	}

	// Fetches main into the workspace, starting the container and installing toolchains when needed.
	async #workspace(repo: string) {
		using canonical = await this.env.ARTIFACTS.get(repo);
		const { remote } = await canonical.info();
		const fetch = this.env.SANDBOX_URL
			? this.#local()
			: await this.#container(repo, canonical, remote);
		const workspace = sandboxWorkspace(fetch);
		await workspace.clone({ remote });
		return { fetch, toolchain: JSON.stringify(await workspace.toolchain()) };
	}

	#local(): Fetch {
		const base = `${this.env.SANDBOX_URL}/${this.ctx.id.name ?? this.ctx.id.toString()}`;
		return (url, init) => globalThis.fetch(`${base}${new URL(String(url)).pathname}`, init);
	}

	async #container(repo: string, canonical: ArtifactsRepo, remote: string): Promise<Fetch> {
		const container = this.ctx.container!;
		const fetch: Fetch = (url, init) => container.getTcpPort(sandboxPort).fetch(url, init);
		const { plaintext: token } = await canonical.createToken('read', 60 * 60);
		const proxy = this.ctx.exports.GitProxy({ props: { remote, token, push: false } });
		await container.interceptOutboundHttps(new URL(remote).hostname, proxy);
		const image = container.images.sandbox!;
		// A running container keeps the image it started with; checks and deploys use the one forge deployed last.
		if (container.running && this.ctx.storage.kv.get('image') !== image) await container.destroy();
		if (container.running) {
			await container.setInactivityTimeout(idleTimeoutMs);
			await healthy(fetch, container);
		} else {
			const [row] = await db
				.select({ machine: repos.deployMachine })
				.from(repos)
				.where(eq(repos.name, repo));
			const machine = (row?.machine as Machine | undefined) ?? defaultDeployMachine;
			const saved = this.ctx.storage.kv.get<Snapshot>('snapshot');
			const fits = !!saved && saved.size + snapshotHeadroomBytes <= machines[machine].diskGb * 1e9;
			const restore = saved?.image === image && fits ? saved : null;
			this.ctx.storage.kv.delete('deployed-since-start');
			try {
				await this.#start(
					fetch,
					repo,
					machine,
					restore ? { containerSnapshot: { id: restore.id } } : { image }
				);
			} catch (error) {
				if (!restore) throw error;
				console.warn('Could not restore the main sandbox snapshot', error);
				this.ctx.storage.kv.delete('snapshot');
				await this.#start(fetch, repo, machine, { image });
			}
			this.ctx.storage.kv.put('image', image);
		}
		if (!(await sandboxWorkspace(fetch).trust()))
			throw new Error('The main sandbox has no HTTPS interception CA to trust');
		return fetch;
	}

	async #start(
		fetch: Fetch,
		repo: string,
		instance: Machine,
		source: { image: string } | { containerSnapshot: { id: string } }
	) {
		const container = this.ctx.container!;
		const env = { CI: 'true', REGIT_REPO: repo };
		container.start({ ...source, instance, enableInternet: true, env });
		await container.setInactivityTimeout(idleTimeoutMs);
		await healthy(fetch, container);
	}

	// Snapshots the container once checks have prepared it, so cold starts skip installing toolchains and dependencies.
	// A container that deployed may hold Docker's images, which don't belong in a snapshot.
	async #snapshot() {
		if (this.env.SANDBOX_URL || this.ctx.storage.kv.get('deployed-since-start')) return;
		const container = this.ctx.container!;
		const image = container.images.sandbox!;
		const saved = this.ctx.storage.kv.get<Snapshot>('snapshot');
		if (saved?.image === image && Date.now() - saved.at < snapshotRefreshMs) return;
		try {
			const snapshot = await container.snapshotContainer({
				name: `main-${Date.now().toString(36)}`
			});
			// TODO: delete superseded snapshots, which share the account's image storage with deploy images.
			this.ctx.storage.kv.put('snapshot', {
				id: snapshot.id,
				image,
				size: snapshot.size,
				at: Date.now()
			});
		} catch (error) {
			console.warn('Could not snapshot the main sandbox', error);
		}
	}
}

async function healthy(fetch: Fetch, container: Container) {
	const deadline = Date.now() + healthTimeoutMs;
	while (Date.now() < deadline) {
		try {
			const response = await fetch('http://sandbox/health', { signal: AbortSignal.timeout(1000) });
			await response.body?.cancel();
			if (response.ok) return;
		} catch {
			/* Retry until the bounded startup deadline. */
		}
		await scheduler.wait(200);
	}
	await container.destroy();
	throw new Error('The main sandbox did not become healthy');
}

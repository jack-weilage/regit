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
import { defaultDeployMachine, type CheckResult, type Machine } from '@regit/core';
import { db } from './db.ts';
import { open } from './secrets.ts';

export const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const sandboxPort = 8080;
const idleTimeoutMs = 15 * 60 * 1000;
const healthTimeoutMs = 5 * 60 * 1000;
const evidenceTtlMs = 30 * 24 * 60 * 60 * 1000;

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
			return runChecks({
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
		});
	}

	// Runs .agents/deploy at the commit with the repository's deploy secrets, which only this call ever opens.
	deploy({ repo, sha }: { repo: string; sha: string }): Promise<DeployResponse> {
		return this.#serial(async () => {
			const { fetch } = await this.#workspace(repo);
			const sealed = await this.env.REPOS.getByName(repo).sealedDeploySecrets();
			const env = sealed.length ? await open(this.env, repo, sealed) : {};
			return sandboxWorkspace(fetch).deploy({ commit: sha, env });
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
		if (!container.running) {
			const [row] = await db
				.select({ machine: repos.deployMachine })
				.from(repos)
				.where(eq(repos.name, repo));
			container.start({
				image: container.images.sandbox!,
				instance: (row?.machine as Machine | undefined) ?? defaultDeployMachine,
				enableInternet: true
			});
			// TODO: restore the repository's toolchain snapshot, as thread sandboxes do, instead of installing from scratch.
		}
		await container.setInactivityTimeout(idleTimeoutMs);
		await healthy(fetch, container);
		if (!(await sandboxWorkspace(fetch).trust()))
			throw new Error('The main sandbox has no HTTPS interception CA to trust');
		return fetch;
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

import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { sandboxWorkspace, type Fetch } from '@regit/agent';
import { defaultMachine, type Ship, type ShipStage } from '@regit/core';
import { proxyGit, type GitAccess } from './git-access.ts';

export class PublisherGitProxy extends WorkerEntrypoint<Env, { targets: GitAccess[] }> {
	override fetch(request: Request) {
		const url = new URL(request.url);
		const target = this.ctx.props.targets.find(({ remote }) => {
			const repo = new URL(remote);
			return (
				url.host === repo.host &&
				(url.pathname === repo.pathname || url.pathname.startsWith(`${repo.pathname}/`))
			);
		});
		if (!target) return new Response('Repository is not authorized', { status: 403 });
		return proxyGit(request, target);
	}
}

const committer = { name: 'ReGit', email: 'agent@regit.dev' };

export class RepositoryGit extends DurableObject<Env> {
	#pending: Promise<unknown> = Promise.resolve();

	#serial<T>(run: () => Promise<T>): Promise<T> {
		const next = this.#pending.then(run);
		this.#pending = next.catch(() => {});
		return next;
	}

	// Squashes the thread onto main, pushes it and records provenance, reporting each stage.
	// Safe to retry: a ship already on main is found, not repeated.
	async ship(ship: Ship, attempt = 1): Promise<{ sha: string; branch: string }> {
		let branch: string | null = null;
		const progress = (stage: ShipStage, note: string | null = null) =>
			this.env.REPOS.getByName(ship.repo)
				.shipProgress(ship, { stage, note, branch, since: Date.now() })
				.catch((error: unknown) => console.warn('Could not report ship progress', error));
		return this.#serial(async () => {
			await progress('fetching', attempt > 1 ? `Retrying, attempt ${attempt}` : null);
			using source = await this.env.ARTIFACTS.get(ship.source.repository);
			using canonical = await this.env.ARTIFACTS.get(ship.repo);
			const sourceInfo = await source.info();
			const canonicalInfo = await canonical.info();
			const targets = [
				await this.#access(source, sourceInfo.remote),
				await this.#access(canonical, canonicalInfo.remote, true)
			];
			try {
				await this.#allow(targets.map((target) => ({ ...target, push: false })));
				const workspace = sandboxWorkspace(await this.#sandbox());
				await workspace.clone({ remote: sourceInfo.remote, branch: ship.source.branch });
				const target =
					(await workspace.headBranch({ remote: canonicalInfo.remote })) ??
					canonicalInfo.defaultBranch;
				branch = target;
				await this.#allow(targets);
				let sha: string | null = null;
				for (let moved = 0; moved < 5 && !sha; moved++) {
					await progress('building', moved ? `${target} moved, so rebuilding on top of it` : null);
					const built = await workspace.buildShip({
						id: ship.id,
						sourceSha: ship.source.sha,
						base: ship.source.base,
						remote: canonicalInfo.remote,
						branch: target,
						message: [ship.title, ship.body, 'Co-authored-by: ReGit <agent@regit.dev>']
							.filter(Boolean)
							.join('\n\n'),
						author: { name: ship.by.name, email: ship.email },
						committer
					});
					if (built.shipped) sha = built.sha;
					else {
						await progress('pushing', `${built.sha.slice(0, 7)} onto ${built.head.slice(0, 7)}`);
						const { pushed } = await workspace.pushShip({
							sha: built.sha,
							head: built.head,
							remote: canonicalInfo.remote,
							branch: target
						});
						if (pushed) sha = built.sha;
					}
				}
				if (!sha) throw new Error(`${target} kept moving while shipping`);
				await progress('recording');
				await workspace.publishProvenance({
					sha,
					remote: canonicalInfo.remote,
					note: JSON.stringify({
						schema: 2,
						ship: ship.id,
						source: ship.source,
						intent: ship.intent,
						shippedBy: ship.by
					})
				});
				return { sha, branch: target };
			} finally {
				await this.#revoke(targets);
			}
		});
	}

	async compare(repo: string, forks: { id: string; repository: string; branch: string }[]) {
		return this.#serial(async () => {
			using canonical = await this.env.ARTIFACTS.get(repo);
			const canonicalInfo = await canonical.info();
			const sources = [];
			for (const fork of forks) {
				using source = await this.env.ARTIFACTS.get(fork.repository);
				const { remote } = await source.info();
				sources.push({ fork, remote, access: await this.#access(source, remote) });
			}
			const targets = [
				await this.#access(canonical, canonicalInfo.remote),
				...sources.map(({ access }) => access)
			];
			try {
				await this.#allow(targets);
				return await sandboxWorkspace(await this.#sandbox()).compare({
					remote: canonicalInfo.remote,
					forks: sources.map(({ fork, remote }) => ({ id: fork.id, remote, branch: fork.branch }))
				});
			} finally {
				await this.#revoke(targets);
			}
		});
	}

	async #access(repo: ArtifactsRepo, remote: string, push = false): Promise<GitAccess> {
		if (this.env.SANDBOX_URL) return { remote, token: '', push };
		if (new URL(remote).protocol !== 'https:') throw new Error('Git requires HTTPS');
		const { plaintext: token } = await repo.createToken(push ? 'write' : 'read', 600);
		return { remote, token, push };
	}

	async #allow(targets: GitAccess[]) {
		if (this.env.SANDBOX_URL) return;
		for (const host of new Set(targets.map(({ remote }) => new URL(remote).hostname))) {
			const proxy = this.ctx.exports.PublisherGitProxy({ props: { targets } });
			await this.ctx.container!.interceptOutboundHttps(host, proxy);
		}
	}

	async #revoke(targets: GitAccess[]) {
		try {
			await this.#allow(targets.map((target) => ({ ...target, push: false, token: '' })));
		} catch (error) {
			await this.ctx.container?.destroy();
			throw error;
		}
	}

	// Call after #allow, so the interception CA exists for the container to trust.
	async #sandbox(): Promise<Fetch> {
		if (this.env.SANDBOX_URL) {
			const base = `${this.env.SANDBOX_URL}/${this.ctx.id.name ?? this.ctx.id.toString()}`;
			return (url, init) => globalThis.fetch(`${base}${new URL(String(url)).pathname}`, init);
		}
		const container = this.ctx.container!;
		const fetch: Fetch = (url, init) => container.getTcpPort(8080).fetch(url, init);
		const trusted = () =>
			sandboxWorkspace(fetch)
				.trust()
				.catch(() => false);
		if (container.running) {
			await this.#healthy(fetch);
			if (await trusted()) return fetch;
			await container.destroy();
		}
		container.start({
			image: container.images.sandbox!,
			instance: defaultMachine,
			enableInternet: true
		});
		await container.setInactivityTimeout(5 * 60 * 1000);
		await this.#healthy(fetch);
		if (!(await trusted()))
			throw new Error('The Git sandbox has no HTTPS interception CA to trust');
		return fetch;
	}

	async #healthy(fetch: Fetch) {
		const deadline = Date.now() + 5 * 60 * 1000;
		while (Date.now() < deadline) {
			try {
				const response = await fetch('http://sandbox/health', {
					signal: AbortSignal.timeout(1000)
				});
				await response.body?.cancel();
				if (response.ok) return;
			} catch {
				/* Retry until the bounded startup deadline. */
			}
			await scheduler.wait(200);
		}
		await this.ctx.container!.destroy();
		throw new Error('The Git sandbox did not become healthy');
	}
}

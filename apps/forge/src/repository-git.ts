import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { sandboxWorkspace, type Fetch } from '@regit/agent';
import { defaultMachine, type Candidate, type Revision, type Promotion } from '@regit/core';
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

	async prepare(repo: string, revision: Revision, promotion: Promotion): Promise<Candidate> {
		return this.#serial(async () => {
			const key = `candidate:${promotion.id}`;
			const saved = await this.ctx.storage.get<Candidate>(key);
			if (saved) return saved;
			using source = await this.env.ARTIFACTS.get(revision.repository);
			using canonical = await this.env.ARTIFACTS.get(repo);
			const sourceInfo = await source.info();
			const canonicalInfo = await canonical.info();
			const name = `${repo}--candidate-${promotion.id}`;
			const fork = await canonical.fork(name).catch(async (error) => {
				if ((error as ArtifactsError).code !== 'ALREADY_EXISTS') throw error;
				using existing = await this.env.ARTIFACTS.get(name);
				return existing.info();
			});
			using candidateRepo = await this.env.ARTIFACTS.get(name);
			const targets = [
				await this.#access(source, sourceInfo.remote),
				await this.#access(canonical, canonicalInfo.remote),
				await this.#access(candidateRepo, fork.remote, true)
			];
			const fetch = await this.#sandbox();
			try {
				await this.#allow(targets);
				const workspace = sandboxWorkspace(fetch);
				await workspace.clone({ remote: sourceInfo.remote, branch: revision.branch });
				const branch =
					(await workspace.headBranch({ remote: canonicalInfo.remote })) ??
					canonicalInfo.defaultBranch;
				const prepared = await workspace.prepareCandidate({
					sourceSha: revision.sha,
					base: revision.base,
					remote: canonicalInfo.remote,
					branch,
					message: [promotion.title, promotion.body, 'Co-authored-by: ReGit <agent@regit.dev>']
						.filter(Boolean)
						.join('\n\n'),
					author: { name: promotion.requestedBy.name, email: promotion.email },
					committer
				});
				await workspace.push({ remote: fork.remote, ref: branch, force: true });
				const result: Candidate = { repository: name, branch, ...prepared };
				await this.ctx.storage.put(key, result);
				return result;
			} finally {
				await this.#revoke(targets);
			}
		});
	}

	async conflicts(repo: string, forks: { id: string; repository: string; branch: string }[]) {
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
			const fetch = await this.#sandbox();
			try {
				await this.#allow(targets);
				return await sandboxWorkspace(fetch).conflicts({
					remote: canonicalInfo.remote,
					forks: sources.map(({ fork, remote }) => ({ id: fork.id, remote, branch: fork.branch }))
				});
			} finally {
				await this.#revoke(targets);
			}
		});
	}

	async promote(repo: string, candidate: Candidate): Promise<void> {
		return this.#publish(repo, candidate, async (workspace, remote) => {
			await workspace.promoteCandidate({
				sha: candidate.sha,
				expectedHead: candidate.expectedHead,
				branch: candidate.branch,
				remote
			});
		});
	}

	async notes(repo: string, candidate: Candidate, note: string): Promise<void> {
		return this.#publish(repo, candidate, async (workspace, remote) => {
			await workspace.publishProvenance({ sha: candidate.sha, note, remote });
		});
	}

	#publish(
		repo: string,
		candidate: Candidate,
		run: (workspace: ReturnType<typeof sandboxWorkspace>, remote: string) => Promise<void>
	): Promise<void> {
		return this.#serial(async () => {
			using source = await this.env.ARTIFACTS.get(candidate.repository);
			using canonical = await this.env.ARTIFACTS.get(repo);
			const sourceInfo = await source.info();
			const canonicalInfo = await canonical.info();
			const targets = [
				await this.#access(source, sourceInfo.remote),
				await this.#access(canonical, canonicalInfo.remote, true)
			];
			const fetch = await this.#sandbox();
			try {
				await this.#allow(targets.map((target) => ({ ...target, push: false })));
				const workspace = sandboxWorkspace(fetch);
				await workspace.clone({ remote: sourceInfo.remote, branch: candidate.branch });
				await this.#allow(targets);
				await run(workspace, canonicalInfo.remote);
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

	async #sandbox(): Promise<Fetch> {
		if (this.env.SANDBOX_URL) {
			const base = `${this.env.SANDBOX_URL}/${this.ctx.id.name ?? this.ctx.id.toString()}`;
			return (url, init) => globalThis.fetch(`${base}${new URL(String(url)).pathname}`, init);
		}
		const container = this.ctx.container!;
		const fetch: Fetch = (url, init) => container.getTcpPort(8080).fetch(url, init);
		if (!container.running)
			container.start({
				image: container.images.sandbox!,
				instance: defaultMachine,
				enableInternet: true
			});
		await container.setInactivityTimeout(5 * 60 * 1000);
		const deadline = Date.now() + 5 * 60 * 1000;
		while (Date.now() < deadline) {
			try {
				const response = await fetch('http://sandbox/health', {
					signal: AbortSignal.timeout(1000)
				});
				await response.body?.cancel();
				if (response.ok) return fetch;
			} catch {
				/* Retry until the bounded startup deadline. */
			}
			await scheduler.wait(200);
		}
		await container.destroy();
		throw new Error('The Git sandbox did not become healthy');
	}
}

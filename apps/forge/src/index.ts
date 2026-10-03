import { WorkerEntrypoint } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import {
	repoNamePattern,
	type Author,
	type ForgeApi,
	type Mode,
	type RepoInfo,
	type ThreadDetail,
	type ThreadSummary
} from '@regit/core';
import type { AttemptInput, AttemptSnapshot } from './attempt-sandbox.ts';
import { repos } from '@regit/db';
import { db } from './db.ts';

export { AttemptSandbox } from './attempt-sandbox.ts';
export { GitProxy } from './git-proxy.ts';
export { RepoCoordinator } from './repo-coordinator.ts';
export { Models } from './models.ts';

function assertName(kind: string, name: string) {
	if (!repoNamePattern.test(name))
		throw new Error(
			`${kind} names may only use letters, digits, dots, hyphens and underscores, without a double hyphen`
		);
}

export default class Forge extends WorkerEntrypoint<Env> implements ForgeApi {
	override async fetch(request: Request) {
		const [, kind, repo, action] = new URL(request.url).pathname.split('/');
		if (kind === 'repos' && repo && action === 'live' && repoNamePattern.test(repo)) {
			return this.env.REPOS.getByName(repo).fetch(request);
		}
		return new Response(null, { status: 404 });
	}

	async openThread(
		repo: string,
		input: { author: Author; text: string; mode: Mode }
	): Promise<ThreadSummary> {
		assertName('Repository', repo);
		return this.env.REPOS.getByName(repo).openThread(input);
	}

	async reply(repo: string, thread: string, input: { author: Author; text: string }) {
		await this.env.REPOS.getByName(repo).reply(thread, input);
	}

	async startThread(repo: string, thread: string) {
		await this.env.REPOS.getByName(repo).start(thread);
	}

	async threads(repo: string): Promise<ThreadSummary[]> {
		return this.env.REPOS.getByName(repo).threads();
	}

	async thread(repo: string, id: string): Promise<ThreadDetail | null> {
		return this.env.REPOS.getByName(repo).thread(id);
	}

	async createRepo({
		name,
		source,
		createdBy
	}: {
		name: string;
		source?: string;
		createdBy: string;
	}): Promise<RepoInfo> {
		assertName('Repository', name);
		const [claimed] = await db
			.insert(repos)
			.values({ name, source, createdBy, createdAt: new Date() })
			.onConflictDoNothing()
			.returning();
		if (!claimed) throw new Error(`${name} already exists.`);
		try {
			const repo = await (source
				? this.env.ARTIFACTS.import({ source: { url: source }, target: { name } })
				: this.env.ARTIFACTS.create(name));
			return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
		} catch (error) {
			await db.delete(repos).where(eq(repos.name, name));
			if ((error as ArtifactsError).code === 'ALREADY_EXISTS')
				throw new Error(`${name} already exists.`);
			throw error;
		}
	}

	async startAttempt(thread: string, input: AttemptInput) {
		assertName('Thread', thread);
		assertName('Repository', input.repo);
		await this.env.ATTEMPTS.getByName(thread).start(input);
	}

	async attempt(thread: string): Promise<AttemptSnapshot | null> {
		return this.env.ATTEMPTS.getByName(thread).snapshot();
	}

	async cancelAttempt(thread: string) {
		await this.env.ATTEMPTS.getByName(thread).cancel();
	}
}

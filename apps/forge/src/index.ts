import { WorkerEntrypoint } from 'cloudflare:workers';
import type { Mode } from '@regit/agent';
import type { AttemptInput, AttemptSnapshot } from './attempt-sandbox.ts';
import type { Author, ThreadDetail, ThreadSummary } from './repo-coordinator.ts';

export { AttemptSandbox } from './attempt-sandbox.ts';
export { GitProxy } from './git-proxy.ts';
export { RepoCoordinator } from './repo-coordinator.ts';
export { Models } from './models.ts';

export interface RepoInfo {
	name: string;
	remote: string;
	defaultBranch: string;
}

const validName = /^[A-Za-z0-9._-]+$/;

function assertName(kind: string, name: string) {
	if (!validName.test(name))
		throw new Error(`${kind} names may only use letters, digits, dots, hyphens and underscores`);
}

export default class Forge extends WorkerEntrypoint<Env> {
	override async fetch(request: Request) {
		const [, kind, repo, action] = new URL(request.url).pathname.split('/');
		if (kind === 'repos' && repo && action === 'live' && validName.test(repo)) {
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

	async createRepo(name: string, source?: string): Promise<RepoInfo> {
		assertName('Repository', name);
		const repo = source
			? await this.env.ARTIFACTS.import({ source: { url: source }, target: { name } })
			: await this.env.ARTIFACTS.create(name);
		return { name: repo.name, remote: repo.remote, defaultBranch: repo.defaultBranch };
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

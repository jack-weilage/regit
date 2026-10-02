import { WorkerEntrypoint } from 'cloudflare:workers';
import type { AttemptInput, AttemptSnapshot } from './attempt-sandbox.ts';

export { AttemptSandbox } from './attempt-sandbox.ts';
export { GitProxy } from './git-proxy.ts';
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
	override async fetch() {
		return new Response(null, { status: 404 });
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

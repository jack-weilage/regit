import { WorkerEntrypoint } from 'cloudflare:workers';
import { createRepo, repoExists } from '../src/lib/server/repos.ts';

export default class ReposWorker extends WorkerEntrypoint<Env> {
	async create(input: { name: string; source?: string; createdBy: string }) {
		await createRepo(input);
	}

	usesFakeArtifacts() {
		return (this.env.ARTIFACTS as unknown as { fake(): Promise<boolean> }).fake();
	}

	exists(name: string) {
		return repoExists(name);
	}
}

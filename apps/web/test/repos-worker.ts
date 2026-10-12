import { WorkerEntrypoint } from 'cloudflare:workers';
import { createRepo, repoExists } from '../src/lib/server/repos.ts';
import { canAccessRepository, type RepoRole } from '@regit/db';
import { db } from '../src/lib/server/db.ts';

export default class ReposWorker extends WorkerEntrypoint<Env> {
	async create(input: { name: string; source?: string; principalId: string }) {
		await createRepo(input);
	}

	usesFakeArtifacts() {
		return (this.env.ARTIFACTS as unknown as { fake(): Promise<boolean> }).fake();
	}

	exists(name: string) {
		return repoExists(name);
	}

	allowed(repo: string, id: string | null, role: RepoRole) {
		return canAccessRepository(db(), repo, id, role);
	}
}

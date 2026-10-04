import { WorkerEntrypoint } from 'cloudflare:workers';
import { createGitToken, listGitTokens, revokeGitToken } from '../src/lib/server/git.ts';

export default class TokensWorker extends WorkerEntrypoint<Env> {
	create(input: { repo: string; scope: 'read' | 'write'; days: number; createdBy: string }) {
		return createGitToken({ label: 'Laptop', ...input });
	}

	list(repo: string, createdBy: string) {
		return listGitTokens(repo, createdBy);
	}

	revoke(id: string, createdBy: string) {
		return revokeGitToken(id, createdBy);
	}
}

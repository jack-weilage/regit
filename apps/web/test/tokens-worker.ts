import { WorkerEntrypoint } from 'cloudflare:workers';
import { createGitToken, listGitTokens, revokeGitToken } from '../src/lib/server/git.ts';

export default class TokensWorker extends WorkerEntrypoint<Env> {
	create(input: { repo: string; days: number; principalId: string }) {
		return createGitToken({ label: 'Laptop', ...input });
	}

	list(repo: string, principalId: string) {
		return listGitTokens(repo, principalId);
	}

	revoke(id: string, principalId: string) {
		return revokeGitToken(id, principalId);
	}
}

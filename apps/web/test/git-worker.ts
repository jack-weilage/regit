import { WorkerEntrypoint } from 'cloudflare:workers';
import {
	createGitToken,
	handleGit,
	listGitTokens,
	revokeGitToken,
	type GitScope
} from '../src/lib/server/git.ts';

export default class GitWorker extends WorkerEntrypoint<Env> {
	override fetch(request: Request) {
		return handleGit(request);
	}

	createToken(input: { repo: string; scope: GitScope; days: number; createdBy: string }) {
		return createGitToken({ label: 'laptop', ...input });
	}

	listTokens(repo: string, createdBy: string) {
		return listGitTokens(repo, createdBy);
	}

	revokeToken(id: string, createdBy: string) {
		return revokeGitToken(id, createdBy);
	}
}

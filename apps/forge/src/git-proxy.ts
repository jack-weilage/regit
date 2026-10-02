import { WorkerEntrypoint } from 'cloudflare:workers';
import { proxyGit, type GitAccess } from './git-access.ts';

export class GitProxy extends WorkerEntrypoint<Env, GitAccess> {
	override fetch(request: Request) {
		return proxyGit(request, this.ctx.props);
	}
}

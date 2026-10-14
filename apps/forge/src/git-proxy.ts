import { WorkerEntrypoint } from 'cloudflare:workers';
import { proxyGitTargets, type GitAccess } from './git-access.ts';

export class GitProxy extends WorkerEntrypoint<Env, { targets: GitAccess[] }> {
	override fetch(request: Request) {
		return proxyGitTargets(request, this.ctx.props.targets);
	}
}

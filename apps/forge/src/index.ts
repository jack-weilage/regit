import { previews } from '@regit/db';
import { eq } from 'drizzle-orm';
import { db } from './db.ts';
import { gitIngress } from './git-ingress.ts';

export { AttemptSandbox } from './attempt-sandbox.ts';
export { GitProxy } from './git-proxy.ts';
export { RepositoryGit, PublisherGitProxy } from './repository-git.ts';
export { RepoCoordinator } from './repo-coordinator.ts';
export { Models } from './models.ts';

export default {
	async fetch(request, env) {
		const host = new URL(request.url).hostname;
		if (host === env.GIT_HOST) return gitIngress(request);
		if (!env.PREVIEW_DOMAIN || !host.endsWith(`.${env.PREVIEW_DOMAIN}`)) {
			return new Response(null, { status: 404 });
		}
		// TODO: serve previews from a separate registrable domain so agent-run code can't set cookies on regit.dev
		const id = host.split('.')[0]!.split('-')[0]!;
		const [preview] = await db.select().from(previews).where(eq(previews.id, id));
		if (!preview) return new Response('This preview does not exist', { status: 404 });
		return env.ATTEMPTS.getByName(preview.thread).fetch(request);
	}
} satisfies ExportedHandler<Env>;

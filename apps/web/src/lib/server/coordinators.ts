import type { RepoCoordinatorApi } from '@regit/core';
import { env } from 'cloudflare:workers';

export function coordinatorFor(repo: string) {
	const namespace = env.REPOS as unknown as DurableObjectNamespace<
		RepoCoordinatorApi & Rpc.DurableObjectBranded
	>;
	return namespace.getByName(repo);
}

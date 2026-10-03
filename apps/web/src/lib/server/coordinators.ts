import type { RepoCoordinatorApi } from '@regit/core';
import { env } from 'cloudflare:workers';

export const coordinators = env.REPOS as unknown as DurableObjectNamespace<
	RepoCoordinatorApi & Rpc.DurableObjectBranded
>;

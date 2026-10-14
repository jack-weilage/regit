import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { requireRepoAccess } from '#lib/server/access.ts';
import { coordinatorFor } from '#lib/server/coordinators.ts';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	await requireRepoAccess(params.repo, locals.user?.id);
	const threadRef = await coordinatorFor(params.repo).resolveThread(params.thread);
	if (!threadRef) error(404, 'Thread not found');
	if (params.thread !== String(threadRef.number)) {
		redirect(308, `/${params.repo}/${threadRef.number}${url.search}`);
	}
	return { threadRef };
};

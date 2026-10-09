import { coordinatorFor } from '#lib/server/coordinators.ts';
import { requireRepoAccess } from '#lib/server/access.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, locals }) => {
	await requireRepoAccess(params.repo, locals.user?.id);
	const image = await coordinatorFor(params.repo).image(params.id);
	if (!image) return new Response('Image not found', { status: 404 });
	return new Response(image.data, {
		headers: {
			'Content-Type': image.mime,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
			'Content-Security-Policy': "default-src 'none'; sandbox"
		}
	});
};

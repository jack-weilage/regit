import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { accessUser } from '#lib/server/access.ts';
import { handleGit } from '#lib/server/git.ts';

const developer = { name: 'Developer', email: 'dev@regit.local' };

export const handle: Handle = async ({ event, resolve }) => {
	if (env.GIT_HOST && event.url.hostname === env.GIT_HOST) return handleGit(event.request);
	const user = await accessUser(event.request.headers.get('cf-access-jwt-assertion'), {
		teamDomain: env.ACCESS_TEAM_DOMAIN,
		audience: env.ACCESS_AUD
	});
	if (user) {
		event.locals.user = user;
	} else if (dev) {
		event.locals.user = developer;
	} else {
		error(403, 'Sign in through Cloudflare Access');
	}
	return resolve(event);
};

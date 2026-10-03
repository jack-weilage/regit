import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { accessEmail } from '#lib/server/access.ts';

const developer = { name: 'Developer', email: 'dev@regit.local' };

export const handle: Handle = async ({ event, resolve }) => {
	const email = await accessEmail(event.request.headers.get('cf-access-jwt-assertion'), {
		teamDomain: env.ACCESS_TEAM_DOMAIN,
		audience: env.ACCESS_AUD
	});
	if (email) {
		event.locals.user = { name: email.split('@')[0]!, email };
	} else if (dev) {
		event.locals.user = developer;
	} else {
		error(403, 'Sign in through Cloudflare Access');
	}
	return resolve(event);
};

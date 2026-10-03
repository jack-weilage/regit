import { dev } from '$app/env';
import { error } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';

const developer = { name: 'Developer', email: 'dev@regit.local' };

// TODO: verify the Cf-Access-Jwt-Assertion signature instead of trusting the email header Access adds
export const handle: Handle = async ({ event, resolve }) => {
	const email = event.request.headers.get('cf-access-authenticated-user-email');
	if (email) {
		event.locals.user = { name: email.split('@')[0]!, email };
	} else if (dev) {
		event.locals.user = developer;
	} else {
		error(403, 'Sign in through Cloudflare Access');
	}
	return resolve(event);
};

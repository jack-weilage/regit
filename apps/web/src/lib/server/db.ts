import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/d1';

export function db() {
	return drizzle(env.DB);
}

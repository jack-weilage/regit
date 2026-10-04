import { env } from 'cloudflare:workers';
import { gitTokens, gitTokenPrefix, hashGitToken } from '@regit/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';

const endpoints = /^\/([A-Za-z0-9._-]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const scopes: Record<string, 'read' | 'write'> = {
	'git-upload-pack': 'read',
	'git-receive-pack': 'write'
};
const forwarded = ['content-type', 'accept', 'git-protocol', 'content-encoding', 'user-agent'];
const returned = ['content-type', 'cache-control', 'expires', 'pragma'];

export default {
	// TODO: keep main fast-forward only and tell the repository's coordinator when main moves
	async fetch(request) {
		const url = new URL(request.url);
		const match = endpoints.exec(url.pathname);
		if (!match) return reply('Not found', 404);
		const [, repo, endpoint] = match as unknown as [string, string, string];
		const service = endpoint === 'info/refs' ? url.searchParams.get('service') : endpoint;
		const scope = service ? scopes[service] : undefined;
		if (!scope) return reply('ReGit only serves the smart HTTP protocol', 403);

		const token = await authenticate(request);
		if (!token) {
			return reply('Use a ReGit access token as the password', 401, {
				'WWW-Authenticate': 'Basic realm="ReGit", charset="UTF-8"'
			});
		}
		if (token.repo !== repo) return reply(`This token doesn't grant access to ${repo}`, 403);
		if (scope === 'write' && token.scope !== 'write') {
			return reply(`This token can't push to ${repo}`, 403);
		}
		await drizzle(env.DB)
			.update(gitTokens)
			.set({ lastUsedAt: new Date() })
			.where(eq(gitTokens.id, token.id));

		using artifact = await env.ARTIFACTS.get(repo);
		const [{ remote }, { plaintext }] = await Promise.all([
			artifact.info(),
			artifact.createToken(scope, 10 * 60)
		]);
		const headers = new Headers({ Authorization: `Bearer ${plaintext}` });
		for (const name of forwarded) {
			const value = request.headers.get(name);
			if (value) headers.set(name, value);
		}
		const response = await fetch(`${remote}/${endpoint}${url.search}`, {
			method: request.method,
			headers,
			body: request.method === 'POST' ? request.body : undefined
		});
		const out = new Headers();
		for (const name of returned) {
			const value = response.headers.get(name);
			if (value) out.set(name, value);
		}
		return new Response(response.body, { status: response.status, headers: out });
	}
} satisfies ExportedHandler<Env>;

async function authenticate(request: Request) {
	const [kind, encoded] = (request.headers.get('authorization') ?? '').split(' ');
	if (kind?.toLowerCase() !== 'basic' || !encoded) return null;
	let decoded: string;
	try {
		decoded = atob(encoded);
	} catch {
		return null;
	}
	const separator = decoded.indexOf(':');
	const user = separator < 0 ? decoded : decoded.slice(0, separator);
	const password = separator < 0 ? '' : decoded.slice(separator + 1);
	const secret = password || user;
	if (!secret.startsWith(gitTokenPrefix)) return null;
	const [token] = await drizzle(env.DB)
		.select()
		.from(gitTokens)
		.where(eq(gitTokens.hash, await hashGitToken(secret)));
	if (!token || token.expiresAt.getTime() <= Date.now()) return null;
	return token;
}

function reply(text: string, status: number, headers: Record<string, string> = {}) {
	return new Response(`${text}\n`, {
		status,
		headers: { 'Content-Type': 'text/plain', ...headers }
	});
}

import { env } from 'cloudflare:workers';
import { canAccessRepository, gitTokens, gitTokenPrefix, hashGitToken } from '@regit/db';
import { eq } from 'drizzle-orm';
import { db } from './db.ts';

const endpoints = /^\/([A-Za-z0-9._-]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const forwarded = ['content-type', 'accept', 'git-protocol', 'content-encoding', 'user-agent'];
const returned = ['content-type', 'cache-control', 'expires', 'pragma'];

export async function gitIngress(request: Request) {
	const url = new URL(request.url);
	const match = endpoints.exec(url.pathname);
	if (!match) return reply('Not found', 404);
	const repo = match[1]!;
	const endpoint = match[2]!;
	const service = endpoint === 'info/refs' ? url.searchParams.get('service') : endpoint;
	// TODO: add a contribution fork API and local CLI; canonical writes stay exclusively in RepositoryGit.
	if (service !== 'git-upload-pack') return reply('ReGit Git ingress is read-only', 403);
	if (request.method !== (endpoint === 'info/refs' ? 'GET' : 'POST')) {
		return reply('Method not allowed', 405);
	}
	const token = await authenticate(request);
	if (!token) {
		return reply('Use a ReGit access token as the password', 401, {
			'WWW-Authenticate': 'Basic realm="ReGit", charset="UTF-8"'
		});
	}
	if (token.repo !== repo) return reply(`This token doesn't grant access to ${repo}`, 403);
	if (!(await canAccessRepository(db, repo, token.principalId))) {
		return reply('Repository membership required', 403);
	}
	await db.update(gitTokens).set({ lastUsedAt: new Date() }).where(eq(gitTokens.id, token.id));

	using artifact = await env.ARTIFACTS.get(repo);
	const [{ remote }, { plaintext }] = await Promise.all([
		artifact.info(),
		artifact.createToken('read', 10 * 60)
	]);
	const headers = new Headers({ Authorization: `Bearer ${plaintext}` });
	for (const name of forwarded) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	const response = await fetch(`${remote}/${endpoint}${url.search}`, {
		method: request.method,
		headers,
		body: request.method === 'POST' ? request.body : undefined,
		redirect: 'manual'
	});
	const out = new Headers();
	for (const name of returned) {
		const value = response.headers.get(name);
		if (value) out.set(name, value);
	}
	return new Response(response.body, { status: response.status, headers: out });
}

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
	const [token] = await db
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

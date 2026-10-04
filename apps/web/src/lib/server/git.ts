import { env } from 'cloudflare:workers';
import { gitTokens } from '@regit/db';
import { and, eq } from 'drizzle-orm';
import { db } from './db.ts';

export type GitScope = 'read' | 'write';

const endpoints = /^\/([A-Za-z0-9._-]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;
const scopes: Record<string, GitScope> = { 'git-upload-pack': 'read', 'git-receive-pack': 'write' };
const forwarded = ['content-type', 'accept', 'git-protocol', 'content-encoding', 'user-agent'];
const returned = ['content-type', 'cache-control', 'expires', 'pragma'];
const day = 24 * 60 * 60 * 1000;

// TODO: keep main fast-forward only and tell the repository's coordinator when main moves
export async function handleGit(request: Request) {
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
	await db().update(gitTokens).set({ lastUsedAt: new Date() }).where(eq(gitTokens.id, token.id));

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
	if (!secret.startsWith('regit_')) return null;
	const [token] = await db()
		.select()
		.from(gitTokens)
		.where(eq(gitTokens.hash, await digest(secret)));
	if (!token || token.expiresAt.getTime() <= Date.now()) return null;
	return token;
}

export async function createGitToken(input: {
	repo: string;
	scope: GitScope;
	label: string;
	days: number;
	createdBy: string;
}) {
	const secret = `regit_${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
	const now = Date.now();
	const [token] = await db()
		.insert(gitTokens)
		.values({
			id: crypto.randomUUID(),
			hash: await digest(secret),
			repo: input.repo,
			scope: input.scope,
			label: input.label,
			createdBy: input.createdBy,
			createdAt: new Date(now),
			expiresAt: new Date(now + input.days * day)
		})
		.returning();
	return { ...view(token!), secret };
}

export async function listGitTokens(repo: string, createdBy: string) {
	const tokens = await db()
		.select()
		.from(gitTokens)
		.where(and(eq(gitTokens.repo, repo), eq(gitTokens.createdBy, createdBy)))
		.orderBy(gitTokens.createdAt);
	return tokens.map(view);
}

export async function revokeGitToken(id: string, createdBy: string) {
	await db()
		.delete(gitTokens)
		.where(and(eq(gitTokens.id, id), eq(gitTokens.createdBy, createdBy)));
}

function view({ hash: _, ...token }: typeof gitTokens.$inferSelect) {
	return {
		...token,
		createdAt: token.createdAt.getTime(),
		expiresAt: token.expiresAt.getTime(),
		lastUsedAt: token.lastUsedAt?.getTime() ?? null
	};
}

async function digest(secret: string) {
	return hex(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
	);
}

function hex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function reply(text: string, status: number, headers: Record<string, string> = {}) {
	return new Response(`${text}\n`, {
		status,
		headers: { 'Content-Type': 'text/plain', ...headers }
	});
}

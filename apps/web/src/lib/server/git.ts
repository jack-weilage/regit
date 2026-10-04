import { gitTokens, hashGitToken, newGitToken } from '@regit/db';
import { and, eq } from 'drizzle-orm';
import { db } from './db.ts';

const day = 24 * 60 * 60 * 1000;

export async function createGitToken(input: {
	repo: string;
	scope: 'read' | 'write';
	label: string;
	days: number;
	createdBy: string;
}) {
	const secret = newGitToken();
	const now = Date.now();
	const [token] = await db()
		.insert(gitTokens)
		.values({
			id: crypto.randomUUID(),
			hash: await hashGitToken(secret),
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

import { gitTokens, hashGitToken, newGitToken } from '@regit/db';
import { and, eq } from 'drizzle-orm';
import { db } from './db.ts';

const day = 24 * 60 * 60 * 1000;

export async function createGitToken(input: {
	repo: string;
	label: string;
	days: number;
	principalId: string;
}) {
	// TODO: External contribution/API access requires a separately authorized write boundary.
	const secret = newGitToken();
	const now = Date.now();
	const [token] = await db()
		.insert(gitTokens)
		.values({
			id: crypto.randomUUID(),
			principalId: input.principalId,
			hash: await hashGitToken(secret),
			repo: input.repo,
			label: input.label,
			createdAt: new Date(now),
			expiresAt: new Date(now + input.days * day)
		})
		.returning();
	return { ...view(token!), secret };
}

export async function listGitTokens(repo: string, principalId: string) {
	const tokens = await db()
		.select()
		.from(gitTokens)
		.where(and(eq(gitTokens.repo, repo), eq(gitTokens.principalId, principalId)))
		.orderBy(gitTokens.createdAt);
	return tokens.map(view);
}

export async function revokeGitToken(id: string, principalId: string, repo?: string) {
	await db()
		.delete(gitTokens)
		.where(
			and(
				eq(gitTokens.id, id),
				eq(gitTokens.principalId, principalId),
				repo ? eq(gitTokens.repo, repo) : undefined
			)
		);
}

function view({ hash: _, ...token }: typeof gitTokens.$inferSelect) {
	return {
		...token,
		createdAt: token.createdAt.getTime(),
		expiresAt: token.expiresAt.getTime(),
		lastUsedAt: token.lastUsedAt?.getTime() ?? null
	};
}

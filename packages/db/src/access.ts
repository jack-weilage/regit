import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { repoMembers } from './schema.ts';

export type RepoRole = 'viewer' | 'editor' | 'owner';

export function principalId(issuer: string, subject: string) {
	return JSON.stringify([issuer, subject]);
}

export async function repositoryRole(
	database: DrizzleD1Database,
	repo: string,
	id: string | null | undefined
): Promise<RepoRole | null> {
	if (!id) return null;
	const [member] = await database
		.select()
		.from(repoMembers)
		.where(and(eq(repoMembers.repo, repo), eq(repoMembers.principalId, id)));
	return member?.role ?? null;
}

export async function canAccessRepository(
	database: DrizzleD1Database,
	repo: string,
	id: string | null | undefined,
	required: RepoRole = 'viewer'
) {
	const role = await repositoryRole(database, repo, id);
	const rank = { viewer: 0, editor: 1, owner: 2 };
	return role !== null && rank[role] >= rank[required];
}

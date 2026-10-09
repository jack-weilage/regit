import { and, eq } from 'drizzle-orm';
import type { AnyD1Database, DrizzleD1Database } from 'drizzle-orm/d1';
import { repoMembers } from './schema.ts';

export type RepoRole = 'viewer' | 'editor' | 'owner';
export interface Principal {
	id: string;
	email: string;
	name: string;
}

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

// Legacy email ownership is claimed only by an authenticated identity, once per repository.
// No SQL migration guesses subjects from emails; the first verified matching identity claims it.
export async function claimLegacyRepositories(database: AnyD1Database, principal: Principal) {
	await database.batch([
		database
			.prepare(
				`INSERT INTO repo_members (repo, principal_id, role) SELECT name, ?, 'owner' FROM repos WHERE created_by = ? AND creator_principal_id IS NULL ON CONFLICT DO NOTHING`
			)
			.bind(principal.id, principal.email),
		database
			.prepare(
				'UPDATE repos SET creator_principal_id = ? WHERE created_by = ? AND creator_principal_id IS NULL'
			)
			.bind(principal.id, principal.email),
		database
			.prepare(
				'UPDATE git_tokens SET principal_id = ? WHERE created_by = ? AND principal_id IS NULL'
			)
			.bind(principal.id, principal.email)
	]);
}

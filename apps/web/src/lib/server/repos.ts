import { env } from 'cloudflare:workers';
import { repos } from '@regit/db';
import { eq } from 'drizzle-orm';
import { db } from './db.ts';

const problems: Partial<Record<ArtifactsErrorCode, string>> = {
	INVALID_URL: "That URL doesn't point to a git repository.",
	NOT_FOUND: "That repository doesn't exist.",
	REMOTE_AUTH_REQUIRED:
		'That repository is private. Only public repositories can be imported for now.',
	MEMORY_LIMIT: 'That repository is too large to import.'
};

export class RepoError extends Error {}

export async function repoExists(name: string) {
	const [row] = await db().select({ name: repos.name }).from(repos).where(eq(repos.name, name));
	return !!row;
}

export async function createRepo({
	name,
	source,
	createdBy
}: {
	name: string;
	source?: string;
	createdBy: string;
}) {
	const [claimed] = await db()
		.insert(repos)
		.values({ name, source, createdBy, createdAt: new Date() })
		.onConflictDoNothing()
		.returning();
	if (!claimed) throw new RepoError(`${name} already exists.`);
	try {
		await (source
			? env.ARTIFACTS.import({ source: { url: source }, target: { name } })
			: env.ARTIFACTS.create(name));
	} catch (error) {
		await db().delete(repos).where(eq(repos.name, name));
		const code = (error as ArtifactsError).code;
		if (code === 'ALREADY_EXISTS') throw new RepoError(`${name} already exists.`);
		const problem = code && problems[code];
		if (problem) throw new RepoError(problem);
		throw error;
	}
}

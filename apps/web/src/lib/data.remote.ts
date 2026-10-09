import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import { machines, repoNamePattern, type Machine } from '@regit/core';
import { repos, repoMembers, type RepoRole } from '@regit/db';
import { and, asc, eq } from 'drizzle-orm';
import * as v from 'valibot';
import { coordinatorFor } from '#lib/server/coordinators.ts';
import { db } from '#lib/server/db.ts';
import { createGitToken, listGitTokens, revokeGitToken } from '#lib/server/git.ts';
import { createRepo as create, RepoError } from '#lib/server/repos.ts';
import { requireRepoAccess } from '#lib/server/access.ts';

const name = v.pipe(v.string(), v.regex(repoNamePattern));
const text = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20_000));
const thread = v.object({ repo: name, id: name });

function author() {
	const { id, name } = getRequestEvent().locals.user;
	return { id, name, kind: 'person' as const };
}

async function coordinator(repo: string, role: RepoRole = 'viewer') {
	await requireRepoAccess(repo, getRequestEvent().locals.user?.id, role);
	return coordinatorFor(repo);
}

export const getUser = query(async () => getRequestEvent().locals.user);

export const getRepos = query(() =>
	db()
		.select({ name: repos.name, machine: repos.machine })
		.from(repos)
		.innerJoin(repoMembers, eq(repoMembers.repo, repos.name))
		.where(eq(repoMembers.principalId, getRequestEvent().locals.user.id))
		.orderBy(asc(repos.name))
);

export const getThreads = query(name, async (repo) => (await coordinator(repo)).threads());

export const getThread = query(thread, async ({ repo, id }) =>
	(await coordinator(repo)).thread(id)
);

export const createRepo = command(
	v.object({ name, source: v.optional(v.pipe(v.string(), v.url())) }),
	async ({ name, source }) => {
		try {
			await create({
				name,
				source,
				createdBy: getRequestEvent().locals.user.email,
				principalId: getRequestEvent().locals.user.id
			});
		} catch (cause) {
			if (cause instanceof RepoError) error(400, cause.message);
			throw cause;
		}
		getRepos().refresh();
	}
);

export const openThread = command(
	v.object({
		repo: name,
		text,
		mode: v.picklist(['auto', 'small', 'medium', 'large']),
		machine: v.picklist(Object.keys(machines) as Machine[])
	}),
	async ({ repo, text, mode, machine }) => {
		const summary = await (
			await coordinator(repo, 'editor')
		).openThread({ repo, author: author(), text, mode, machine });
		await db().update(repos).set({ machine }).where(eq(repos.name, repo));
		getThreads(repo).refresh();
		getRepos().refresh();
		return summary;
	}
);

export const reply = command(v.object({ ...thread.entries, text }), async ({ repo, id, text }) => {
	await (await coordinator(repo, 'editor')).reply(id, { author: author(), text });
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const startThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).start(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

// TODO: Define the acceptance boundary for local CLI and other agent access.
export const acceptThreadIntent = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).acceptIntent(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const approveThreadPromotion = command(
	v.object({ ...thread.entries, promotion: v.pipe(v.string(), v.minLength(1)) }),
	async ({ repo, id, promotion }) => {
		await (await coordinator(repo, 'owner')).approvePromotion(id, promotion, author());
		getThread({ repo, id }).refresh();
		getThreads(repo).refresh();
	}
);

export const pinThreadDependency = command(
	v.object({ ...thread.entries, dependency: name }),
	async ({ repo, id, dependency }) => {
		await (await coordinator(repo, 'editor')).pinDependency(id, dependency, author());
		getThread({ repo, id }).refresh();
		getThreads(repo).refresh();
	}
);

export const unpinThreadDependency = command(
	v.object({ ...thread.entries, dependency: name }),
	async ({ repo, id, dependency }) => {
		await (await coordinator(repo, 'editor')).unpinDependency(id, dependency, author());
		getThread({ repo, id }).refresh();
		getThreads(repo).refresh();
	}
);

export const discardThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).discard(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const reopenThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).reopen(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const deleteThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).delete(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const restoreThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).restore(id);
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const getChanges = query(thread, async ({ repo, id }) =>
	(await coordinator(repo)).changes(id)
);

export const shipThread = command(
	v.object({
		...thread.entries,
		title: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)),
		body: v.pipe(v.string(), v.trim(), v.maxLength(20_000))
	}),
	async ({ repo, id, title, body }) => {
		const { email } = getRequestEvent().locals.user;
		await (await coordinator(repo, 'owner')).ship(id, { by: author(), email, title, body });
		getThread({ repo, id }).refresh();
		getThreads(repo).refresh();
	}
);

const suggestion = v.object({ ...thread.entries, entry: v.pipe(v.string(), v.regex(/^e\d+$/)) });

export const spinOff = command(suggestion, async ({ repo, id, entry }) => {
	const child = await (await coordinator(repo, 'editor')).spinOff(id, entry, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
	return child;
});

export const dismissSuggestion = command(suggestion, async ({ repo, id, entry }) => {
	await (await coordinator(repo, 'editor')).dismissSuggestion(id, entry, author());
	getThread({ repo, id }).refresh();
});

const service = v.object({ ...thread.entries, name: v.pipe(v.string(), v.regex(/^[\w.-]+$/)) });

export const serviceAction = command(
	v.object({ ...service.entries, action: v.picklist(['start', 'stop', 'restart']) }),
	async ({ repo, id, name, action }) => {
		await (await coordinator(repo, 'editor')).serviceAction(id, action, name);
		getThread({ repo, id }).refresh();
	}
);

export const readServiceLogs = command(service, async ({ repo, id, name }) =>
	(await coordinator(repo)).serviceLogs(id, name)
);

export const stopThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo, 'editor')).stop(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const assessRequest = query(
	v.object({ repo: name, text: v.pipe(v.string(), v.trim(), v.maxLength(2000)) }),
	async ({ repo, text }) => {
		const target = await coordinator(repo);
		return text.length < 8 ? null : target.assess(text);
	}
);

export const forwardIntent = command(
	v.object({ ...thread.entries, to: name }),
	async ({ repo, id, to }) => {
		await (await coordinator(repo, 'editor')).forwardIntent(id, to, author());
		getThread({ repo, id }).refresh();
	}
);

export const getGitAccess = query(name, async (repo) => {
	await coordinator(repo);
	return {
		url: `https://${env.GIT_HOST}/${repo}.git`,
		tokens: await listGitTokens(repo, getRequestEvent().locals.user.id)
	};
});

export const createGitAccessToken = command(
	v.object({
		repo: name,
		label: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(60)),
		scope: v.picklist(['read', 'write']),
		days: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(365))
	}),
	async ({ repo, ...token }) => {
		await coordinator(repo, 'editor');
		if (token.scope !== 'read') error(400, 'Write Git tokens are not supported');
		const created = await createGitToken({
			repo,
			...token,
			createdBy: getRequestEvent().locals.user.email,
			principalId: getRequestEvent().locals.user.id
		});
		getGitAccess(repo).refresh();
		return { label: created.label, secret: created.secret };
	}
);

export const revokeGitAccessToken = command(
	v.object({ repo: name, id: v.pipe(v.string(), v.uuid()) }),
	async ({ repo, id }) => {
		await coordinator(repo, 'editor');
		await revokeGitToken(id, getRequestEvent().locals.user.id, repo);
		getGitAccess(repo).refresh();
	}
);

const member = v.object({
	repo: name,
	principalId: v.pipe(v.string(), v.minLength(1), v.maxLength(2048))
});

export const getRepoMembers = query(name, async (repo) => {
	await coordinator(repo, 'owner');
	return db().select().from(repoMembers).where(eq(repoMembers.repo, repo));
});

export const grantRepoMember = command(
	v.object({ ...member.entries, role: v.picklist(['viewer', 'editor', 'owner']) }),
	async ({ repo, principalId, role }) => {
		await coordinator(repo, 'owner');
		if (principalId === getRequestEvent().locals.user.id && role !== 'owner')
			error(400, 'Owners cannot demote themselves');
		await db()
			.insert(repoMembers)
			.values({ repo, principalId, role })
			.onConflictDoUpdate({ target: [repoMembers.repo, repoMembers.principalId], set: { role } });
		getRepoMembers(repo).refresh();
	}
);

export const revokeRepoMember = command(member, async ({ repo, principalId }) => {
	await coordinator(repo, 'owner');
	if (principalId === getRequestEvent().locals.user.id)
		error(400, 'Owners cannot revoke themselves');
	await db()
		.delete(repoMembers)
		.where(and(eq(repoMembers.repo, repo), eq(repoMembers.principalId, principalId)));
	getRepoMembers(repo).refresh();
});

import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { repoNamePattern } from '@regit/core';
import { repos } from '@regit/db';
import { asc } from 'drizzle-orm';
import * as v from 'valibot';
import { coordinatorFor } from '#lib/server/coordinators.ts';
import { db } from '#lib/server/db.ts';
import { createRepo as create, repoExists, RepoError } from '#lib/server/repos.ts';

const name = v.pipe(v.string(), v.regex(repoNamePattern));
const text = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20_000));
const thread = v.object({ repo: name, id: name });

function author() {
	return { name: getRequestEvent().locals.user.name, kind: 'person' as const };
}

async function coordinator(repo: string) {
	if (!(await repoExists(repo))) error(404, `There is no repository named ${repo}`);
	return coordinatorFor(repo);
}

export const getUser = query(async () => getRequestEvent().locals.user);

export const getRepos = query(() =>
	db().select({ name: repos.name }).from(repos).orderBy(asc(repos.name))
);

export const getThreads = query(name, async (repo) => (await coordinator(repo)).threads());

export const getThread = query(thread, async ({ repo, id }) =>
	(await coordinator(repo)).thread(id)
);

export const createRepo = command(
	v.object({ name, source: v.optional(v.pipe(v.string(), v.url())) }),
	async ({ name, source }) => {
		try {
			await create({ name, source, createdBy: getRequestEvent().locals.user.email });
		} catch (cause) {
			if (cause instanceof RepoError) error(400, cause.message);
			throw cause;
		}
		getRepos().refresh();
	}
);

export const openThread = command(
	v.object({ repo: name, text, mode: v.picklist(['small', 'medium', 'large']) }),
	async ({ repo, text, mode }) => {
		const summary = await (await coordinator(repo)).openThread({ author: author(), text, mode });
		getThreads(repo).refresh();
		return summary;
	}
);

export const reply = command(v.object({ ...thread.entries, text }), async ({ repo, id, text }) => {
	await (await coordinator(repo)).reply(id, { author: author(), text });
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const startThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo)).start(id);
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const discardThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo)).discard(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const reopenThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo)).reopen(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const deleteThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo)).delete(id, author());
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const restoreThread = command(thread, async ({ repo, id }) => {
	await (await coordinator(repo)).restore(id);
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

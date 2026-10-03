import { command, getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { repoNamePattern } from '@regit/core';
import * as v from 'valibot';
import { repos } from '@regit/db';
import { asc } from 'drizzle-orm';
import { db } from '#lib/server/db.ts';
import { forge } from '#lib/server/forge.ts';

const name = v.pipe(v.string(), v.regex(repoNamePattern));
const text = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(20_000));
const thread = v.object({ repo: name, id: name });

function author() {
	return { name: getRequestEvent().locals.user.name, kind: 'person' as const };
}

export const getUser = query(async () => getRequestEvent().locals.user);

export const getRepos = query(() =>
	db.select({ name: repos.name }).from(repos).orderBy(asc(repos.name))
);

export const getThreads = query(name, (repo) => forge.threads(repo));

export const getThread = query(thread, ({ repo, id }) => forge.thread(repo, id));

export const createRepo = command(
	v.object({ name, source: v.optional(v.pipe(v.string(), v.url())) }),
	async ({ name, source }) => {
		const repo = await forge
			.createRepo({ name, source, createdBy: getRequestEvent().locals.user.email })
			.catch((cause: Error) => error(400, cause.message));
		getRepos().refresh();
		return repo;
	}
);

export const openThread = command(
	v.object({ repo: name, text, mode: v.picklist(['small', 'medium', 'large']) }),
	async ({ repo, text, mode }) => {
		const summary = await forge.openThread(repo, { author: author(), text, mode });
		getThreads(repo).refresh();
		return summary;
	}
);

export const reply = command(v.object({ ...thread.entries, text }), async ({ repo, id, text }) => {
	await forge.reply(repo, id, { author: author(), text });
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

export const startThread = command(thread, async ({ repo, id }) => {
	await forge.startThread(repo, id);
	getThread({ repo, id }).refresh();
	getThreads(repo).refresh();
});

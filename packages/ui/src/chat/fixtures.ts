import type { DiffFile, DiffHunk, Mentionable, SimilarThread } from './types.ts';
import type { Intent } from '@regit/core';

export const intent: Intent = {
	headline: 'perf(settings): load members lazily',
	purpose: 'Large organizations should not wait for every member before settings render.',
	doneWhen: ['Settings render before member loading completes.', 'Members load as you scroll.']
};

export const people: Mentionable[] = [
	{ kind: 'person', handle: 'sam', label: 'Sam Rivera' },
	{ kind: 'person', handle: 'lin', label: 'Lin Wei' },
	{ kind: 'person', handle: 'mira', label: 'Mira Kask' },
	{ kind: 'person', handle: 'noor', label: 'Noor Haddad' }
];

export const similarThreads: SimilarThread[] = [
	{
		kind: 'thread',
		handle: 'paginate-members',
		label: 'perf(settings): load org members in pages',
		href: '#',
		relation: 'same',
		status: 'running'
	},
	{
		kind: 'thread',
		handle: 'rename-user-id',
		label: 'feat(api): rename user id to account id',
		href: '#',
		relation: 'overlap',
		status: 'running'
	},
	{
		kind: 'thread',
		handle: 'cache-org-settings',
		label: 'Cache org settings',
		href: '#',
		relation: 'related',
		status: 'shipped',
		detail: 'Shipped in 4f2a91c'
	},
	{
		kind: 'thread',
		handle: 'audit-log-retention',
		label: 'Audit log retention',
		href: '#',
		relation: 'related',
		status: 'discarded',
		detail: 'Discarded 3 days ago'
	}
];

export const threads: Mentionable[] = [
	{
		kind: 'thread',
		handle: 'paginate-member-list',
		label: 'Paginate the member list',
		detail: 'Discarded',
		href: '#'
	},
	{
		kind: 'thread',
		handle: 'cache-org-settings',
		label: 'Cache org settings',
		detail: 'Shipped',
		href: '#'
	},
	{
		kind: 'thread',
		handle: 'audit-log-retention',
		label: 'Audit log retention',
		detail: 'Open',
		href: '#'
	}
];

export const mentionables = [...people, ...threads];

function hunk(
	skipped: number,
	start: [number, number],
	lines: string[],
	context?: string
): DiffHunk {
	let [old, next] = start;
	return {
		skipped,
		context,
		lines: lines.map((line) => {
			const text = line.slice(2);
			if (line.startsWith('+')) return { kind: 'added', new: next++, text };
			if (line.startsWith('-')) return { kind: 'removed', old: old++, text };
			return { kind: 'context', old: old++, new: next++, text };
		})
	};
}

export const diffFiles: DiffFile[] = [
	{
		path: 'src/routes/settings/+page.server.ts',
		change: 'modified',
		additions: 6,
		deletions: 4,
		hunks: [
			hunk(
				0,
				[1, 1],
				[
					"  import { error } from '@sveltejs/kit';",
					"- import { allMembers } from '$lib/members';",
					"+ import { memberPage } from '$lib/members';",
					"  import { lastChange } from '$lib/audit';",
					''
				]
			),
			hunk(
				8,
				[13, 13],
				[
					'  	const org = await orgs.get(params.org);',
					"  	if (!org) error(404, 'No such org');",
					'- 	const members = await allMembers(org.id);',
					'- 	const audit = await auditLog(org.id);',
					'+ 	const [members, change] = await Promise.all([',
					'+ 		memberPage(org.id, { limit: 50 }),',
					'+ 		lastChange(org.id)',
					'+ 	]);',
					'- 	return { org, members, lastChange: audit.at(-1) };',
					'+ 	return { org, members, lastChange: change };',
					'  }'
				],
				'export async function load({ params })'
			)
		]
	},
	{
		path: 'src/lib/members.ts',
		change: 'modified',
		additions: 7,
		deletions: 3,
		hunks: [
			hunk(
				22,
				[23, 23],
				[
					'- export async function allMembers(org: string) {',
					'- 	return db.select().from(members).where(eq(members.org, org));',
					'- }',
					'+ export async function memberPage(org: string, { limit, after }: Page) {',
					'+ 	return db',
					'+ 		.select()',
					'+ 		.from(members)',
					'+ 		.where(and(eq(members.org, org), after ? gt(members.id, after) : undefined))',
					'+ 		.orderBy(members.id)',
					'+ 		.limit(limit);',
					'+ }',
					'',
					'  export function memberCount(org: string) {'
				]
			)
		]
	},
	{
		path: 'src/lib/members.test.ts',
		change: 'added',
		additions: 7,
		deletions: 0,
		hunks: [
			hunk(
				0,
				[0, 1],
				[
					"+ import { expect, test } from 'vitest';",
					"+ import { memberPage } from './members';",
					'+ ',
					"+ test('pages through an org of 5,000 members', async () => {",
					"+ 	const first = await memberPage('acme', { limit: 50 });",
					'+ 	expect(first).toHaveLength(50);',
					'+ });'
				]
			)
		]
	},
	{
		path: 'src/lib/audit.ts',
		oldPath: 'src/lib/audit-log.ts',
		change: 'renamed',
		additions: 3,
		deletions: 1,
		hunks: [
			hunk(
				4,
				[5, 5],
				[
					'- export const auditLog = (org: string) => db.query.audit.findMany({ where: { org } });',
					'+ export const lastChange = (org: string) =>',
					"+ 	db.query.audit.findFirst({ where: { org }, orderBy: { at: 'desc' } });",
					'+ '
				]
			)
		]
	}
];

export const unusualDiffFiles: DiffFile[] = [
	{
		path: 'static/og.png',
		change: 'modified',
		additions: 0,
		deletions: 0,
		hunks: [],
		binary: true
	},
	{
		path: 'src/lib/generated/schema.ts',
		change: 'modified',
		additions: 1_204,
		deletions: 988,
		hunks: [hunk(0, [1, 1], ['- // generated', '+ // generated by drizzle-kit'])],
		tooLarge: true
	},
	{
		path: 'docs/old-settings.md',
		change: 'deleted',
		additions: 0,
		deletions: 2,
		hunks: [hunk(0, [1, 0], ['- # Settings', '- Loads every member up front.'])]
	}
];

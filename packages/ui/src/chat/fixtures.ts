import type { DiffFile, DiffHunk, Mentionable, SimilarThread } from './types.ts';
import type { ChildThreadView } from './ChildThreads.svelte';
import type { Automation, Intent } from '@regit/core';

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
		status: 'working'
	},
	{
		kind: 'thread',
		handle: 'rename-user-id',
		label: 'feat(api): rename user id to account id',
		href: '#',
		relation: 'overlap',
		status: 'working'
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
		status: 'archived',
		detail: 'Archived 3 days ago'
	}
];

export const threads: Mentionable[] = [
	{
		kind: 'thread',
		handle: 'paginate-member-list',
		label: 'Paginate the member list',
		detail: 'Archived',
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

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

// A fixed moment, so stories render the same relative times.
export const automationsNow = Date.parse('2026-10-14T10:00:00Z');

export const automations: Automation[] = [
	{
		id: 'a1b2c3d4',
		thread: 't1',
		name: 'post-deploy-check',
		on: { event: 'deployed' },
		delayMs: 15 * minute,
		message: 'Check error rates and how long the settings page takes to load against the deploy.',
		runs: { done: 0, limit: 1 },
		createdAt: automationsNow - hour,
		expiresAt: automationsNow + 30 * day - hour,
		nextAt: null,
		lastRunAt: null,
		ended: null
	},
	{
		id: 'e5f6a7b8',
		thread: 't1',
		name: 'flaky-e2e',
		on: { schedule: '0 9 * * 1-5', timezone: 'Europe/Berlin' },
		delayMs: 0,
		message: 'Re-run the e2e suite on main and report whether login.spec is still flaky.',
		runs: { done: 2, limit: 5 },
		createdAt: automationsNow - 2 * day,
		expiresAt: automationsNow + 12 * day,
		nextAt: automationsNow + 21 * hour,
		lastRunAt: automationsNow - 3 * hour,
		ended: null
	},
	{
		id: 'c9d0e1f2',
		thread: 't1',
		name: 'flag-cleanup',
		on: { after: '3d' },
		delayMs: 0,
		message: 'Remove the lazy-members feature flag if nobody reported problems.',
		runs: { done: 0, limit: 1 },
		createdAt: automationsNow - day,
		expiresAt: automationsNow + 29 * day,
		nextAt: automationsNow + 2 * day,
		lastRunAt: null,
		ended: null
	}
];

export const endedAutomations: Automation[] = [
	{
		...automations[0]!,
		id: 'f3a4b5c6',
		name: 'ship-check',
		on: { event: 'shipped' },
		delayMs: 0,
		runs: { done: 1, limit: 1 },
		ended: { at: automationsNow - 5 * hour, reason: 'runs' }
	},
	{
		...automations[2]!,
		id: 'd7e8f9a0',
		name: 'nightly-bench',
		on: { schedule: '0 2 * * *' },
		runs: { done: 0, limit: 50 },
		ended: { at: automationsNow - 2 * hour, reason: 'cancelled', by: 'Sam Rivera' }
	}
];

export const childThreads: ChildThreadView[] = [
	{
		id: 'c1',
		number: 12,
		headline: 'feat(ui): board of child threads',
		status: 'working',
		href: '/regit/12',
		doneWhen: { met: 1, total: 4 },
		previews: [{ name: 'storybook', href: 'https://c1-storybook.regit.run' }]
	},
	{
		id: 'c2',
		number: 13,
		headline: 'feat(threads): tell a parent about its children',
		status: 'idle',
		needsYou: true,
		href: '/regit/13',
		doneWhen: { met: 2, total: 3 },
		previews: [
			{ name: 'web', href: 'https://c2-web.regit.run' },
			{ name: 'storybook', href: 'https://c2-storybook.regit.run' }
		]
	},
	{
		id: 'c3',
		number: 14,
		headline: 'fix(forge): keep hand-backs from being lost',
		status: 'shipping',
		href: '/regit/14',
		doneWhen: { met: 3, total: 3 }
	},
	{
		id: 'c4',
		number: 15,
		headline: 'feat(threads): exempt family messages from the limit',
		status: 'shipped',
		href: '/regit/15',
		doneWhen: { met: 2, total: 2 },
		shipped: { sha: '4b02e7a91c3d5f6e8a0b2c4d6e8f0a1b2c3d4e5f', verdict: 'deployed' }
	},
	{
		id: 'c5',
		number: 16,
		headline: 'perf(settings): page the member list',
		status: 'shipped',
		href: '/regit/16',
		doneWhen: { met: 2, total: 2 },
		shipped: { sha: '9f1c2d3e4b5a6978a0b1c2d3e4f5a6b7c8d9e0f1', verdict: 'failed' }
	},
	{
		id: 'c6',
		number: 17,
		headline: '',
		status: 'idle',
		href: '/regit/17'
	}
];

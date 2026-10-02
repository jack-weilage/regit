import type { Mentionable } from './types.ts';

export const people: Mentionable[] = [
	{ kind: 'person', handle: 'sam', label: 'Sam Rivera' },
	{ kind: 'person', handle: 'lin', label: 'Lin Wei' },
	{ kind: 'person', handle: 'mira', label: 'Mira Kask' },
	{ kind: 'person', handle: 'noor', label: 'Noor Haddad' }
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

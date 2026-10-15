import { render } from 'svelte/server';
import { expect, test } from 'vitest';
import { preferenceCookies, readPreferences } from '../src/lib/preferences.ts';
import ThreadListHarness from './ThreadListHarness.svelte';

const cookies = (values: Record<string, string>) => (name: string) => values[name];

test('reads saved time options and the Archived state from cookies', () => {
	expect(
		readPreferences(
			cookies({
				[preferenceCookies.locale]: 'en-GB',
				[preferenceCookies.timeZone]: 'Pacific/Kiritimati',
				[preferenceCookies.archivedOpen]: 'false'
			})
		)
	).toEqual({ time: { locale: 'en-GB', timeZone: 'Pacific/Kiritimati' }, archivedOpen: false });
	expect(readPreferences(cookies({ [preferenceCookies.archivedOpen]: 'true' }))).toEqual({
		time: { locale: undefined, timeZone: undefined },
		archivedOpen: true
	});
	expect(
		readPreferences(
			cookies({
				[preferenceCookies.timeZone]: 'x'.repeat(200),
				[preferenceCookies.archivedOpen]: 'yes'
			})
		)
	).toEqual({ time: { locale: undefined, timeZone: undefined }, archivedOpen: undefined });
});

const now = Date.UTC(2026, 9, 2, 18);
const threads = [
	{
		id: 'search',
		headline: 'feat(search): fuzzy thread search',
		status: 'idle' as const,
		updatedAt: Date.UTC(2026, 8, 23, 12),
		href: '#search'
	},
	{
		id: 'router',
		headline: 'refactor(api): split the router',
		status: 'archived' as const,
		updatedAt: Date.UTC(2026, 8, 20, 12),
		href: '#router'
	}
];

const html = (props: { timeZone?: string; current?: string; archivedOpen?: boolean }) =>
	render(ThreadListHarness, { props: { threads, now, locale: 'en-US', ...props } }).body;

test('renders thread times on the server in the saved time zone', () => {
	expect(html({ timeZone: 'Pacific/Kiritimati' })).toContain('>Sep 24</time>');
	expect(html({ timeZone: 'America/Los_Angeles' })).toContain('>Sep 23</time>');
	expect(html({ timeZone: 'Mars/Olympus' })).toContain('>Sep 23</time>');
});

test('server-renders Archived collapsed once the viewer collapsed it, even on an archived thread', () => {
	expect(html({ current: 'router', archivedOpen: false })).not.toContain('split the router');
	expect(html({ current: 'router' })).toContain('split the router');
	expect(html({ current: 'search' })).not.toContain('split the router');
	expect(html({ current: 'search', archivedOpen: true })).toContain('split the router');
});

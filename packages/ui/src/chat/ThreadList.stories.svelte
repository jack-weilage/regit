<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor, within } from 'storybook/test';
	import ThreadList, { type ThreadListItem } from './ThreadList.svelte';

	const now = Date.UTC(2026, 9, 2, 18);
	const minutes = (count: number) => now - count * 60_000;

	const threads: ThreadListItem[] = [
		{
			id: 'members',
			headline: 'perf(settings): load members lazily',
			status: 'needs-you',
			updatedAt: minutes(4),
			href: '#members',
			preview: {
				purpose:
					'The settings page loads every member before rendering, which takes seconds for big orgs.',
				mode: 'Medium',
				doneWhen: [
					'Settings render in under a second for 10k members',
					'Members load as you scroll'
				],
				checkpoint: { sha: 'e2bac6e9f1c04b5a8d3e7f2a1b6c9d0e4f5a6b7c', count: 3 },
				people: [
					{ name: 'Sam Rivera', kind: 'person' },
					{ name: 'Lin Wei', kind: 'person' }
				]
			}
		},
		{
			id: 'sessions',
			headline: 'fix(auth): refresh expired sessions',
			status: 'needs-you',
			updatedAt: minutes(60),
			href: '#sessions'
		},
		{
			id: 'invoices',
			headline: 'feat(billing): export invoices as CSV',
			status: 'running',
			updatedAt: minutes(0),
			href: '#invoices'
		},
		{
			id: 'readme',
			headline: 'docs(readme): document local setup',
			status: 'running',
			updatedAt: minutes(2),
			href: '#readme'
		},
		{
			id: 'router',
			headline: 'refactor(api): split the router',
			status: 'discarded',
			updatedAt: minutes(180),
			href: '#router'
		},
		{
			id: 'focus',
			headline: 'fix(ui): keep focus in dialogs',
			status: 'shipped',
			updatedAt: minutes(60 * 26),
			href: '#focus'
		},
		{
			id: 'search',
			headline: 'feat(search): fuzzy thread search',
			status: 'discarded',
			updatedAt: minutes(60 * 24 * 9),
			href: '#search'
		}
	];

	const { Story } = defineMeta({
		title: 'Chat/Thread list',
		component: ThreadList,
		args: { threads, current: 'members', now }
	});
</script>

<Story
	name="Default"
	play={async ({ canvas }) => {
		const sections = ['Needs you', 'Running', 'Recent'].map((name) =>
			canvas.getByRole('list', { name })
		);
		await expect(within(sections[0]!).getAllByRole('link')).toHaveLength(2);
		await expect(
			[...sections[2]!.querySelectorAll('time')].map((time) => time.textContent)
		).toEqual(['3h', '1d', 'Sep 23']);
		await expect(canvas.getByRole('link', { name: /load members lazily/ })).toHaveAttribute(
			'aria-current',
			'page'
		);
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem; block-size: 30rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="Preview"
	play={async ({ canvas, userEvent }) => {
		const link = canvas.getByRole('link', { name: /load members lazily/ });
		await userEvent.hover(link);
		const preview = await canvas.findByRole('group', { name: 'Thread preview' });
		await waitFor(() => expect(preview).toBeVisible());
		await expect(within(preview).getByText(/loads every member/)).toBeVisible();
		await expect(within(preview).getByText('e2bac6e')).toBeVisible();

		await userEvent.hover(preview);
		await new Promise((resolve) => setTimeout(resolve, 300));
		await expect(preview).toBeVisible();

		await userEvent.hover(canvas.getByRole('link', { name: /refresh expired sessions/ }));
		await waitFor(() => expect(preview).not.toBeVisible());
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem; block-size: 30rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="States"
	args={{
		current: 'modes',
		threads: [
			{
				id: 'sessions',
				headline: 'fix(auth): refresh expired sessions',
				status: 'needs-you',
				updatedAt: minutes(0),
				href: '#'
			},
			{
				id: 'members',
				headline: 'perf(settings): load members lazily',
				status: 'running',
				updatedAt: minutes(12),
				href: '#'
			},
			{
				id: 'deploy',
				headline: 'feat(deploy): roll out behind a flag',
				status: 'shipping',
				updatedAt: minutes(180),
				href: '#'
			},
			{
				id: 'modes',
				headline: 'docs: explain modes',
				status: 'running',
				updatedAt: minutes(1),
				href: '#'
			},
			{
				id: 'router',
				headline:
					'refactor(api): split the router into per-resource modules and move the auth middleware',
				status: 'discarded',
				updatedAt: minutes(60 * 48),
				href: '#'
			},
			{
				id: 'focus',
				headline: 'fix(ui): keep focus in dialogs',
				status: 'shipped',
				updatedAt: minutes(60 * 24 * 21),
				href: '#'
			},
			{
				id: 'search',
				headline: 'feat(search): fuzzy thread search',
				status: 'discarded',
				updatedAt: minutes(60 * 24 * 60),
				href: '#'
			}
		]
	}}
	play={async ({ canvas, canvasElement }) => {
		const icons = [...canvasElement.querySelectorAll('svg[role=img]')].map((icon) =>
			icon.getAttribute('aria-label')
		);
		await expect(icons).toEqual([
			'Needs you',
			'Running',
			'Running',
			'Shipping',
			'Discarded',
			'Shipped',
			'Discarded'
		]);
		await expect(
			within(canvas.getByRole('list', { name: 'Running' })).getAllByRole('link')
		).toHaveLength(3);
		await expect(
			[...canvasElement.querySelectorAll('time')].slice(0, 5).map((time) => time.textContent)
		).toEqual(['now', '1m', '12m', '3h', '2d']);
		const rows = canvas.getAllByRole('link');
		await expect(new Set(rows.map((row) => row.offsetHeight)).size).toBe(1);
		await expect(rows.filter((row) => row.getAttribute('aria-current') === 'page')).toHaveLength(1);
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="Empty"
	args={{ threads: [], newThread: 'new-thread' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Start your first thread')).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'New thread' })).toHaveAttribute(
			'popovertarget',
			'new-thread'
		);
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="Live ages"
	args={{
		now: undefined,
		current: undefined,
		threads: [
			{
				id: 'fresh',
				headline: 'fix(auth): refresh expired sessions',
				status: 'running',
				updatedAt: Date.now() - 50_000,
				href: '#'
			}
		]
	}}
	play={async ({ canvasElement }) => {
		await expect(canvasElement.querySelector('time')).toHaveTextContent('now');
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

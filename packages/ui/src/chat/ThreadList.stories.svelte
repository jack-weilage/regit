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
			status: 'draft',
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

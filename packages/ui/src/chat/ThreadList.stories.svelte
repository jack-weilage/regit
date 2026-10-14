<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor, within } from 'storybook/test';
	import ThreadList, { type ThreadListItem } from './ThreadList.svelte';

	const now = Date.UTC(2026, 9, 2, 18);
	const minutes = (count: number) => now - count * 60_000;

	const threads: ThreadListItem[] = [
		{
			id: 'members',
			number: 42,
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
			number: 7,
			headline: 'fix(auth): refresh expired sessions',
			status: 'needs-you',
			updatedAt: minutes(60),
			href: '#sessions',
			conflictsWith: 'main',
			failed: 'The agent stopped'
		},
		{
			id: 'invoices',
			number: 43,
			headline: 'feat(billing): export invoices as CSV',
			status: 'running',
			updatedAt: minutes(0),
			href: '#invoices'
		},
		{
			id: 'readme',
			number: 41,
			headline: 'docs(readme): document local setup',
			status: 'running',
			updatedAt: minutes(2),
			href: '#readme'
		},
		{
			id: 'router',
			number: 30,
			headline: 'refactor(api): split the router',
			status: 'discarded',
			updatedAt: minutes(180),
			href: '#router'
		},
		{
			id: 'focus',
			number: 29,
			headline: 'fix(ui): keep focus in dialogs',
			status: 'shipped',
			updatedAt: minutes(60 * 26),
			href: '#focus'
		},
		{
			id: 'search',
			number: 2,
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
		await expect(canvas.getByText('#42')).toBeVisible();
		await expect(canvas.getByText('#7')).toBeVisible();
		await expect(canvas.getByRole('link', { name: /#42.*load members lazily/ })).toHaveAttribute(
			'href',
			'#members'
		);
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
		await expect(
			within(canvas.getByRole('link', { name: /refresh expired sessions/ })).getByRole('img', {
				name: 'Conflicts with main'
			})
		).toBeVisible();
		await expect(
			within(canvas.getByRole('link', { name: /refresh expired sessions/ })).getByRole('img', {
				name: 'The agent stopped'
			})
		).toBeVisible();
	}}
>
	{#snippet template(args)}
		<div style="inline-size: 17rem; block-size: 30rem">
			<ThreadList {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="Actions"
	args={{
		threads: threads.map((thread) => ({
			...thread,
			actions: [
				{ label: 'Copy link', onselect: fn() },
				{
					label: thread.status === 'discarded' ? 'Reopen thread' : 'Discard thread',
					onselect: fn()
				},
				{ label: 'Delete thread…', danger: true, separated: true, onselect: fn() }
			]
		}))
	}}
	play={async ({ canvas, userEvent, args }) => {
		const link = canvas.getByRole('link', { name: /load members lazily/ });
		const button = canvas.getByRole('button', {
			name: 'Thread actions: perf(settings): load members lazily'
		});
		await userEvent.unhover(link);
		await expect(getComputedStyle(button.parentElement!).opacity).toBe('0');
		const width = link.getBoundingClientRect().width;
		await userEvent.hover(link);
		link.focus();
		await expect(getComputedStyle(button.parentElement!).opacity).toBe('1');
		await expect(link.getBoundingClientRect().width).toBe(width);
		const href = location.href;
		await userEvent.click(button);
		const menu = await canvas.findByRole('menu', { name: /Thread actions: perf/ });
		await waitFor(() => expect(menu).toBeVisible());
		await expect(canvas.queryByRole('group', { name: 'Thread preview' })).not.toBeInTheDocument();
		await expect(location.href).toBe(href);
		await userEvent.click(within(menu).getByRole('menuitem', { name: 'Copy link' }));
		await expect(args.threads[0]!.actions![0]!.onselect).toHaveBeenCalledOnce();
		await expect(location.href).toBe(href);
		await userEvent.unhover(button);
		link.focus();
		await userEvent.tab();
		await expect(button).toHaveFocus();
		await expect(getComputedStyle(button.parentElement!).opacity).toBe('1');
		await userEvent.keyboard('{Enter}');
		await waitFor(() => expect(menu).toBeVisible());
		await userEvent.keyboard('{Escape}');

		const discarded = canvas.getByRole('button', {
			name: 'Thread actions: refactor(api): split the router'
		});
		await userEvent.hover(canvas.getByRole('link', { name: /split the router/ }));
		discarded.focus();
		await userEvent.click(discarded);
		await waitFor(() =>
			expect(canvas.getByRole('menuitem', { name: 'Reopen thread' })).toBeVisible()
		);
		await userEvent.keyboard('{Escape}');
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
	name="Spin-offs"
	args={{
		current: 'audit',
		threads: [
			{
				id: 'settings',
				headline: 'perf(settings): load members lazily',
				status: 'running',
				updatedAt: minutes(1),
				href: '#settings'
			},
			{
				id: 'audit',
				headline: 'fix(audit): query only the last entry',
				status: 'running',
				updatedAt: minutes(3),
				href: '#audit',
				parent: { id: 'settings', headline: 'perf(settings): load members lazily' }
			},
			{
				id: 'index',
				headline: 'perf(db): index audit entries by repo',
				status: 'running',
				updatedAt: minutes(5),
				href: '#index',
				parent: { id: 'audit', headline: 'fix(audit): query only the last entry' }
			},
			{
				id: 'avatars',
				headline: 'perf(settings): cache member avatars',
				status: 'running',
				updatedAt: minutes(2),
				href: '#avatars',
				parent: { id: 'settings', headline: 'perf(settings): load members lazily' }
			},
			{
				id: 'copy',
				headline: 'docs(settings): explain lazy loading',
				status: 'needs-you',
				updatedAt: minutes(8),
				href: '#copy',
				parent: { id: 'settings', headline: 'perf(settings): load members lazily' }
			},
			{
				id: 'orphan',
				headline: 'chore: drop the old audit table',
				status: 'needs-you',
				updatedAt: minutes(30),
				href: '#orphan',
				parent: { id: 'gone', headline: 'refactor(audit): move to D1' }
			}
		]
	}}
	play={async ({ canvas, userEvent }) => {
		const running = canvas.getByRole('list', { name: 'Running' });
		const spunOff = within(running).getByRole('list', {
			name: 'Spun off from perf(settings): load members lazily'
		});
		await expect(
			[...spunOff.querySelectorAll('.headline')].map((headline) => headline.textContent)
		).toEqual([
			'perf(settings): cache member avatars',
			'fix(audit): query only the last entry',
			'perf(db): index audit entries by repo'
		]);
		await expect(
			within(running).getByRole('list', {
				name: 'Spun off from fix(audit): query only the last entry'
			})
		).toBeVisible();
		await expect(within(running).queryByRole('img', { name: /Spun off from/ })).toBeNull();

		const copy = canvas.getByRole('link', { name: /explain lazy loading/ });
		await expect(
			within(copy).getByRole('img', { name: 'Spun off from perf(settings): load members lazily' })
		).toBeVisible();
		await expect(
			within(canvas.getByRole('link', { name: /drop the old audit table/ })).getByRole('img', {
				name: 'Spun off from refactor(audit): move to D1'
			})
		).toBeVisible();

		const parent = canvas.getByRole('link', { name: /^Running perf\(settings\): load/ });
		const row = (link: HTMLElement) => link.closest('.row')!;
		await userEvent.hover(parent);
		await waitFor(() => expect(row(copy)).toHaveClass('related'));
		await expect(row(canvas.getByRole('link', { name: /cache member avatars/ }))).toHaveClass(
			'related'
		);
		await expect(row(canvas.getByRole('link', { name: /index audit entries/ }))).not.toHaveClass(
			'related'
		);
		await userEvent.unhover(parent);
		await waitFor(() => expect(row(copy)).not.toHaveClass('related'));
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

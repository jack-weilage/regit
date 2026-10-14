<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import type { MainStatus } from '@regit/core';
	import { expect, fn, waitFor } from 'storybook/test';
	import AppShell from './AppShell.svelte';
	import ChatComposer from './chat/ChatComposer.svelte';
	import ChatFooter from './chat/ChatFooter.svelte';
	import ChatGroup from './chat/ChatGroup.svelte';
	import ChatHeader from './chat/ChatHeader.svelte';
	import ChatLog from './chat/ChatLog.svelte';
	import ChatMessage from './chat/ChatMessage.svelte';
	import ThreadView from './chat/ThreadView.svelte';
	import type { ThreadListItem } from './chat/ThreadList.svelte';

	const now = Date.UTC(2026, 9, 2, 18);
	const minutes = (count: number) => now - count * 60_000;
	const threads: ThreadListItem[] = [
		{
			id: 'members',
			headline: 'perf(settings): load members lazily',
			status: 'idle',
			needsYou: true,
			updatedAt: minutes(4),
			href: '#members'
		},
		{
			id: 'sessions',
			headline: 'fix(auth): refresh expired sessions',
			status: 'idle',
			needsYou: true,
			updatedAt: minutes(60),
			href: '#sessions'
		},
		{
			id: 'invoices',
			headline: 'feat(billing): export invoices as CSV',
			status: 'working',
			updatedAt: minutes(0),
			href: '#invoices'
		},
		{
			id: 'router',
			headline: 'refactor(api): split the router',
			status: 'idle',
			needsYou: true,
			updatedAt: minutes(180),
			href: '#router'
		},
		{
			id: 'focus',
			headline: 'fix(ui): keep focus in dialogs',
			status: 'shipped',
			updatedAt: minutes(60 * 26),
			href: '#focus'
		}
	];
	const main: MainStatus = {
		branch: 'main',
		verifying: {
			sha: 'b'.repeat(40),
			stage: 'deploying',
			note: null,
			since: minutes(1),
			started: minutes(1)
		},
		waiting: [{ sha: 'c'.repeat(40), headline: 'Update dependencies', thread: null }],
		verified: null,
		green: { sha: 'a'.repeat(40), at: minutes(3) },
		deployed: { sha: 'a'.repeat(40), at: minutes(2) },
		deployFailure: null,
		failure: null
	};
	const sam = { name: 'Sam Rivera', kind: 'person' as const };
	const agent = { name: 'ReGit', kind: 'agent' as const };

	const { Story } = defineMeta({
		title: 'App shell',
		component: AppShell,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			repo: 'regit/web',
			repos: ['regit/web', 'regit/forge'],
			threads,
			current: 'members',
			now,
			account: { name: 'Jack Weilage', email: 'jack@regit.dev' },
			onswitchrepo: fn(),
			oncreaterepo: fn(async () => {}),
			onstart: fn()
		}
	});
</script>

{#snippet page(args: ComponentProps<typeof AppShell>)}
	{@render shell(args, '100%')}
{/snippet}

{#snippet shell(args: ComponentProps<typeof AppShell>, width: string)}
	{@const { children: _, ...props } = args}
	<div style="block-size: 40rem; inline-size: {width}">
		<AppShell {...props}>
			<ThreadView>
				{#snippet header()}
					<ChatHeader
						headline="perf(settings): load members lazily"
						status="idle"
						needsYou
						people={[sam]}
					/>
				{/snippet}
				<ChatLog label="Thread messages">
					<ChatGroup author={sam} time={new Date(minutes(40))}>
						<ChatMessage>The settings page takes forever to load for big orgs.</ChatMessage>
					</ChatGroup>
					<ChatGroup author={agent}>
						<ChatMessage
							>Members now load in pages of 50, and the settings page renders in 180ms. Tests pass.</ChatMessage
						>
					</ChatGroup>
				</ChatLog>
				{#snippet bottom()}
					<ChatComposer onsend={() => {}} />
					<ChatFooter mode="Medium" context={{ used: 48_000, limit: 272_000 }} usage={[]} />
				{/snippet}
			</ThreadView>
		</AppShell>
	</div>
{/snippet}

<Story
	name="Default"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Repository: regit/web' }));
		await userEvent.click(await canvas.findByRole('menuitemradio', { name: 'regit/forge' }));
		await expect(args.onswitchrepo).toHaveBeenCalledWith('regit/forge');
	}}
	template={page}
/>

<Story
	name="New repository"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Repository: regit/web' }));
		await userEvent.click(await canvas.findByRole('menuitem', { name: 'New repository…' }));
		const input = canvas.getByRole('textbox', { name: 'Name or git URL' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard('billing{Enter}');
		await expect(args.oncreaterepo).toHaveBeenCalledWith({ name: 'billing' });
	}}
	template={page}
/>

<Story
	name="New thread"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		const input = canvas.getByRole('textbox', { name: 'What should change?' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard('Speed up the settings page{Enter}');
		await expect(args.onstart).toHaveBeenCalledWith({
			text: 'Speed up the settings page',
			mode: 'medium',
			machine: 'standard-1'
		});
	}}
	template={page}
/>

<Story
	name="Narrow"
	play={async ({ canvas, canvasElement, userEvent }) => {
		const toggle = canvas.getByRole('button', { name: 'Threads' });
		const sidebar = canvasElement.querySelector('aside')!;
		canvasElement.addEventListener('click', (event) => event.preventDefault());
		await waitFor(() => expect(sidebar).not.toBeVisible());
		const main = canvasElement.querySelector('main')!;
		await expect(main.offsetWidth).toBe(main.parentElement!.offsetWidth);
		await userEvent.click(toggle);
		await waitFor(() => expect(sidebar).toBeVisible());
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await userEvent.click(canvas.getByRole('link', { name: /refresh expired sessions/ }));
		await waitFor(() => expect(sidebar).not.toBeVisible());
	}}
>
	{#snippet template(args)}
		{@render shell(args, '24rem')}
	{/snippet}
</Story>

<Story
	name="Current UI with deploy status"
	args={{ main }}
	play={async ({ canvas }) => {
		await expect(
			canvas.queryByRole('button', { name: 'New version available Refresh' })
		).toBeNull();
		await expect(canvas.getByRole('region', { name: 'main checks and deploys' })).toBeVisible();
		await expect(canvas.getByText('jack@regit.dev')).toBeVisible();
	}}
	template={page}
/>

<Story
	name="Update available above deploys"
	args={{ main, onupdate: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		const update = canvas.getByRole('button', { name: 'New version available Refresh' });
		const sidebar = canvas.getByRole('complementary', { name: 'Navigation' });
		const padding = parseFloat(getComputedStyle(update.parentElement!).paddingLeft);
		await expect(update.getBoundingClientRect().width).toBeCloseTo(
			sidebar.clientWidth - 2 * padding
		);
		await expect(update.getBoundingClientRect().left).toBeCloseTo(
			sidebar.getBoundingClientRect().left + sidebar.clientLeft + padding
		);
		const deploys = canvas.getByRole('region', { name: 'main checks and deploys' });
		await expect(update).toBeVisible();
		await expect(deploys).toBeVisible();
		await expect(update.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			deploys.getBoundingClientRect().top
		);
		await expect(deploys.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			canvas.getByText('jack@regit.dev').getBoundingClientRect().top
		);
		await userEvent.click(update);
		await expect(args.onupdate).toHaveBeenCalledOnce();
	}}
	template={page}
/>

<Story
	name="Update available narrow"
	args={{ main, onupdate: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(
			canvas.queryByRole('button', { name: 'New version available Refresh' })
		).toBeNull();
		await userEvent.click(canvas.getByRole('button', { name: 'Threads' }));
		const update = await waitFor(() =>
			canvas.getByRole('button', { name: 'New version available Refresh' })
		);
		await waitFor(() => expect(update).toBeVisible());
		const sidebar = canvas.getByRole('complementary', { name: 'Navigation' });
		const padding = parseFloat(getComputedStyle(update.parentElement!).paddingLeft);
		await expect(update.getBoundingClientRect().width).toBeCloseTo(
			sidebar.clientWidth - 2 * padding
		);
		await expect(update.getBoundingClientRect().left).toBeCloseTo(
			sidebar.getBoundingClientRect().left + sidebar.clientLeft + padding
		);
		const deploys = canvas.getByRole('region', { name: 'main checks and deploys' });
		await expect(update.getBoundingClientRect().bottom).toBeLessThanOrEqual(
			deploys.getBoundingClientRect().top
		);
		await expect(deploys).toBeVisible();
		await userEvent.click(update);
		await expect(args.onupdate).toHaveBeenCalledOnce();
	}}
>
	{#snippet template(args)}
		{@render shell(args, '24rem')}
	{/snippet}
</Story>

<Story
	name="Update available without deploy status"
	args={{ main: null, onupdate: fn() }}
	play={async ({ canvas }) => {
		await expect(
			canvas.getByRole('button', { name: 'New version available Refresh' })
		).toBeVisible();
		await expect(canvas.queryByRole('region', { name: 'main checks and deploys' })).toBeNull();
		await expect(canvas.getByText('jack@regit.dev')).toBeVisible();
	}}
	template={page}
/>

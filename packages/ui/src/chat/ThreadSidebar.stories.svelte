<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChangesPanel from './ChangesPanel.svelte';
	import ServicesPanel, { type ServiceView } from './ServicesPanel.svelte';
	import ThreadSidebar from './ThreadSidebar.svelte';
	import { diffFiles } from './fixtures.ts';

	const services: ServiceView[] = [
		{
			name: 'storybook',
			command: 'bun run storybook',
			port: 6006,
			saved: true,
			status: 'running',
			preview: `data:text/html,${encodeURIComponent('<body style="font-family:system-ui;padding:2rem"><h1>Storybook</h1></body>')}`
		},
		{ name: 'web', command: 'bun run dev', port: 5173, saved: true, status: 'stopped', preview: '' }
	];

	const changes = { files: 4, additions: 23, deletions: 8 };

	const { Story } = defineMeta({
		title: 'Chat/Thread sidebar',
		component: ThreadSidebar,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { changes, live: true }
	});
</script>

{#snippet frame(args: import('svelte').ComponentProps<typeof ThreadSidebar>, width = '100%')}
	<div class="page" style:inline-size={width}>
		<div class="thread">The thread</div>
		<ThreadSidebar {...args}>
			{#snippet changesTab(close)}
				<ChangesPanel files={diffFiles} onclose={close} />
			{/snippet}
			{#snippet servicesTab(close)}
				<ServicesPanel {services} onaction={fn()} onclose={close} />
			{/snippet}
		</ThreadSidebar>
	</div>
{/snippet}

<Story
	name="Collapsed"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Services: running' }));
		await waitFor(() => expect(canvas.getByTitle('Preview of storybook')).toBeVisible());
		const changes = canvas.getByRole('button', { name: /^Changes/ });
		await userEvent.click(changes);
		await waitFor(() => expect(canvas.getByRole('region', { name: 'Changes' })).toBeVisible());
		await expect(changes).toHaveAttribute('aria-pressed', 'true');
		await userEvent.click(canvas.getByRole('button', { name: 'Close changes' }));
		await waitFor(() => expect(canvas.queryByRole('region', { name: 'Changes' })).toBeNull());
		await expect(changes).toHaveAttribute('aria-pressed', 'false');
	}}
>
	{#snippet template(args)}{@render frame(args)}{/snippet}
</Story>

<Story name="Changes" args={{ open: true, tab: 'changes' }}>
	{#snippet template(args)}{@render frame(args)}{/snippet}
</Story>

<Story name="Services" args={{ open: true, tab: 'services' }}>
	{#snippet template(args)}{@render frame(args)}{/snippet}
</Story>

<Story name="Nothing yet" args={{ open: true, changes: null, live: false }}>
	{#snippet template(args)}{@render frame(args)}{/snippet}
</Story>

<Story name="Narrow" args={{ open: true, tab: 'services' }}>
	{#snippet template(args)}{@render frame(args, '24rem')}{/snippet}
</Story>

<Story name="Overlay" args={{ open: true, tab: 'changes' }}>
	{#snippet template(args)}{@render frame(args, '44rem')}{/snippet}
</Story>

<Story
	name="Overlay dismissed"
	args={{ open: true, tab: 'changes' }}
	play={async ({ canvas, userEvent }) => {
		await waitFor(() => expect(canvas.getByRole('region', { name: 'Changes' })).toBeVisible());
		await userEvent.click(canvas.getByRole('button', { name: 'Close panel' }));
		await waitFor(() => expect(canvas.queryByRole('region', { name: 'Changes' })).toBeNull());
	}}
>
	{#snippet template(args)}{@render frame(args, '44rem')}{/snippet}
</Story>

<style>
	.page {
		container-type: inline-size;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		block-size: 100dvh;
	}

	.thread {
		display: grid;
		place-items: center;
		color: var(--color-muted);
		font-size: var(--text-chat);
	}
</style>

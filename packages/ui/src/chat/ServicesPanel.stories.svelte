<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ServicesPanel, { type ServiceView } from './ServicesPanel.svelte';

	const page = (title: string) =>
		`data:text/html,${encodeURIComponent(`<body style="font-family:system-ui;padding:2rem"><h1>${title}</h1></body>`)}`;

	const services: ServiceView[] = [
		{
			name: 'storybook',
			command: 'bun run storybook',
			port: 6006,
			saved: true,
			status: 'running',
			preview: page('Storybook')
		},
		{
			name: 'web',
			command: 'bun run dev',
			port: 5173,
			saved: true,
			status: 'stopped',
			preview: page('Web')
		},
		{
			name: 'api',
			command: 'bun run dev',
			port: 8787,
			saved: false,
			status: 'exited',
			exitCode: 1,
			preview: page('API')
		}
	];

	const { Story } = defineMeta({
		title: 'Chat/Services panel',
		component: ServicesPanel,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { services, onaction: fn(), onlogs: fn(), onclose: fn() }
	});
</script>

{#snippet frame(args: import('svelte').ComponentProps<typeof ServicesPanel>)}
	<div style="block-size: 100dvh; max-inline-size: 40rem"><ServicesPanel {...args} /></div>
{/snippet}

<Story
	name="Running"
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByTitle('Preview of storybook')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Start web' }));
		await expect(args.onaction).toHaveBeenCalledWith('start', 'web');
		await userEvent.click(canvas.getByRole('button', { name: 'Stop storybook' }));
		await expect(args.onaction).toHaveBeenCalledWith('stop', 'storybook');
	}}
	template={frame}
/>

<Story
	name="Logs"
	args={{ logs: 'storybook v9\nLocal: http://localhost:6006/\nready in 1.2s' }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('tab', { name: 'Logs' }));
		await expect(args.onlogs).toHaveBeenCalledWith('storybook');
		await waitFor(() => expect(canvas.getByText(/ready in 1.2s/)).toBeVisible());
	}}
	template={frame}
/>

<Story
	name="Failed to start"
	args={{
		selected: 'api',
		error: 'api exited with code 1 before port 8787 opened:\nerror: Cannot find module "hono"'
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('alert')).toHaveTextContent('Cannot find module');
		await expect(canvas.getByText('Start api to preview it.')).toBeVisible();
	}}
	template={frame}
/>

<Story name="Empty" args={{ services: [] }} template={frame} />

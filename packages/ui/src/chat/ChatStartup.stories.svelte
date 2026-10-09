<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ChatStartup, { type StartupStage } from './ChatStartup.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Startup',
		component: ChatStartup,
		tags: ['!autodocs']
	});

	const now = Date.now();
	const at = (seconds: number) => now - seconds * 1000;

	const cold: StartupStage[] = [
		{ label: 'Start a 1 vCPU sandbox', status: 'done', startedAt: at(44), finishedAt: at(37) },
		{ label: 'Clone regit', status: 'done', startedAt: at(37), finishedAt: at(34) },
		{ label: 'Install node 24, bun 1.4.2', status: 'done', startedAt: at(34), finishedAt: at(20) },
		{ label: 'Run .agents/setup', status: 'running', startedAt: at(20) },
		{ label: 'Cache the prepared sandbox', status: 'pending' },
		{ label: 'Run .agents/resume', status: 'pending' },
		{ label: 'Start storybook', status: 'pending' }
	];

	const ready: StartupStage[] = [
		{ label: 'Restore the sandbox', status: 'done', startedAt: at(70), finishedAt: at(62) },
		{ label: 'Clone regit', status: 'done', startedAt: at(62), finishedAt: at(59) },
		{ label: 'Use cached setup', status: 'done', startedAt: at(59), finishedAt: at(59) },
		{
			label: 'Run .agents/resume',
			status: 'done',
			startedAt: at(59),
			finishedAt: at(58),
			output: 'Local configuration refreshed.\nFixture database ready.'
		},
		{ label: 'Start storybook', status: 'done', startedAt: at(59), finishedAt: at(31) }
	];

	const failed: StartupStage[] = [
		{ label: 'Start a 1 vCPU sandbox', status: 'done', startedAt: at(20), finishedAt: at(13) },
		{ label: 'Clone regit', status: 'done', startedAt: at(13), finishedAt: at(10) },
		{
			label: 'Run .agents/setup',
			status: 'failed',
			startedAt: at(10),
			finishedAt: at(2),
			output:
				'.agents/setup failed (exit code 1)\nerror: lockfile had changes, but lockfile is frozen'
		}
	];
</script>

<Story name="Cold start" args={{ stages: cold }} />

<Story
	name="Ready"
	args={{ stages: ready, finished: true }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Sandbox ready · 39s'));
		await waitFor(() => expect(canvas.getByText('Use cached setup')).toBeVisible());
		await userEvent.click(canvas.getByText('Output for Run .agents/resume'));
		await expect(canvas.getByText(/Fixture database ready/)).toBeVisible();
	}}
/>

<Story
	name="Failed"
	args={{ stages: failed }}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByText(/lockfile had changes/)).toBeVisible());
	}}
/>

<Story
	name="Setup complete"
	args={{
		stages: [
			...cold.slice(0, 3),
			{
				label: 'Run .agents/setup',
				status: 'done',
				startedAt: at(20),
				finishedAt: at(4),
				output:
					'bun install --frozen-lockfile\nInstalled 487 packages.\nDisposable fixtures prepared.'
			},
			{ label: 'Cache the prepared sandbox', status: 'running', startedAt: at(4) }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Output for Run .agents/setup'));
		await waitFor(() => expect(canvas.getByText(/Installed 487 packages/)).toBeVisible());
	}}
/>

<Story
	name="Between stages"
	args={{ stages: ready.slice(0, 2) }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent('Starting a sandbox');
		await expect(canvas.queryByText(/Sandbox ready/)).toBeNull();
	}}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
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
		{ label: 'Install node 24, bun 1.4.2', status: 'running', startedAt: at(34) },
		{ label: 'Save the toolchain', status: 'pending' },
		{ label: 'Start storybook', status: 'pending' }
	];

	const ready: StartupStage[] = [
		{ label: 'Restore the toolchain', status: 'done', startedAt: at(70), finishedAt: at(62) },
		{ label: 'Clone regit', status: 'done', startedAt: at(62), finishedAt: at(59) },
		{ label: 'Start storybook', status: 'done', startedAt: at(59), finishedAt: at(31) }
	];

	const failed: StartupStage[] = [
		{ label: 'Start a 1 vCPU sandbox', status: 'done', startedAt: at(20), finishedAt: at(13) },
		{ label: 'Clone regit', status: 'done', startedAt: at(13), finishedAt: at(10) },
		{ label: 'Install node 24, bun 1.4.2', status: 'failed', startedAt: at(10), finishedAt: at(2) }
	];
</script>

<Story name="Cold start" args={{ stages: cold }} />

<Story
	name="Ready"
	args={{ stages: ready }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Sandbox ready · 39s'));
		await expect(canvas.getByText('Restore the toolchain')).toBeVisible();
	}}
/>

<Story name="Failed" args={{ stages: failed }} />

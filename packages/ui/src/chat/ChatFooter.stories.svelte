<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ChatFooter from './ChatFooter.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Footer',
		component: ChatFooter,
		args: {
			mode: 'Medium',
			context: {
				used: 48_000,
				limit: 200_000,
				parts: [
					{ label: 'Instructions', tokens: 6_000 },
					{ label: 'Lessons', tokens: 2_000 },
					{ label: 'Thread', tokens: 9_000 },
					{ label: 'Code', tokens: 31_000 }
				]
			},
			usage: [
				{ task: 'Coding', model: 'kimi-k2.7-code', tokens: 980_000, cost: 0.71 },
				{ task: 'Search', model: 'qwen3-embedding', tokens: 160_000, cost: 0.02 },
				{ task: 'Review', model: 'clef', tokens: 60_000, cost: 0.11 }
			]
		}
	});
</script>

<Story name="Default" />

<Story
	name="Usage breakdown"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /24% context \$0\.84/ }));
		await waitFor(() => expect(canvas.getByRole('cell', { name: 'kimi-k2.7-code' })).toBeVisible());
		await expect(canvas.getByRole('row', { name: /Total/ })).toHaveTextContent('$0.84');
	}}
/>

<Story name="Nearly full" args={{ mode: 'Large', context: { used: 182_000, limit: 200_000 } }} />

<Story
	name="Fresh"
	args={{ mode: 'Small', context: { used: 3_000, limit: 128_000 }, usage: [] }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button'));
		await waitFor(() => expect(canvas.getByText('No usage yet')).toBeVisible());
		await expect(canvas.queryByRole('table')).toBeNull();
	}}
/>

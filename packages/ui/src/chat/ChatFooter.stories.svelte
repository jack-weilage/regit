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
				{ task: 'Conversation', model: 'clef', tokens: 60_000, cost: 0.11 }
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
		await expect(canvas.getByText('Context until compaction')).toBeVisible();
		await expect(
			canvas.getByRole('img', { name: '24% of the context before compaction' })
		).toBeVisible();
		await expect(canvas.getByRole('row', { name: /Total/ })).toHaveTextContent('$0.84');
	}}
/>

<Story
	name="Nearly full"
	args={{ mode: 'Large', context: { used: 232_000, limit: 244_800 } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /95% context/ })).toBeVisible();
	}}
/>

<Story
	name="Past the compaction point"
	args={{ mode: 'Large', context: { used: 261_000, limit: 244_800 } }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /100% context/ })).toBeVisible();
	}}
/>

<Story
	name="Fresh"
	args={{ mode: 'Small', context: { used: 3_000, limit: 128_000 }, usage: [] }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button'));
		await waitFor(() => expect(canvas.getByText('No usage yet')).toBeVisible());
		await expect(canvas.queryByRole('table')).toBeNull();
	}}
/>

<Story
	name="Under a cent"
	args={{
		context: { used: 1_200, limit: 1_050_000 },
		usage: [{ task: 'Drafting intents', model: 'gpt-6-luna', tokens: 1_200, cost: 0.0004 }]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /<\$0\.01/ })).toBeVisible();
	}}
/>

<Story
	name="Nothing yet"
	args={{ context: { used: 0, limit: 1_050_000 }, usage: [] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /0% context \$0\.00/ })).toBeVisible();
	}}
/>

<Story
	name="One task on two models"
	args={{
		context: { used: 30_854, limit: 244_800 },
		usage: [
			{ task: 'Agent', model: 'gpt-6-luna', tokens: 83_607, cost: 0.0037 },
			{ task: 'Agent', model: 'gpt-6.1-sol', tokens: 481_598, cost: 0.2178 },
			{ task: 'Thread search', model: 'gpt-6-luna', tokens: 4_697, cost: 0.0006 }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button'));
		await waitFor(() => expect(canvas.getByRole('cell', { name: 'gpt-6.1-sol' })).toBeVisible());
		await expect(canvas.getAllByRole('cell', { name: 'Agent' })).toHaveLength(2);
	}}
/>

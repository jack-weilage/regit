<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ChatRecovered from './ChatRecovered.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Recovered',
		component: ChatRecovered,
		tags: ['!autodocs']
	});

	const at = Date.UTC(2026, 9, 12, 18);
</script>

<Story
	name="Recovered"
	args={{
		failures: [
			{ at, label: 'Model request', error: 'The model is overloaded' },
			{ at: at + 3000, label: 'Push', error: 'The requested URL returned error: 503' }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Recovered after 2 failures'));
		await waitFor(() =>
			expect(canvas.getByText('The requested URL returned error: 503')).toBeVisible()
		);
	}}
/>

<Story
	name="One failure"
	args={{ failures: [{ at, label: 'Sandbox', error: 'The sandbox is unreachable' }] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Recovered after 1 failure')).toBeVisible();
	}}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChatFailure from './ChatFailure.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Failure',
		component: ChatFailure,
		tags: ['!autodocs']
	});

	const at = Date.UTC(2026, 9, 12, 18);
	const outage = Array.from({ length: 5 }, (_, index) => ({
		at: at + index * 30_000,
		label: 'Model request',
		error: 'The model is overloaded'
	}));
</script>

<Story
	name="Agent stopped"
	args={{
		title: 'The agent stopped',
		error: 'The model is overloaded',
		failures: outage,
		time: new Date(at + 150_000),
		onresume: fn().mockResolvedValue(undefined)
	}}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('5 attempts'));
		await waitFor(() => expect(canvas.getByText('Model request ×5')).toBeVisible());
		await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
		await expect(args.onresume).toHaveBeenCalled();
	}}
/>

<Story
	name="Try again fails"
	args={{
		title: "Couldn't reach the agent",
		error: 'Network connection lost.',
		onresume: () => Promise.reject(new Error('This thread is shipping.'))
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
		await waitFor(() =>
			expect(canvas.getByRole('alert')).toHaveTextContent('This thread is shipping.')
		);
	}}
/>

<Story
	name="Shipping stopped"
	args={{
		title: 'Shipping stopped',
		error: 'Ship conflicts with main in src/app.ts'
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button', { name: 'Try again' })).toBeNull();
	}}
/>

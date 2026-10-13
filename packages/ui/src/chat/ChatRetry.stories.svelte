<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import type { Retry } from '@regit/core';
	import ChatRetry from './ChatRetry.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Retry',
		component: ChatRetry,
		tags: ['!autodocs']
	});

	const now = Date.now();
	const at = (seconds: number) => now + seconds * 1000;

	const model: Retry = {
		what: 'model request',
		failures: [
			{ at: at(-9), label: 'Model request', error: 'The model is overloaded' },
			{ at: at(-4), label: 'Model request', error: 'The model is overloaded' }
		],
		attempt: 3,
		limit: 5,
		next: at(8)
	};

	const turn: Retry = {
		what: 'turn',
		failures: [
			{
				at: at(-20),
				label: 'Sandbox',
				error: 'The sandbox is unreachable: Network connection lost.'
			}
		],
		attempt: 2,
		limit: 5,
		next: at(15)
	};
</script>

<Story
	name="Waiting to retry"
	args={{ retry: model }}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent(
			/Model request failed · retrying in [78]s/
		);
		await expect(canvas.getByText('Model request attempt 3 of 5')).toBeVisible();
		await userEvent.click(canvas.getByText('2 failures'));
		await waitFor(() => expect(canvas.getByText('Model request ×2')).toBeVisible());
	}}
/>

<Story
	name="Retrying now"
	args={{ retry: { ...model, next: null }, onretrynow: fn() }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent('Model request failed · retrying');
		await expect(canvas.queryByRole('button', { name: 'Retry now' })).toBeNull();
	}}
/>

<Story
	name="Turn scheduled"
	args={{ retry: turn, onretrynow: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByText('Turn attempt 2 of 5')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Retry now' }));
		await expect(args.onretrynow).toHaveBeenCalled();
	}}
/>

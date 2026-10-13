<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ShipPanel from './ShipPanel.svelte';
	import { intent } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Ship',
		component: ShipPanel,
		tags: ['!autodocs'],
		args: { intent, status: 'needs-you', onship: fn().mockResolvedValue(undefined) }
	});
</script>

<Story
	name="Ship"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		const title = canvas.getByRole('textbox', { name: 'Commit title' });
		await expect(title).toHaveValue(intent.headline);
		await expect(canvas.getByRole('textbox', { name: 'Commit body' })).toHaveValue(intent.purpose);
		await userEvent.clear(title);
		await userEvent.type(title, 'perf: paginate members');
		await userEvent.click(canvas.getByRole('button', { name: 'Ship to main' }));
		await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Commit title' })).toBeNull());
		await expect(args.onship).toHaveBeenCalledWith({
			title: 'perf: paginate members',
			body: intent.purpose
		});
	}}
/>

<Story
	name="Working"
	args={{ status: 'running' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Ship' })).toBeDisabled();
	}}
/>

<Story
	name="Shipping"
	args={{ status: 'shipping' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Shipping to main')).toBeVisible();
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Error"
	args={{
		onship: fn(async () => {
			throw new Error('Repository owner permission is required');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Ship to main' }));
		await waitFor(() =>
			expect(canvas.getByRole('alert')).toHaveTextContent('Repository owner permission is required')
		);
		await expect(canvas.getByRole('button', { name: 'Ship to main' })).toBeEnabled();
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem; max-inline-size: 100%">
		<ShipPanel {intent} status="needs-you" onship={fn().mockResolvedValue(undefined)} />
	</div>
</Story>

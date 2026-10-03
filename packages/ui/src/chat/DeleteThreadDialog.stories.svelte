<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import DeleteThreadDialog from './DeleteThreadDialog.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Delete thread dialog',
		component: DeleteThreadDialog,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			headline: 'perf(settings): load members lazily',
			messages: 14,
			checkpoints: 3,
			running: true,
			onconfirm: fn()
		}
	});
</script>

<Story name="Open" args={{ open: true }} />

<Story
	name="Confirm"
	args={{ open: true }}
	play={async ({ args, canvas, userEvent }) => {
		const dialog = await canvas.findByRole('dialog', { name: 'Delete this thread?' });
		await expect(dialog).toHaveTextContent('The conversation, 14 messages');
		await expect(dialog).toHaveTextContent("The agent's branch, 3 checkpoints");
		await expect(dialog).toHaveTextContent('The running attempt, which stops now');
		await userEvent.click(canvas.getByRole('button', { name: 'Delete thread' }));
		await expect(args.onconfirm).toHaveBeenCalledOnce();
		await waitFor(() => expect(dialog).not.toBeVisible());
	}}
/>

<Story
	name="Cancel"
	args={{ open: true }}
	play={async ({ args, canvas, userEvent }) => {
		const dialog = await canvas.findByRole('dialog');
		await userEvent.keyboard('{Escape}');
		await waitFor(() => expect(dialog).not.toBeVisible());
		await expect(args.onconfirm).not.toHaveBeenCalled();
	}}
/>

<Story
	name="Draft"
	args={{ open: true, messages: 1, checkpoints: 0, running: false }}
	play={async ({ canvas }) => {
		const dialog = await canvas.findByRole('dialog');
		await expect(dialog).toHaveTextContent('The conversation, 1 message');
		await expect(dialog).not.toHaveTextContent('branch');
	}}
/>

<Story
	name="Shipped"
	args={{
		open: true,
		headline: 'fix(ui): keep focus in dialogs',
		shipped: { sha: 'e2bac6e9f1c04b5a8d3e7f2a1b6c9d0e4f5a6b7c' }
	}}
	play={async ({ canvas }) => {
		await canvas.findByRole('dialog', { name: 'Delete this conversation?' });
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: 'Delete conversation' })).toBeVisible()
		);
	}}
/>

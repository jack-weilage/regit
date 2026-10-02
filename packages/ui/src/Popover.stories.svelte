<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import Button from './Button.svelte';
	import Popover from './Popover.svelte';

	const { Story } = defineMeta({
		title: 'Popover',
		tags: ['!autodocs']
	});
</script>

<script lang="ts">
	let anchor: HTMLElement | undefined = $state();
	let open = $state(false);
</script>

<Story
	name="Anchored"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Open' }));
		await waitFor(() =>
			expect(canvas.getByText('Opens toward the side with more room.')).toBeVisible()
		);
	}}
>
	<div
		bind:this={anchor}
		style="display: flex; justify-content: flex-end; margin-block-start: 12rem"
	>
		<Button variant="primary" popovertarget="example">Open</Button>
	</div>
	<Popover id="example" {anchor}>
		<p style="margin: 0; padding: 0.75rem">Opens toward the side with more room.</p>
	</Popover>
</Story>

<Story
	name="Manual"
	asChild
	play={async ({ canvas, userEvent }) => {
		const content = canvas.getByText(/Controlled by state/);
		await userEvent.click(canvas.getByRole('button', { name: 'Show' }));
		await waitFor(() => expect(content).toBeVisible());
		await userEvent.click(canvas.getByRole('button', { name: 'Hide' }));
		await waitFor(() => expect(content).not.toBeVisible());
	}}
>
	<div bind:this={anchor} style="margin-block-start: 12rem">
		<Button onclick={() => (open = !open)}>{open ? 'Hide' : 'Show'}</Button>
	</div>
	<Popover id="manual" {anchor} manual {open} matchWidth>
		<p style="margin: 0; padding: 0.75rem">Controlled by state and matching the anchor's width.</p>
	</Popover>
</Story>

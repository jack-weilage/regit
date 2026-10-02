<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import Button from './Button.svelte';
	import Menu from './Menu.svelte';

	const copy = fn();
	const discard = fn();

	const { Story } = defineMeta({
		title: 'Menu',
		component: Menu,
		args: {
			label: 'Thread actions',
			items: [
				{ label: 'Copy link', onselect: copy },
				{ label: 'Try another approach', onselect: fn() },
				{ label: 'Discard', onselect: discard }
			]
		}
	});
</script>

<Story
	name="Default"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Thread actions' }));
		await waitFor(() => expect(canvas.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus());
		await userEvent.keyboard('{ArrowUp}');
		await expect(canvas.getByRole('menuitem', { name: 'Discard' })).toHaveFocus();
		await userEvent.keyboard('{Home}{Enter}');
		await expect(copy).toHaveBeenCalledOnce();
		await waitFor(() => expect(canvas.getByRole('menu')).not.toBeVisible());
	}}
>
	{#snippet template(args)}
		<div style="display: flex; justify-content: end; padding-block-end: 8rem">
			<Menu {...args}>
				{#snippet trigger(props)}
					<Button variant="ghost" size="sm" aria-label="Thread actions" {...props}>⋯</Button>
				{/snippet}
			</Menu>
		</div>
	{/snippet}
</Story>

<Story
	name="Choices"
	args={{
		label: 'Mode',
		items: [
			{ label: 'Small', detail: 'Quick fixes', checked: false, onselect: fn() },
			{ label: 'Medium', detail: 'Most work', checked: true, onselect: fn() },
			{ label: 'Large', detail: 'Hard problems', checked: false, onselect: fn() }
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Thread actions' }));
		await waitFor(() =>
			expect(canvas.getByRole('menuitemradio', { name: /Medium/ })).toHaveFocus()
		);
		await expect(canvas.getByRole('menuitemradio', { name: /Medium/ })).toBeChecked();
	}}
>
	{#snippet template(args)}
		<div style="display: flex; justify-content: end; padding-block-end: 12rem">
			<Menu {...args}>
				{#snippet trigger(props)}
					<Button variant="ghost" size="sm" aria-label="Thread actions" {...props}>Mode</Button>
				{/snippet}
			</Menu>
		</div>
	{/snippet}
</Story>

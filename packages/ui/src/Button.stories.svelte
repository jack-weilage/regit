<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import Button from './Button.svelte';

	const { Story } = defineMeta({
		title: 'Button',
		component: Button,
		args: { onclick: fn() }
	});
</script>

<Story
	name="Primary"
	args={{ variant: 'primary' }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Start' }));
		await expect(args.onclick).toHaveBeenCalledOnce();
	}}>Start</Story
>
<Story name="Danger" args={{ variant: 'danger' }}>Delete thread</Story>
<Story name="Quiet">Dismiss</Story>
<Story name="Ghost" args={{ variant: 'ghost' }}>24% context</Story>
<Story name="Small" args={{ variant: 'primary', size: 'sm' }}>Spin off</Story>
<Story
	name="Disabled"
	args={{ variant: 'primary', disabled: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Start' })).toBeDisabled();
	}}>Start</Story
>

<Story
	name="Icon"
	args={{ variant: 'primary', icon: true, 'aria-label': 'Send' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Send' })).toBeVisible();
	}}
>
	<svg
		viewBox="0 0 16 16"
		aria-hidden="true"
		style="inline-size: 1rem; block-size: 1rem; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round"
	>
		<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
	</svg>
</Story>

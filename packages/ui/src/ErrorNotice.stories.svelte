<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ErrorNotice from './ErrorNotice.svelte';

	const { Story } = defineMeta({
		title: 'Error notice',
		component: ErrorNotice,
		args: { onretry: fn() }
	});
</script>

<Story
	name="Page"
	args={{
		title: 'No access',
		detail: 'Repository access denied',
		back: { href: '#', label: 'All repositories' }
	}}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('heading', { name: 'No access' })).toBeVisible();
		await expect(canvas.getByRole('link', { name: 'All repositories' })).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
		await expect(args.onretry).toHaveBeenCalledOnce();
	}}
/>

<Story name="Inline" args={{ title: "Couldn't show this entry", inline: true }} />

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import UpdatePrompt from './UpdatePrompt.svelte';

	const { Story } = defineMeta({
		title: 'Update prompt',
		component: UpdatePrompt,
		tags: ['!autodocs'],
		args: { onrefresh: fn() }
	});
</script>

<Story
	name="Available"
	play={async ({ args, canvas, userEvent }) => {
		const button = canvas.getByRole('button', { name: 'New version available Refresh' });
		await userEvent.tab();
		await expect(button).toHaveFocus();
		await userEvent.keyboard('{Enter}');
		await expect(args.onrefresh).toHaveBeenCalledOnce();
	}}
/>

<Story name="Dark">
	{#snippet template(args)}
		<div style="color-scheme: dark; background: var(--color-bg); padding: var(--space-6)">
			<UpdatePrompt {...args} />
		</div>
	{/snippet}
</Story>

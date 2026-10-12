<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ChangesPanel from './ChangesPanel.svelte';
	import { diffFiles } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Changes panel',
		component: ChangesPanel,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { files: diffFiles, onclose: fn() }
	});
</script>

<Story
	name="Open"
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('region', { name: 'Changes' })).toHaveTextContent(
			/4\s*files\s*\+23\s*−8/
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Close changes' }));
		await expect(args.onclose).toHaveBeenCalledOnce();
	}}
>
	{#snippet template(args)}
		<div style="block-size: 100dvh"><ChangesPanel {...args} /></div>
	{/snippet}
</Story>

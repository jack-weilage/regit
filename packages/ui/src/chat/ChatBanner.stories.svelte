<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import Button from '../Button.svelte';
	import ChatBanner from './ChatBanner.svelte';

	const reopen = fn();

	const { Story } = defineMeta({ title: 'Chat/Banner', component: ChatBanner });
</script>

<Story
	name="Archived"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Reopen' }));
		await expect(reopen).toHaveBeenCalledOnce();
	}}
>
	<div style="inline-size: 32rem">
		<ChatBanner>
			Archived by Sam. The conversation is read-only.
			{#snippet actions()}
				<Button size="sm" onclick={reopen}>Reopen</Button>
			{/snippet}
		</ChatBanner>
	</div>
</Story>

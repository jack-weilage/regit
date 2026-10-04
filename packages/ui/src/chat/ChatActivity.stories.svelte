<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ChatActivity from './ChatActivity.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Activity',
		component: ChatActivity,
		tags: ['!autodocs']
	});

	const ago = (seconds: number) => Date.now() - seconds * 1000;
</script>

<Story name="Thinking" asChild>
	<ChatActivity since={ago(3)}>Thinking</ChatActivity>
</Story>

<Story
	name="Installing toolchain"
	asChild
	play={async ({ canvas }) => {
		const activity = canvas.getByRole('status');
		await expect(activity).toHaveTextContent('Installing node 24, bun 1.4.2 · 31s');
		await waitFor(() => expect(activity).toHaveTextContent('· 32s'), { timeout: 2500 });
	}}
>
	<ChatActivity since={ago(31)}>Installing node 24, bun 1.4.2</ChatActivity>
</Story>

<Story name="Running a command" asChild>
	<ChatActivity since={ago(74)}>Running <code>bun run check</code></ChatActivity>
</Story>

<Story name="Without a timer" asChild>
	<ChatActivity>ReGit is reviewing the work</ChatActivity>
</Story>

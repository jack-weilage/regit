<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatMessage from './ChatMessage.svelte';
	import ChatThreadMessage from './ChatThreadMessage.svelte';
	import Markdown from './Markdown.svelte';
	import type { Mentionable } from './types.ts';

	const api: Mentionable = {
		kind: 'thread',
		handle: 'a1b2c3',
		label: 'feat(api): rename user id to account id',
		href: '#'
	};

	const { Story } = defineMeta({
		title: 'Chat/Thread message',
		component: ChatThreadMessage,
		tags: ['!autodocs']
	});
</script>

<Story
	name="Incoming"
	asChild
	play={async ({ canvas }) => {
		await expect(
			canvas.getByRole('article', { name: 'Message from feat(api): rename user id to account id' })
		).toBeVisible();
	}}
>
	<ChatThreadMessage direction="in" thread={api}>
		<ChatMessage
			><Markdown
				source={'`User.id` is now `User.accountId` (src/lib/user.ts:12). The settings page reads `user.id` in `+page.server.ts:31`, so update it there.'}
			/></ChatMessage
		>
	</ChatThreadMessage>
</Story>

<Story name="Outgoing" asChild>
	<ChatThreadMessage direction="out" thread={api}>
		<ChatMessage
			><Markdown
				source="Done: settings now reads `user.accountId`. Is `accountId` a string everywhere?"
			/></ChatMessage
		>
	</ChatThreadMessage>
</Story>

<Story name="Not read yet" asChild>
	<ChatThreadMessage direction="in" thread={api} pending>
		<ChatMessage>The API thread just shipped. Rebase before you touch the user model.</ChatMessage>
	</ChatThreadMessage>
</Story>

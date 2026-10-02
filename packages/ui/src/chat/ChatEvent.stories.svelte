<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatActivity from './ChatActivity.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatMention from './ChatMention.svelte';
	import { threads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Event',
		component: ChatEvent
	});
</script>

<Story name="Event" args={{ time: new Date('2026-10-02T14:03:00') }}>Attempt 1 started</Story>

<Story name="Activity" asChild>
	<ChatActivity>Running checks</ChatActivity>
</Story>

<Story name="Spun off" asChild>
	<ChatEvent>Spun off <ChatMention mention={threads[2]!} />&nbsp;· running</ChatEvent>
</Story>

<Story name="Dismissed" asChild>
	<ChatEvent
		>Dismissed separate work: <code>perf(settings): stop loading the full audit log</code
		></ChatEvent
	>
</Story>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatActivity from './ChatActivity.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatMention from './ChatMention.svelte';
	import { threads } from './fixtures.ts';
	import { expect, waitFor } from 'storybook/test';

	const { Story } = defineMeta({
		title: 'Chat/Event',
		component: ChatEvent
	});
</script>

<Story name="Event" args={{ time: new Date('2026-10-02T14:03:00') }}>Attempt 1 started</Story>

<Story
	name="Warning"
	args={{ tone: 'warning', time: new Date('2026-10-02T14:03:00') }}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('img', { name: 'Warning' })).toBeVisible());
	}}
>
	Ship conflicts with main in notes.md. Handing it back to the agent to bring up to date.
</Story>

<Story
	name="Danger"
	args={{ tone: 'danger', time: new Date('2026-10-02T14:03:00') }}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('img', { name: 'Failure' })).toBeVisible());
	}}
>
	Reverting 3f2a9c1 on main: Deploy checks failed (tests), and the fix did not make them pass.
</Story>

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

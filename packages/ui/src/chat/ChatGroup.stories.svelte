<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatGroup from './ChatGroup.svelte';
	import ChatMessage from './ChatMessage.svelte';

	const time = new Date('2026-10-02T14:02:00');

	const { Story } = defineMeta({
		title: 'Chat/Group',
		component: ChatGroup
	});
</script>

<Story name="Person" args={{ author: { name: 'Lin Wei', kind: 'person' }, time }}>
	<ChatMessage><p>I see this on the Acme org too.</p></ChatMessage>
	<ChatMessage><p>It takes about eight seconds before anything renders.</p></ChatMessage>
	<ChatMessage><p>Happy to test once there's a portal.</p></ChatMessage>
</Story>

<Story name="Own" args={{ author: { name: 'Sam Rivera', kind: 'person' }, time, own: true }}>
	<ChatMessage>
		<p>The settings page takes forever to load for big orgs. Can we make it faster?</p>
	</ChatMessage>
	<ChatMessage><p>Especially the ones with thousands of members.</p></ChatMessage>
</Story>

<Story name="Single" args={{ author: { name: 'Sam Rivera', kind: 'person' }, time, own: true }}>
	<ChatMessage><p>That one was about the members page.</p></ChatMessage>
</Story>

<Story name="Agent" args={{ author: { name: 'ReGit', kind: 'agent' } }}>
	<ChatMessage>
		<p>
			Found it: <code>loadSettings()</code> waits for <code>listMembers()</code> before rendering anything.
		</p>
	</ChatMessage>
	<ChatMessage>
		<pre><code
				>const [settings, count] = await Promise.all([
	db.settings(orgId),
	db.memberCount(orgId)
]);</code
			></pre>
	</ChatMessage>
</Story>

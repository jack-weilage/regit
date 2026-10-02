<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatGroup from './ChatGroup.svelte';
	import ChatMention from './ChatMention.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import { people, threads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Mention',
		component: ChatMention
	});
</script>

<Story name="Person" args={{ mention: people[1]! }} />

<Story name="Thread" args={{ mention: threads[0]! }} />

<Story name="In a message" asChild>
	<ChatGroup author={{ name: 'Lin Wei', kind: 'person' }}>
		<ChatMessage>
			<p>
				<ChatMention mention={people[0]!} /> this looks like
				<ChatMention mention={threads[0]!} /> again.
			</p>
		</ChatMessage>
	</ChatGroup>
</Story>

<Story name="Long names" asChild>
	<div style="inline-size: 18rem">
		<ChatGroup author={{ name: 'Lin Wei', kind: 'person' }}>
			<ChatMessage>
				<p>
					Ask <ChatMention mention={{ ...people[3]!, label: 'Noor Haddad-Al-Rashid Vandenberg' }} /> about
					<ChatMention
						mention={{
							...threads[2]!,
							label: 'Audit log retention policy for enterprise organisations'
						}}
					/>.
				</p>
			</ChatMessage>
		</ChatGroup>
	</div>
</Story>

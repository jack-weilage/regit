<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
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

<Story
	name="Thread"
	args={{ mention: { ...threads[0]!, number: 42, handle: 'a1b2c3d4e5f6' } }}
	play={async ({ canvas }) => {
		await expect(
			canvas.getByRole('link', { name: '#42 Paginate the member list' })
		).toHaveAttribute('href', '#');
		await expect(canvas.queryByText('a1b2c3d4e5f6')).not.toBeInTheDocument();
	}}
/>

<Story
	name="Deleted thread"
	args={{
		mention: {
			kind: 'thread',
			handle: 'gone',
			number: 7,
			label: 'Deleted thread',
			href: '#',
			deleted: true
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('link')).toBeNull();
		await expect(canvas.getByText('Deleted thread')).toBeVisible();
		await expect(canvas.getByText('#7')).toBeVisible();
	}}
/>

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

<Story
	name="Long names"
	asChild
	play={async ({ canvasElement }) => {
		const [person, thread] = canvasElement.querySelectorAll<HTMLElement>('.mention');
		const label = thread!.querySelector<HTMLElement>('.label')!;
		await expect(person!.getClientRects()).toHaveLength(1);
		await expect(thread!.getClientRects()).toHaveLength(1);
		await expect(label.scrollWidth).toBeGreaterThan(label.clientWidth);
	}}
>
	<div style="inline-size: 18rem">
		<ChatGroup author={{ name: 'Lin Wei', kind: 'person' }}>
			<ChatMessage>
				<p>
					Ask <ChatMention mention={{ ...people[3]!, label: 'Noor Haddad-Al-Rashid Vandenberg' }} /> about
					<ChatMention
						mention={{
							...threads[2]!,
							number: 1234,
							label: 'Audit log retention policy for enterprise organisations'
						}}
					/>.
				</p>
			</ChatMessage>
		</ChatGroup>
	</div>
</Story>

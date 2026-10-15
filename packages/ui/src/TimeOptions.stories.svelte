<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import TimeOptions from './TimeOptions.svelte';
	import ChatGroup from './chat/ChatGroup.svelte';
	import ChatMessage from './chat/ChatMessage.svelte';
	import ThreadList from './chat/ThreadList.svelte';

	const now = Date.UTC(2026, 9, 2, 18);
	const updatedAt = Date.UTC(2026, 8, 23, 12);

	const { Story } = defineMeta({
		title: 'Time options',
		component: TimeOptions
	});
</script>

{#snippet times()}
	<ChatGroup author={{ name: 'Sam Rivera', kind: 'person' }} time={new Date(updatedAt)}>
		<ChatMessage><p>Can we make it faster?</p></ChatMessage>
	</ChatGroup>
	<div style="inline-size: 17rem">
		<ThreadList
			{now}
			threads={[
				{
					id: 'search',
					headline: 'feat(search): fuzzy thread search',
					status: 'idle',
					updatedAt,
					href: '#'
				}
			]}
		/>
	</div>
{/snippet}

<Story
	name="Viewer's time zone"
	args={{ locale: 'en-US', timeZone: 'Pacific/Kiritimati', children: times }}
	play={async ({ canvasElement }) => {
		const shown = [...canvasElement.querySelectorAll('time')].map((time) => time.textContent);
		await expect(shown).toEqual(['2:00 AM', 'Sep 24']);
	}}
/>

<Story
	name="UTC"
	args={{ locale: 'en-GB', timeZone: 'UTC', children: times }}
	play={async ({ canvasElement }) => {
		const shown = [...canvasElement.querySelectorAll('time')].map((time) => time.textContent);
		await expect(shown).toEqual(['12:00', '23 Sept']);
	}}
/>

<Story
	name="Unknown time zone"
	args={{ locale: 'en-US', timeZone: 'Mars/Olympus', children: times }}
	play={async ({ canvasElement }) => {
		await expect(canvasElement.querySelectorAll('time')).toHaveLength(2);
	}}
/>

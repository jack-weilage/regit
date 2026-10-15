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
	args={{
		tone: 'warning',
		time: new Date('2026-10-02T14:03:00'),
		text: 'Ship conflicts with `main` in `notes.md`; handed back to the agent to bring up to date'
	}}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('img', { name: 'Warning' })).toBeVisible());
	}}
/>

<Story
	name="Danger"
	args={{
		tone: 'danger',
		time: new Date('2026-10-02T14:03:00'),
		text: 'Reverting `3f2a9c1` on `main`: Deploy checks failed (tests), and the fix did not make them pass.'
	}}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('img', { name: 'Failure' })).toBeVisible());
	}}
/>

<Story
	name="Inline code"
	args={{
		time: new Date('2026-10-02T14:03:00'),
		text: "Spun-off thread #2 (docs: change the notes) passed `main`'s deploy checks with `4f2a9c1`. An odd ` stays."
	}}
	play={async ({ canvasElement }) => {
		const event = canvasElement.querySelector('.event')!;
		await expect([...event.querySelectorAll('code')].map((code) => code.textContent)).toEqual([
			'main',
			'4f2a9c1'
		]);
		await expect(event.textContent).toContain("passed main's deploy checks");
		await expect(event.textContent).toContain('An odd ` stays.');
	}}
/>

<Story
	name="Wrapped warning"
	asChild
	play={async ({ canvasElement }) => {
		const text = canvasElement.querySelector<HTMLElement>('.event .text')!;
		const mark = canvasElement.querySelector<SVGElement>('.event .mark')!;
		const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
		await waitFor(() =>
			expect(text.getBoundingClientRect().height).toBeGreaterThan(2 * lineHeight)
		);
		await expect(getComputedStyle(text).textAlign).toBe('start');
		await expect(mark.getBoundingClientRect().right).toBeLessThanOrEqual(
			text.getBoundingClientRect().left
		);
		await expect(mark.getBoundingClientRect().top).toBeLessThan(
			text.getBoundingClientRect().top + lineHeight
		);
	}}
>
	<div style="inline-size: 18rem">
		<ChatEvent
			tone="warning"
			time={new Date('2026-10-02T14:03:00')}
			text="Ship conflicts with `main` in `apps/web/src/routes/[repo]/[thread]/+page.svelte`, `packages/ui/src/chat/ChatEvent.svelte`; handed back to the agent to bring up to date"
		/>
	</div>
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

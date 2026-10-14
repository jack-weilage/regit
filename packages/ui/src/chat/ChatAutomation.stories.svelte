<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatAutomation from './ChatAutomation.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import Markdown from './Markdown.svelte';
	import { automationsNow } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Automation',
		component: ChatAutomation,
		tags: ['!autodocs']
	});
</script>

<Story
	name="After a deploy"
	asChild
	play={async ({ canvas }) => {
		await expect(
			canvas.getByRole('article', { name: 'Automation post-deploy-check' })
		).toBeVisible();
		await expect(canvas.getByText(/Ran once/)).toBeVisible();
	}}
>
	<ChatAutomation
		name="post-deploy-check"
		trigger="15m after what this thread shipped deploys"
		run={1}
		limit={1}
		time={new Date(automationsNow)}
	>
		<ChatMessage
			><Markdown
				source="Check error rates and how long the settings page takes to load against the deploy."
			/></ChatMessage
		>
	</ChatAutomation>
</Story>

<Story name="On a schedule" asChild>
	<ChatAutomation
		name="flaky-e2e"
		trigger="On schedule 0 9 * * 1-5 (Europe/Berlin)"
		run={3}
		limit={5}
		time={new Date(automationsNow)}
	>
		<ChatMessage
			><Markdown
				source="Re-run the e2e suite on main and report whether `login.spec` is still flaky."
			/></ChatMessage
		>
	</ChatAutomation>
</Story>

<Story name="Not read yet" asChild>
	<ChatAutomation name="flag-cleanup" trigger="3d after it was set up" run={1} limit={1} pending>
		<ChatMessage>Remove the lazy-members feature flag if nobody reported problems.</ChatMessage>
	</ChatAutomation>
</Story>

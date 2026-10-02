<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import ChatIntent from './ChatIntent.svelte';
	import { threads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Intent',
		component: ChatIntent,
		args: {
			headline: 'perf(settings): render org settings without loading every member',
			purpose: 'Large orgs wait several seconds before the settings page shows anything.',
			doneWhen: ['Settings loads in under a second for an org with 5,000 members.']
		}
	});
</script>

<Story
	name="Suggested"
	args={{
		similar: [
			{ ...threads[0]!, detail: 'Discarded 3 days ago' },
			{ ...threads[1]!, detail: 'Shipped last week' }
		],
		onstart: fn()
	}}
/>

<Story name="Started" />

<Story name="Superseded" args={{ superseded: true }} />

<Story
	name="Several checks"
	args={{
		headline: 'feat(threads): suggest a reviewer from recent landings',
		purpose: 'Threads sit unclaimed until someone notices them.',
		doneWhen: [
			'New threads show a suggested reviewer within a minute.',
			'The suggestion comes from people who landed changes in the same area.',
			'Dismissing a suggestion never assigns anyone.'
		],
		onstart: fn()
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem">
		<ChatIntent
			headline="refactor(auth): move session checks into hooks"
			purpose="Every route repeats the same session lookup."
			doneWhen={['No route handler reads the session cookie directly.', 'All existing tests pass.']}
			onstart={fn()}
		/>
	</div>
</Story>

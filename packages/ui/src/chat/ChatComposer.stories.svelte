<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { fn } from 'storybook/test';
	import ChatComposer from './ChatComposer.svelte';
	import { mentionables } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Composer',
		component: ChatComposer,
		args: { onsend: fn(), placeholder: 'Describe what you want changed', mentions: mentionables }
	});
</script>

<Story name="Empty" />
<Story
	name="Draft"
	args={{ value: 'Make the settings page load faster for orgs with thousands of members.' }}
/>
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Narrow" asChild>
	<div style="inline-size: 20rem">
		<ChatComposer onsend={fn()} placeholder="Reply" mentions={mentionables} />
	</div>
</Story>

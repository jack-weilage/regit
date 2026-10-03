<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import StatusIcon from './StatusIcon.svelte';

	const { Story } = defineMeta({
		title: 'StatusIcon',
		component: StatusIcon,
		tags: ['!autodocs']
	});

	const states = [
		'pending',
		'running',
		'reviewing',
		'shipping',
		'attention',
		'passed',
		'failed'
	] as const;
</script>

<Story name="States" asChild>
	<ul style="display: flex; gap: 1.5rem; margin: 0; padding: 0; list-style: none">
		{#each states as state (state)}
			<li style="display: flex; align-items: center; gap: 0.375rem; font-size: 0.8125rem">
				<StatusIcon {state} />
				{state}
			</li>
		{/each}
	</ul>
</Story>

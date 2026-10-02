<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ThreadPreview from './ThreadPreview.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Thread preview',
		component: ThreadPreview,
		args: {
			headline: 'perf(settings): load members lazily',
			purpose:
				'The settings page loads every member before rendering, which takes seconds for big orgs.',
			mode: 'Medium',
			doneWhen: ['Settings render in under a second for 10k members', 'Members load as you scroll'],
			checkpoint: { sha: 'e2bac6e9f1c04b5a8d3e7f2a1b6c9d0e4f5a6b7c', count: 3, href: '#e2bac6e' },
			people: [
				{ name: 'Sam Rivera', kind: 'person' },
				{ name: 'Lin Wei', kind: 'person' }
			]
		}
	});
</script>

<Story name="Default" />
<Story
	name="Draft"
	args={{ checkpoint: undefined, doneWhen: ['Settings render in under a second'] }}
/>

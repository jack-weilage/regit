<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import ChatFooter from './ChatFooter.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Footer',
		component: ChatFooter,
		args: {
			mode: 'Medium',
			context: {
				used: 48_000,
				limit: 200_000,
				parts: [
					{ label: 'Instructions', tokens: 6_000 },
					{ label: 'Lessons', tokens: 2_000 },
					{ label: 'Thread', tokens: 9_000 },
					{ label: 'Code', tokens: 31_000 }
				]
			},
			usage: [
				{ task: 'Coding', model: 'kimi-k2.7-code', tokens: 980_000, cost: 0.71 },
				{ task: 'Search', model: 'qwen3-embedding', tokens: 160_000, cost: 0.02 },
				{ task: 'Review', model: 'clef', tokens: 60_000, cost: 0.11 }
			]
		}
	});
</script>

<Story name="Default" />

<Story name="Nearly full" args={{ mode: 'Large', context: { used: 182_000, limit: 200_000 } }} />

<Story name="Fresh" args={{ mode: 'Small', context: { used: 3_000, limit: 128_000 }, usage: [] }} />

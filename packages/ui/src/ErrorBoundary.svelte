<script lang="ts">
	import type { Snippet } from 'svelte';
	import ErrorNotice from './ErrorNotice.svelte';

	interface Props {
		title: string;
		resetOn?: unknown;
		children: Snippet;
	}

	let { title, resetOn, children }: Props = $props();
</script>

{#key resetOn}
	<svelte:boundary>
		{@render children()}
		{#snippet failed(_, reset)}
			<ErrorNotice {title} inline onretry={reset} />
		{/snippet}
	</svelte:boundary>
{/key}

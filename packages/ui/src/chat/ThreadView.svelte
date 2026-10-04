<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		header?: Snippet;
		bottom?: Snippet;
		children: Snippet;
	}

	let { header, bottom, children }: Props = $props();
</script>

<section class="thread">
	{@render header?.()}
	<div class="log">{@render children()}</div>
	{#if bottom}
		<div class="bottom">{@render bottom()}</div>
	{/if}
</section>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-inline-size: 0;
	}

	.log {
		display: grid;
		flex: 1;
		min-block-size: 0;
	}

	.bottom {
		box-sizing: border-box;
		display: grid;
		gap: var(--space-3);
		inline-size: 100%;
		max-inline-size: var(--thread-width);
		margin-inline: auto;
		padding: 0 var(--space-6) var(--space-4);
	}
</style>

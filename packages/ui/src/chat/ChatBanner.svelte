<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		actions?: Snippet;
		children: Snippet;
	}

	let { actions, children }: Props = $props();
</script>

<div class="banner">
	<p>{@render children()}</p>
	{#if actions}
		<div class="actions">{@render actions()}</div>
	{/if}
</div>

<style>
	.banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: var(--text-chat);
	}

	p {
		margin: 0;
	}

	.actions {
		display: flex;
		flex: none;
		gap: var(--space-3);
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';

	interface Props {
		since?: number;
		now?: number;
		children: Snippet;
	}

	let { since, now, children }: Props = $props();
</script>

<div class="activity chat-enter" role="status">
	<span class="dots" aria-hidden="true"><span></span><span></span><span></span></span>
	<span>
		{@render children()}
		{#if since !== undefined}
			<span class="elapsed" aria-hidden="true"
				>· {formatDuration((now ?? stopwatch.now) - since)}</span
			>
		{/if}
	</span>
</div>

<style>
	.activity {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.elapsed {
		font-variant-numeric: tabular-nums;
	}

	.dots {
		display: flex;
		gap: var(--space-2);

		span {
			inline-size: 0.5em;
			block-size: 0.5em;
			border-radius: 50%;
			background: currentColor;
			opacity: 0.4;
			animation: pulse 1.2s ease-in-out infinite;
		}

		span:nth-child(2) {
			animation-delay: 0.2s;
		}

		span:nth-child(3) {
			animation-delay: 0.4s;
		}
	}

	@keyframes pulse {
		30% {
			opacity: 1;
			translate: 0 -0.15em;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dots span {
			animation: none;
		}
	}
</style>

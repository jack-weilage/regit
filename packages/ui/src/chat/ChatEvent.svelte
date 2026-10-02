<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatTime } from './format.ts';

	interface Props {
		time?: Date;
		children: Snippet;
	}

	let { time, children }: Props = $props();
</script>

<p class="event chat-enter">
	<span>
		{@render children()}
		{#if time}
			· <time datetime={time.toISOString()}>{formatTime(time)}</time>
		{/if}
	</span>
</p>

<style>
	.event {
		display: flex;
		align-items: center;
		gap: var(--space-5);
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
		text-align: center;
		text-wrap: balance;

		&::before,
		&::after {
			content: '';
			flex: 1 1 1rem;
			border-block-start: 1px solid var(--color-border);
		}
	}

	span {
		flex: 0 1 auto;
	}

	time {
		font-variant-numeric: tabular-nums;
	}

	.event :global(code) {
		font-family: var(--font-mono);
		font-size: inherit;
	}
</style>

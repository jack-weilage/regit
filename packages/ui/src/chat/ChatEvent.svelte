<script lang="ts">
	import type { EventTone } from '@regit/core';
	import type { Snippet } from 'svelte';
	import { formatTime } from './format.ts';

	interface Props {
		time?: Date;
		tone?: EventTone;
		children: Snippet;
	}

	let { time, tone, children }: Props = $props();
</script>

<p class={['event', 'chat-enter', tone]}>
	<span>
		{#if tone}
			<svg
				class="mark"
				viewBox="0 0 16 16"
				role="img"
				aria-label={tone === 'danger' ? 'Failure' : 'Warning'}
			>
				{#if tone === 'danger'}
					<circle cx="8" cy="8" r="6" />
				{:else}
					<path d="M8 2.25 14.5 13.5h-13Z" />
				{/if}
				<path d={tone === 'danger' ? 'M8 5v3.5M8 11v.01' : 'M8 6.5v3.25M8 11.75v.01'} />
			</svg>
		{/if}
		{@render children()}
		{#if time}
			· <time datetime={time.toISOString()}>{formatTime(time)}</time>
		{/if}
	</span>
</p>

<style>
	.event {
		--tone: var(--color-muted);

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

		&.warning {
			--tone: var(--color-warning-text);
		}

		&.danger {
			--tone: var(--color-danger-text);
		}

		&:is(.warning, .danger) {
			color: var(--tone);

			&::before,
			&::after {
				border-color: color-mix(in oklab, var(--tone) 35%, var(--color-border));
			}
		}
	}

	span {
		flex: 0 1 auto;
	}

	.mark {
		inline-size: 1.2em;
		block-size: 1.2em;
		margin-inline-end: 0.3em;
		vertical-align: -0.25em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	time {
		font-variant-numeric: tabular-nums;
	}

	.event :global(code) {
		font-family: var(--font-mono);
		font-size: inherit;
	}
</style>

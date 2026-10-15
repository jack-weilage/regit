<script lang="ts">
	import type { EventTone } from '@regit/core';
	import type { Snippet } from 'svelte';
	import { useFormat } from './format.ts';

	interface Props {
		time?: Date;
		tone?: EventTone;
		/** Plain text where `backticked` spans render as code; used instead of children. */
		text?: string;
		children?: Snippet;
	}

	let { time, tone, text, children }: Props = $props();

	const format = useFormat();

	let parts = $derived(text?.split(/`([^`\n]+)`/) ?? []);
</script>

<p class={['event', 'chat-enter', tone]}>
	<span class="body">
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
		<span class="text">
			{#if text !== undefined}
				{#each parts as part, index (index)}{#if index % 2}<code
							>{#each part.split(/(?<=\/)/) as piece, at (at)}{#if at}<wbr
									/>{/if}{piece}{/each}</code
						>{:else}{part}{/if}{/each}
			{:else}
				{@render children?.()}
			{/if}
			{#if time}
				<span class="when">· <time datetime={time.toISOString()}>{format.time(time)}</time></span>
			{/if}
		</span>
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
		line-height: 1.5;
		text-align: center;
		text-wrap: balance;
		overflow-wrap: break-word;

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
			align-items: start;
			color: var(--tone);
			text-align: start;
			text-wrap: pretty;

			&::before,
			&::after {
				margin-block-start: 0.5lh;
				border-color: color-mix(in oklab, var(--tone) 35%, var(--color-border));
			}

			.body {
				display: flex;
				gap: 0.35em;
			}
		}
	}

	.body {
		flex: 0 1 auto;
		min-inline-size: 0;
	}

	.mark {
		flex: none;
		inline-size: 1.2em;
		block-size: 1.2em;
		margin-block-start: calc((1lh - 1.2em) / 2);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.when {
		white-space: nowrap;
	}

	time {
		font-variant-numeric: tabular-nums;
	}

	.event :global(code) {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}
</style>

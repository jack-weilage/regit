<script lang="ts">
	import type { DoneWhenResult } from '@regit/core';
	import StatusIcon from '../StatusIcon.svelte';
	import { doneWhenState } from './done-when.ts';

	interface Props {
		checks: string[];
		results?: Record<string, DoneWhenResult>;
	}

	let { checks, results = {} }: Props = $props();
</script>

<ul>
	{#each checks as check (check)}
		{@const result = results[check]}
		{@const { icon, label } = doneWhenState(result)}
		<li class={icon}>
			<StatusIcon state={icon} />
			<span class="text">
				{check}
				{#if result && label}<span class="evidence">{label} · {result.evidence}</span>{/if}
			</span>
		</li>
	{/each}
</ul>

<style>
	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		--icon-size: 1.25em;

		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-muted);

		> :global(svg) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}

		&.failed > :global(svg) {
			color: var(--color-danger-text);
		}
	}

	.text {
		display: grid;
		gap: var(--space-1);
		min-inline-size: 0;
		color: var(--color-fg);
	}

	.evidence {
		color: var(--color-muted);
		font-size: var(--text-meta);
		overflow-wrap: anywhere;
	}
</style>

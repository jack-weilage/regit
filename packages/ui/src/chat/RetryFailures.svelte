<script lang="ts">
	import type { RetryFailure } from '@regit/core';
	import { useFormat } from './format.ts';

	interface Props {
		failures: RetryFailure[];
	}

	let { failures }: Props = $props();

	const format = useFormat();

	// Runs of the same failure, such as an outage that outlasts several retries, collapse into one row.
	let runs = $derived(
		failures.reduce<(RetryFailure & { count: number })[]>((runs, failure) => {
			const last = runs.at(-1);
			if (last?.label === failure.label && last.error === failure.error) last.count++;
			else runs.push({ ...failure, count: 1 });
			return runs;
		}, [])
	);
</script>

<ol class="failures">
	{#each runs as run, index (index)}
		<li>
			<time datetime={new Date(run.at).toISOString()}>{format.clock(run.at)}</time>
			<span class="label"
				>{run.label}{#if run.count > 1}&nbsp;×{run.count}{/if}</span
			>
			<span class="error">{run.error}</span>
		</li>
	{/each}
</ol>

<style>
	.failures {
		display: grid;
		gap: var(--space-2);
		max-block-size: 14em;
		margin: var(--space-2) 0 0;
		padding: 0;
		overflow: auto;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: baseline;
		gap: var(--space-3);
	}

	time {
		font-variant-numeric: tabular-nums;
	}

	.label {
		color: var(--color-fg);
		font-variant-numeric: tabular-nums;
	}

	.error {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}
</style>

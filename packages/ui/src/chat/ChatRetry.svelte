<script lang="ts">
	import type { Retry } from '@regit/core';
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import RetryFailures from './RetryFailures.svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';

	interface Props {
		retry: Retry;
		now?: number;
		onretrynow?: () => unknown;
	}

	let { retry, now, onretrynow }: Props = $props();

	let last = $derived(retry.failures.at(-1));
	let wait = $derived(retry.next === null ? 0 : retry.next - (now ?? stopwatch.now));
	let what = $derived(retry.what.charAt(0).toUpperCase() + retry.what.slice(1));
</script>

<section class="retry chat-enter" aria-label="Retrying">
	<header>
		<p class="title" role="status">
			<StatusIcon state="attention" />
			<span>
				{last?.label ?? what} failed · retrying
				{#if wait >= 1000}<span aria-hidden="true">in {formatDuration(wait)}</span>{/if}
			</span>
		</p>
		{#if onretrynow && wait >= 1000}
			<Button size="xs" onclick={onretrynow}>Retry now</Button>
		{/if}
	</header>
	{#if last}<p class="error">{last.error}</p>{/if}
	<p class="attempt">{what} attempt {retry.attempt} of {retry.limit}</p>
	{#if retry.failures.length > 1}
		<details>
			<summary>{retry.failures.length} failures</summary>
			<RetryFailures failures={retry.failures} />
		</details>
	{/if}
</section>

<style>
	.retry {
		--icon-size: 1em;

		display: grid;
		gap: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
	}

	p {
		margin: 0;
	}

	.title {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		color: var(--color-fg);

		:global(svg) {
			color: var(--color-accent);
		}
	}

	.error {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}

	.attempt {
		font-variant-numeric: tabular-nums;
	}

	summary {
		inline-size: fit-content;
		cursor: pointer;

		&:hover {
			color: var(--color-fg);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
			border-radius: var(--radius);
		}
	}
</style>

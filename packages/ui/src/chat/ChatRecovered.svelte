<script lang="ts">
	import type { RetryFailure } from '@regit/core';
	import StatusIcon from '../StatusIcon.svelte';
	import RetryFailures from './RetryFailures.svelte';

	interface Props {
		failures: RetryFailure[];
	}

	let { failures }: Props = $props();

	let count = $derived(failures.length === 1 ? '1 failure' : `${failures.length} failures`);
</script>

<details class="recovered chat-enter">
	<summary><StatusIcon state="passed" /> Recovered after {count}</summary>
	<RetryFailures {failures} />
</details>

<style>
	.recovered {
		--icon-size: 1em;

		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	summary {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		inline-size: fit-content;
		padding-block: var(--space-1);
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

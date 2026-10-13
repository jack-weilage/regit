<script lang="ts">
	import type { RetryFailure } from '@regit/core';
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import RetryFailures from './RetryFailures.svelte';
	import { formatTime } from './format.ts';

	interface Props {
		title: string;
		error: string;
		failures?: RetryFailure[];
		time?: Date;
		onresume?: () => Promise<unknown>;
	}

	let { title, error, failures = [], time, onresume }: Props = $props();

	let busy = $state(false);
	let problem = $state<string | null>(null);

	async function resume() {
		busy = true;
		problem = null;
		try {
			await onresume?.();
		} catch (cause) {
			problem = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<section class="failure chat-enter" aria-label={title}>
	<header>
		<strong class="title">
			<StatusIcon state="failed" />
			{title}
			{#if time}
				<time datetime={time.toISOString()}>· {formatTime(time)}</time>
			{/if}
		</strong>
		{#if onresume}
			<Button size="sm" disabled={busy} onclick={resume}>Try again</Button>
		{/if}
	</header>
	<p class="error">{error}</p>
	{#if failures.length > 1}
		<details>
			<summary>{failures.length} attempts</summary>
			<RetryFailures {failures} />
		</details>
	{/if}
	{#if problem}<p class="problem" role="alert">{problem}</p>{/if}
</section>

<style>
	.failure {
		--icon-size: 1em;

		display: grid;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--color-danger);
		border-radius: var(--radius-lg);
		font-size: var(--text-chat);
		line-height: 1.5;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2) var(--space-5);
	}

	.title {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		font-weight: 600;

		:global(svg) {
			color: var(--color-danger-text);
		}
	}

	time {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: normal;
		font-variant-numeric: tabular-nums;
	}

	p {
		margin: 0;
	}

	.error {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		overflow-wrap: anywhere;
	}

	.problem {
		color: var(--color-danger-text);
		font-size: var(--text-meta);
	}

	details {
		color: var(--color-muted);
		font-size: var(--text-meta);
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

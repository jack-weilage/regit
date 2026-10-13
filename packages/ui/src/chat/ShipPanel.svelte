<script module lang="ts">
	import type { ShipStage } from '@regit/core';

	const stages: { stage: ShipStage; label: (branch: string) => string }[] = [
		{ stage: 'checking', label: () => 'Running checks' },
		{ stage: 'fetching', label: () => "Fetching the thread's work" },
		{ stage: 'building', label: (branch) => `Building one commit on ${branch}` },
		{ stage: 'pushing', label: (branch) => `Pushing to ${branch}` },
		{ stage: 'recording', label: () => 'Recording provenance' }
	];

	const icons = { passed: 'passed', failed: 'failed', warned: 'attention' } as const;
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import ChatRetry from './ChatRetry.svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';
	import type { CheckResult, CheckRun, Intent, ShipProgress, ThreadStatus } from '@regit/core';

	interface Props {
		intent?: Intent;
		status: ThreadStatus;
		progress?: ShipProgress | null;
		checks?: CheckRun | null;
		branch: string;
		now?: number;
		onship: (commit: { title: string; body: string }) => Promise<unknown>;
	}

	let { intent, status, progress, checks, branch: known, now, onship }: Props = $props();

	const uid = $props.id();

	let visible = $derived(
		stages.filter(
			({ stage }) =>
				stage !== 'checking' || progress?.stage === 'checking' || checks?.action === 'ship'
		)
	);
	let current = $derived(visible.findIndex(({ stage }) => stage === progress?.stage));
	let branch = $derived(progress?.branch ?? known);

	let busy = $state(false);
	let error = $state<string | null>(null);
	let writing = $state(false);
	let title = $state('');
	let body = $state('');

	let shipping = $derived(status === 'shipping');

	async function ship() {
		busy = true;
		error = null;
		try {
			await onship({ title, body });
			writing = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

{#snippet check(result: CheckResult)}
	<StatusIcon state={icons[result.status]} />
	<span class="name">{result.name}</span>
	{#if result.reused}<span class="reused">unchanged</span>{/if}
{/snippet}

<section class="ship" aria-label="Ship" aria-busy={busy || shipping}>
	<header>
		<strong class="heading"
			><StatusIcon state={shipping ? 'shipping' : 'pending'} />
			{shipping ? `Shipping to ${branch}` : 'Unshipped changes'}</strong
		>
		{#if shipping && progress}
			<span class="elapsed">{formatDuration((now ?? stopwatch.now) - progress.started)}</span>
		{/if}
		{#if !writing && !shipping}
			<Button
				variant="primary"
				size="sm"
				disabled={status !== 'needs-you'}
				onclick={() => {
					title = intent?.headline ?? '';
					body = intent?.purpose ?? '';
					writing = true;
				}}>Ship</Button
			>
		{/if}
	</header>
	{#if shipping}
		<ol aria-label="Shipping progress">
			{#each visible as { stage, label }, index (stage)}
				{@const state = index < current ? 'passed' : index === current ? 'running' : 'pending'}
				<li class={state} aria-current={index === current ? 'step' : undefined}>
					<StatusIcon {state} />
					<span>
						{label(branch)}
						{#if index === current && progress?.note}<span class="note">{progress.note}</span>{/if}
					</span>
				</li>
			{/each}
		</ol>
		{#if progress?.retry}<ChatRetry retry={progress.retry} {now} />{/if}
	{/if}
	{#if !shipping && checks?.results.length}
		<div class="checks">
			<p class="label" id="{uid}-checks">Checks before {checks.action}</p>
			<ul aria-labelledby="{uid}-checks">
				{#each checks.results as result (result.name)}
					<li class={result.status}>
						{#if result.status !== 'passed' && result.output}
							<details>
								<summary>{@render check(result)}</summary>
								<pre>{result.output}</pre>
							</details>
						{:else}
							<div class="row">{@render check(result)}</div>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if writing && !shipping}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				ship();
			}}
		>
			<label>Commit title <input required maxlength="200" bind:value={title} /></label>
			<label>Commit body <textarea rows="3" maxlength="20000" bind:value={body}></textarea></label>
			<div class="actions">
				<Button size="sm" disabled={busy} onclick={() => (writing = false)}>Cancel</Button>
				<Button type="submit" variant="primary" size="sm" disabled={busy || status !== 'needs-you'}
					>Ship commit</Button
				>
			</div>
		</form>
	{/if}
</section>

<style>
	.ship {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		font-size: var(--text-chat);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-2) var(--space-5);
	}

	.heading {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		font-weight: 600;

		:global(svg) {
			color: var(--color-muted);
			font-size: var(--text-meta);
		}
	}

	p,
	ol,
	ul {
		margin: 0;
	}

	.elapsed {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	ol {
		display: grid;
		gap: var(--space-2);
		padding: 0;
		list-style: none;
		font-size: var(--text-meta);
	}

	li {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		color: var(--color-muted);

		&.running {
			color: var(--color-fg);
		}
	}

	.note {
		margin-inline-start: var(--space-3);
		color: var(--color-muted);
	}

	.error {
		color: var(--color-danger-text);
	}

	.checks {
		display: grid;
		gap: var(--space-2);
		min-inline-size: 0;
		font-size: var(--text-meta);
	}

	.label {
		color: var(--color-muted);
	}

	ul {
		display: grid;
		gap: var(--space-1);
		padding: 0;
		list-style: none;
		min-inline-size: 0;
	}

	ul li {
		display: block;
		min-inline-size: 0;
		color: var(--color-fg);

		&.passed :global(svg) {
			color: var(--color-muted);
		}

		&.failed {
			:global(svg),
			.name {
				color: var(--color-danger-text);
			}
		}
	}

	.row,
	summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-1);
	}

	summary {
		inline-size: fit-content;
		max-inline-size: 100%;
		list-style: none;
		cursor: pointer;

		&::-webkit-details-marker {
			display: none;
		}

		&::after {
			content: '';
			border-block: 0.3em solid transparent;
			border-inline-start: 0.4em solid var(--color-muted);
			transition: rotate 0.15s;
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
			border-radius: var(--radius);
		}
	}

	details[open] > summary::after {
		rotate: 90deg;
	}

	.reused {
		color: var(--color-muted);
	}

	pre {
		max-block-size: 14em;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-family: var(--font-mono);
		font-size: inherit;
	}

	form {
		display: grid;
		gap: var(--space-4);
		min-inline-size: 0;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-3);
	}

	label {
		display: grid;
		gap: var(--space-2);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	input,
	textarea {
		box-sizing: border-box;
		min-inline-size: 0;
		inline-size: 100%;
		font: inherit;
		font-size: var(--text-chat);
		color: var(--color-fg);
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		padding: 0.5em 0.75em;
	}

	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	textarea {
		resize: vertical;
	}
</style>

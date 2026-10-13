<script module lang="ts">
	import type { ShipStage } from '@regit/core';

	const stages: { stage: ShipStage; label: string }[] = [
		{ stage: 'fetching', label: "Fetching the thread's work" },
		{ stage: 'building', label: 'Building one commit on main' },
		{ stage: 'pushing', label: 'Pushing to main' },
		{ stage: 'recording', label: 'Recording provenance' }
	];
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';
	import type { Intent, ShipProgress, ThreadStatus } from '@regit/core';

	interface Props {
		intent?: Intent;
		status: ThreadStatus;
		progress?: ShipProgress | null;
		now?: number;
		onship: (commit: { title: string; body: string }) => Promise<unknown>;
	}

	let { intent, status, progress, now, onship }: Props = $props();

	let current = $derived(stages.findIndex(({ stage }) => stage === progress?.stage));

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

<section class="ship" aria-label="Ship" aria-busy={busy || shipping}>
	<header>
		<strong class="heading"
			><StatusIcon state={shipping ? 'shipping' : 'pending'} />
			{shipping ? 'Shipping to main' : 'Unshipped changes'}</strong
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
			{#each stages as { stage, label }, index (stage)}
				{@const state = index < current ? 'passed' : index === current ? 'running' : 'pending'}
				<li class={state} aria-current={index === current ? 'step' : undefined}>
					<StatusIcon {state} />
					<span>
						{label}
						{#if index === current && progress?.note}<span class="note">{progress.note}</span>{/if}
					</span>
				</li>
			{/each}
		</ol>
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
					>Ship to main</Button
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
	ol {
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

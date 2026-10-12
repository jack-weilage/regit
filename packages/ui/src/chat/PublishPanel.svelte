<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import type { StatusIconState } from './status.ts';
	import type { Intent, Promotion, ThreadStatus } from '@regit/core';

	let {
		promotions,
		intent,
		status,
		hasChanges,
		onprepare,
		onapprove
	}: {
		promotions: Promotion[];
		intent?: Intent;
		status: ThreadStatus;
		hasChanges: boolean;
		onprepare: (commit: { title: string; body: string }) => Promise<unknown>;
		onapprove: (promotion: string) => Promise<unknown>;
	} = $props();
	let busy = $state(false);
	let error = $state<string | null>(null);
	let preparing = $state(false);
	let title = $state('');
	let body = $state('');
	let promotion = $derived(promotions.at(-1));
	let pending = $derived(
		promotions.some((p) => ['queued', 'preparing', 'ready', 'publishing'].includes(p.status))
	);
	const states: Record<Promotion['status'], { label: string; icon: StatusIconState }> = {
		queued: { label: 'Candidate queued', icon: 'pending' },
		preparing: { label: 'Preparing candidate', icon: 'running' },
		ready: { label: 'Awaiting owner approval', icon: 'attention' },
		publishing: { label: 'Publishing approved candidate', icon: 'shipping' },
		shipped: { label: 'Published', icon: 'passed' },
		failed: { label: 'Publication stopped', icon: 'failed' },
		cancelled: { label: 'Candidate cancelled', icon: 'pending' }
	};
	async function act(action: () => Promise<unknown>) {
		busy = true;
		error = null;
		try {
			await action();
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<section class="publish" aria-label="Publication" aria-busy={busy}>
	<header>
		<strong class="heading"
			><StatusIcon state={promotion ? states[promotion.status].icon : 'pending'} />
			{promotion ? states[promotion.status].label : 'Unpublished changes'}
		</strong>
		{#if promotion?.candidate}<span class="meta"
				><code>{promotion.candidate.sha.slice(0, 12)}</code> → {promotion.candidate.branch}</span
			>{/if}
	</header>
	{#if !pending && hasChanges}
		<p class="meta">
			Preparation builds one exact commit without publishing it. A repository owner approves
			publication separately.
		</p>
	{/if}
	{#if promotion?.status === 'ready'}
		<p class="meta">Owner approval publishes this exact candidate.</p>
	{/if}
	{#if error || promotion?.error}<p class="error" role="alert">{error ?? promotion?.error}</p>{/if}

	{#if preparing}
		<form
			onsubmit={(event) => {
				event.preventDefault();
				act(async () => {
					await onprepare({ title, body });
					preparing = false;
				});
			}}
		>
			<label>Commit title <input required maxlength="200" bind:value={title} /></label>
			<label>Commit body <textarea rows="3" maxlength="20000" bind:value={body}></textarea></label>
			<div class="actions">
				<Button size="sm" disabled={busy} onclick={() => (preparing = false)}>Cancel</Button>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					disabled={busy || pending || status !== 'needs-you'}>Prepare candidate</Button
				>
			</div>
		</form>
	{/if}

	{#if promotions.length}
		<details class="provenance">
			<summary>Candidate history</summary>
			<div class="details-body">
				{#each promotions.toReversed() as item (item.id)}
					<div class="details-body">
						<strong>Candidate {item.id} · {item.status}</strong>
						<dl>
							<dt>Source</dt>
							<dd><code>{item.source?.sha}</code></dd>
							{#if item.candidate}
								<dt>Exact SHA</dt>
								<dd><code>{item.candidate.sha}</code></dd>
								<dt>Expected base</dt>
								<dd><code>{item.candidate.expectedHead}</code></dd>
								<dt>Repository</dt>
								<dd>{item.candidate.repository} · {item.candidate.branch}</dd>
							{/if}
						</dl>
						{#if item.error && item !== promotion}<p class="error">{item.error}</p>{/if}
					</div>
				{/each}
			</div>
		</details>
	{/if}

	{#if !preparing && (promotion?.status === 'ready' || (status === 'needs-you' && hasChanges && !pending))}
		<footer class="actions">
			{#if promotion?.status === 'ready' && promotion.candidate}
				<Button
					size="sm"
					variant="primary"
					disabled={busy}
					onclick={() => act(() => onapprove(promotion!.id))}
					>Approve and publish {promotion.candidate.sha.slice(0, 12)}</Button
				>
			{:else}
				<Button
					size="sm"
					variant="primary"
					disabled={busy}
					onclick={() => {
						title = intent?.headline ?? '';
						body = intent?.purpose ?? '';
						preparing = true;
					}}>Prepare candidate</Button
				>
			{/if}
		</footer>
	{/if}
</section>

<style>
	.publish {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-6);
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
		align-items: baseline;
		gap: var(--space-2) var(--space-5);
	}
	.heading {
		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		font-weight: 600;
	}
	.heading :global(svg),
	.meta,
	.provenance {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}
	p,
	dl,
	dd {
		margin: 0;
	}
	.details-body,
	form {
		display: grid;
		gap: var(--space-4);
		min-inline-size: 0;
	}
	.details-body {
		margin-block-start: var(--space-4);
	}
	summary {
		cursor: pointer;
		inline-size: fit-content;
	}
	summary:hover {
		color: var(--color-fg);
	}
	.error {
		color: var(--color-danger-text);
	}
	dl {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2) var(--space-5);
	}
	code {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		align-items: center;
		gap: var(--space-3);
	}
	footer {
		border-block-start: 1px solid var(--color-border);
		padding-block-start: var(--space-4);
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

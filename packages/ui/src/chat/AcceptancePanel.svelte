<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import Markdown from './Markdown.svelte';
	import type { StatusIconState } from './status.ts';
	import type { Intent, Promotion, ProposalControl, ThreadStatus } from '@regit/core';

	let {
		control,
		intent,
		status,
		hasChanges,
		onaccept,
		onstart,
		onprepare,
		onapprove
	}: {
		control?: ProposalControl;
		intent?: Intent;
		status: ThreadStatus;
		hasChanges: boolean;
		onaccept: () => Promise<unknown>;
		onstart: () => Promise<unknown>;
		onprepare: (commit: { title: string; body: string }) => Promise<unknown>;
		onapprove: (promotion: string) => Promise<unknown>;
	} = $props();
	let needsRun = $derived(
		!!control?.runs.length && control.runs.at(-1)?.intent !== control.acceptedIntent?.id
	);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let preparing = $state(false);
	let title = $state('');
	let body = $state('');
	let promotion = $derived(control?.promotions.at(-1));
	let pending = $derived(
		control?.promotions.some((p) =>
			['queued', 'preparing', 'ready', 'publishing'].includes(p.status)
		) ?? false
	);
	let changed = $derived(
		!!intent && JSON.stringify(intent) !== JSON.stringify(control?.acceptedIntent?.intent)
	);
	let canStart = $derived(!!intent && ['draft', 'needs-you'].includes(status));
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

<section class="acceptance" aria-label="Acceptance and publication" aria-busy={busy}>
	<header>
		<strong class="heading"
			><StatusIcon state={promotion ? states[promotion.status].icon : 'pending'} />
			{promotion
				? states[promotion.status].label
				: changed
					? 'Intent awaiting acceptance'
					: control?.acceptedIntent
						? 'Intent accepted'
						: 'Acceptance'}
		</strong>
		{#if promotion?.candidate}<span class="meta"
				><code>{promotion.candidate.sha.slice(0, 12)}</code> → {promotion.candidate.branch}</span
			>{/if}
	</header>
	{#if changed && intent}
		<div class="proposed">
			<p class="headline">{intent.headline}</p>
			<p class="meta">
				{control?.acceptedIntent
					? 'Changed intent · accepting cancels pending candidates; retained revisions stay available.'
					: 'No intent has been accepted yet.'}
			</p>
		</div>
	{:else if !control?.acceptedIntent}
		<p class="meta">No intent has been accepted yet.</p>
	{/if}
	{#if !promotion && control?.acceptedIntent}
		<p class="meta">
			Preparation builds one exact commit without publishing it. A repository owner approves
			publication separately.
		</p>
	{/if}
	{#if promotion?.status === 'ready'}
		<p class="meta">Owner approval publishes this exact candidate.</p>
	{/if}
	{#if error || promotion?.error}<p class="error" role="alert">{error ?? promotion?.error}</p>{/if}

	{#if needsRun}<p class="warning">
			Intent changed. Start a new run before preparing a candidate.
		</p>{/if}

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
					disabled={busy || needsRun || pending || status !== 'needs-you'}>Prepare candidate</Button
				>
			</div>
		</form>
	{/if}

	{#if control}
		<details class="provenance">
			<summary>Provenance and history</summary>
			<div class="details-body">
				{#if control.acceptedIntent}
					<strong>Accepted intent · {control.acceptedIntent.intent.headline}</strong>
					<p>
						<code>{control.acceptedIntent.id}</code> · accepted by {control.acceptedIntent
							.acceptedBy.name}
					</p>
					<Markdown source={control.acceptedIntent.intent.purpose} />
					<ul>
						{#each control.acceptedIntent.intent.doneWhen as check, index (index)}<li>
								{check}
							</li>{/each}
					</ul>
				{/if}
				{#if promotion}{@render provenance(promotion)}{/if}
				<details>
					<summary>Run history and retained revisions</summary>
					<div class="details-body">
						{#each control.runs as run (run.id)}<p>
								Run <code>{run.id}</code> · {run.status} · intent <code>{run.intent}</code>
							</p>{/each}
						{#each control.revisions as revision (revision.id)}<p>
								Revision <code>{revision.id}</code> · run <code>{revision.run}</code><br />SHA
								<code>{revision.sha}</code><br />Base <code>{revision.base}</code>
							</p>{/each}
					</div>
				</details>
				{#each control.promotions.slice(0, -1) as previous (previous.id)}
					<details>
						<summary>Candidate {previous.id} · {previous.status}</summary>
						<div class="details-body">
							{@render provenance(previous)}
							{#if previous.error}<p class="error">{previous.error}</p>{/if}
						</div>
					</details>
				{/each}
			</div>
		</details>
	{/if}

	{#if !preparing && (canStart || (promotion?.status === 'ready' && promotion.candidate))}
		<footer class="actions">
			{#if canStart}
				{#if changed}<Button size="sm" disabled={busy} onclick={() => act(onaccept)}
						>Accept proposed intent</Button
					>{/if}
				<Button
					size="sm"
					variant={changed && promotion?.status !== 'ready' ? 'primary' : 'quiet'}
					disabled={busy}
					onclick={() => act(onstart)}
					>{changed ? 'Accept intent and start new run' : 'Start new run'}</Button
				>
			{/if}
			{#if promotion?.status === 'ready' && promotion.candidate}
				<Button
					size="sm"
					variant="primary"
					disabled={busy || needsRun}
					onclick={() => act(() => onapprove(promotion!.id))}
					>Approve and publish {promotion.candidate.sha.slice(0, 12)}</Button
				>
			{:else if status === 'needs-you' && hasChanges && !pending}
				<Button
					size="sm"
					variant="primary"
					disabled={busy || needsRun}
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

{#snippet provenance(item: Promotion)}
	<dl>
		<dt>Candidate</dt>
		<dd><code>{item.id}</code></dd>
		{#if item.candidate}
			<dt>Exact SHA</dt>
			<dd><code>{item.candidate.sha}</code></dd>
			<dt>Expected base</dt>
			<dd><code>{item.candidate.expectedHead}</code></dd>
			<dt>Repository</dt>
			<dd>{item.candidate.repository} · {item.candidate.branch}</dd>
		{/if}
	</dl>
{/snippet}

<style>
	.acceptance {
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
	.headline {
		font-family: var(--font-mono);
		font-weight: 500;
	}
	p,
	ul,
	dl,
	dd {
		margin: 0;
	}
	.proposed,
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
	.warning {
		padding: var(--space-4) var(--space-5);
		border: 1px solid color-mix(in oklab, var(--color-accent) 45%, var(--color-border));
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--color-accent) 8%, transparent);
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

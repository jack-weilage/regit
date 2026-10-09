<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import Markdown from './Markdown.svelte';
	import type { StatusIconState } from './status.ts';
	import type { Assessment, Intent, Promotion, ProposalControl, ThreadStatus } from '@regit/core';

	let {
		control,
		intent,
		status,
		hasChanges,
		onaccept,
		onstart,
		onprepare,
		onapprove,
		proposals = [],
		onpin,
		onunpin
	}: {
		control?: ProposalControl;
		intent?: Intent;
		status: ThreadStatus;
		hasChanges: boolean;
		onaccept: () => Promise<unknown>;
		onstart: () => Promise<unknown>;
		onprepare: (commit: { title: string; body: string }) => Promise<unknown>;
		onapprove: (promotion: string) => Promise<unknown>;
		proposals?: { id: string; headline: string }[];
		onpin?: (proposal: string) => Promise<unknown>;
		onunpin?: (proposal: string) => Promise<unknown>;
	} = $props();
	let dependency = $state('');
	let blocked = $derived(control?.dependencies?.some((d) => d.status !== 'ready') ?? false);
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
			['queued', 'preparing', 'reviewing', 'ready', 'publishing'].includes(p.status)
		) ?? false
	);
	let changed = $derived(
		!!intent && JSON.stringify(intent) !== JSON.stringify(control?.acceptedIntent?.intent)
	);
	let canStart = $derived(!!intent && ['draft', 'needs-you'].includes(status));
	const states: Record<Promotion['status'], { label: string; icon: StatusIconState }> = {
		queued: { label: 'Candidate queued', icon: 'pending' },
		preparing: { label: 'Preparing candidate', icon: 'running' },
		reviewing: { label: 'Assessing candidate', icon: 'reviewing' },
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
	{#if promotion?.assessment}
		{@render assessment(promotion.assessment)}
	{:else if !promotion && control?.acceptedIntent}
		<p class="meta">
			Preparation assesses an exact commit without publishing it. A repository owner approves
			publication separately.
		</p>
	{/if}
	{#if promotion?.status === 'ready'}
		<p class="meta">
			Owner approval publishes this exact candidate. Model judgment is not trusted executable proof
			or authorization.
		</p>
	{/if}
	{#if error || promotion?.error}<p class="error" role="alert">{error ?? promotion?.error}</p>{/if}

	{#if control?.dependencies?.length || (onpin && control?.acceptedIntent)}
		<div class="dependencies">
			<strong>Dependencies</strong>
			<p class="meta">
				Runs wait for these exact revisions to publish. Pins never advance automatically.
			</p>
			{#each control?.dependencies ?? [] as item (item.pin.proposal)}
				<div class="dependency">
					<p>
						{proposals.find((p) => p.id === item.pin.proposal)?.headline ?? item.pin.proposal} ·
						<code>{item.pin.sha.slice(0, 12)}</code>
					</p>
					<p class="meta">{item.status} · {item.reason}</p>
					{#if canStart && onunpin && onpin}
						<div class="actions">
							<Button size="sm" disabled={busy} onclick={() => act(() => onpin!(item.pin.proposal))}
								>Update pin</Button
							>
							<Button
								size="sm"
								disabled={busy}
								onclick={() => act(() => onunpin!(item.pin.proposal))}>Remove dependency</Button
							>
						</div>
					{/if}
				</div>
			{/each}
			{#if canStart && onpin && proposals.length}
				<form
					onsubmit={(event) => {
						event.preventDefault();
						act(() => onpin!(dependency));
					}}
				>
					<label
						>Prerequisite proposal
						<select bind:value={dependency} required>
							<option value="" disabled>Select a proposal</option>
							{#each proposals as proposal (proposal.id)}<option value={proposal.id}
									>{proposal.headline}</option
								>{/each}
						</select>
					</label>
					<div class="actions">
						<Button type="submit" size="sm" disabled={busy || !dependency}
							>Pin current revision</Button
						>
					</div>
				</form>
			{/if}
		</div>
	{/if}
	{#if needsRun}<p class="warning">
			Intent or dependency pins changed. Start a new run before preparing a candidate.
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
					disabled={busy || blocked || needsRun || pending || status !== 'needs-you'}
					>Prepare candidate</Button
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
							{#if previous.assessment}{@render assessment(previous.assessment)}{/if}
							{#if previous.error}<p class="error">{previous.error}</p>{/if}
						</div>
					</details>
				{/each}
				{#if control.assessments.length}
					<details>
						<summary>Revision model assessments</summary>
						<div class="details-body">
							{#each control.assessments as item (item.id)}{@render assessment(item)}{/each}
						</div>
					</details>
				{/if}
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
					disabled={busy || blocked}
					onclick={() => act(onstart)}
					>{changed ? 'Accept intent and start new run' : 'Start new run'}</Button
				>
			{/if}
			{#if promotion?.status === 'ready' && promotion.candidate}
				<Button
					size="sm"
					variant="primary"
					disabled={busy || blocked || needsRun}
					onclick={() => act(() => onapprove(promotion!.id))}
					>Approve and publish {promotion.candidate.sha.slice(0, 12)}</Button
				>
			{:else if status === 'needs-you' && hasChanges && !pending}
				<Button
					size="sm"
					variant="primary"
					disabled={busy || blocked || needsRun}
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
		{#if item.assessment}
			<dt>Assessed by</dt>
			<dd>{item.assessment.producer}</dd>
			<dt>Assessed revision</dt>
			<dd><code>{item.assessment.revision}</code></dd>
			<dt>Intent</dt>
			<dd><code>{item.assessment.intent}</code></dd>
		{/if}
	</dl>
{/snippet}

{#snippet assessment(item: Assessment)}
	<div class="assessment">
		<p class="meta">Model assessment · <strong>{item.verdict}</strong></p>
		<ul class="checks">
			{#each item.checks as check, index (index)}
				<li>
					<span class="mark" role="img" aria-label={check.state}
						><StatusIcon
							state={check.state === 'met'
								? 'passed'
								: check.state === 'unmet'
									? 'failed'
									: 'attention'}
						/></span
					><Markdown source={check.evidence} />
				</li>
			{/each}
		</ul>
		{#if item.findings.length}<ul class="findings">
				{#each item.findings as finding, index (index)}<li><Markdown source={finding} /></li>{/each}
			</ul>{/if}
		{#if item.verdict !== 'pass'}<p class="warning" role="note">
				Warning: this assessment reports {item.verdict}; approval overrides that verdict.
			</p>{/if}
	</div>
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
	.mark :global(svg) {
		--icon-size: 1em;
		translate: 0 calc((1em - 1cap) / 2);
	}
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
	.assessment,
	.dependencies,
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
	.checks {
		display: grid;
		gap: var(--space-2);
		list-style: none;
		padding: 0;
	}
	.checks li {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
	.mark {
		flex: none;
		color: var(--color-accent);
	}
	.mark[aria-label='unmet'] {
		color: var(--color-danger-text);
	}
	.findings {
		padding-inline-start: var(--space-7);
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
	.dependency {
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
	select,
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
	select:focus-visible,
	input:focus-visible,
	textarea:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}
	textarea {
		resize: vertical;
	}
</style>

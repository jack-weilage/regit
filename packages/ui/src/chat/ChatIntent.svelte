<script module lang="ts">
	import type { StatusIconState } from './status.ts';

	export type IntentStatus =
		'working' | 'reviewing' | 'needs-you' | 'ready' | 'shipping' | 'shipped';

	const icons: Record<IntentStatus, StatusIconState> = {
		working: 'running',
		reviewing: 'reviewing',
		'needs-you': 'attention',
		ready: 'passed',
		shipping: 'shipping',
		shipped: 'passed'
	};

	const stickyTop = 8;
	const rowHeight = 48;
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import ChatChecks, { type CheckState } from './ChatChecks.svelte';
	import ChatMention from './ChatMention.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import { statuses } from './status.ts';
	import type { SimilarThread, ThreadStatus } from './types.ts';

	interface Props {
		headline: string;
		purpose: string;
		doneWhen: string[];
		status?: IntentStatus;
		checks?: CheckState[];
		note?: string;
		changes?: { files: number; additions: number; deletions: number };
		sticky?: boolean;
		similar?: SimilarThread[];
		handoff?: boolean;
		superseded?: boolean;
		onstart?: () => void;
		onship?: () => void;
		onchanges?: () => void;
		ondismiss?: () => void;
		onmessage?: (thread: SimilarThread) => void;
	}

	let {
		headline,
		purpose,
		doneWhen,
		status,
		checks = [],
		note,
		changes,
		sticky = false,
		similar = [],
		handoff = false,
		superseded = false,
		onstart,
		onship,
		onchanges,
		ondismiss,
		onmessage
	}: Props = $props();

	const messageable = (status: ThreadStatus) =>
		['draft', 'running', 'reviewing', 'shipping'].includes(status);

	let same = $derived(similar.find((thread) => thread.relation === 'same'));
	let overlaps = $derived(similar.filter((thread) => thread.relation === 'overlap'));
	let related = $derived(similar.filter((thread) => thread.relation === 'related'));

	let stuck = $state(false);
	let open = $state(false);
	let toggling = $state(false);
	let bodyHeight = $state(0);

	let minimized = $derived(stuck && !open);
	let met = $derived(checks.filter((check) => check === 'met').length);

	const watch: Attachment<HTMLElement> = (marker) => {
		const observer = new IntersectionObserver(
			([entry]) => {
				stuck = !entry!.isIntersecting && entry!.boundingClientRect.top < entry!.rootBounds!.top;
				toggling = false;
				if (!stuck) open = false;
			},
			{
				root: marker.closest<HTMLElement>('[role=log]'),
				rootMargin: `-${stickyTop + rowHeight}px 0px 0px 0px`
			}
		);
		observer.observe(marker);
		return () => observer.disconnect();
	};
</script>

{#snippet meta(thread: SimilarThread)}
	<span class="meta">{thread.detail ?? statuses[thread.status].label}</span>
{/snippet}

{#snippet message(thread: SimilarThread, size: 'sm' | 'xs')}
	{#if onmessage && messageable(thread.status)}
		<Button
			{size}
			variant={size === 'xs' ? 'ghost' : 'quiet'}
			aria-label="Message {thread.label}"
			onclick={() => onmessage(thread)}>{size === 'xs' ? 'Message' : 'Message it'}</Button
		>
	{/if}
{/snippet}

{#snippet details()}
	<p class="purpose">{purpose}</p>
	<div class="section">
		<p class="heading">Done when</p>
		<ChatChecks checks={doneWhen} states={checks} />
	</div>
{/snippet}

{#if superseded || handoff}
	<section class="intent" aria-label={superseded ? 'Superseded intent' : 'Suggested separate work'}>
		<div class={['card', 'collapsed', { superseded, 'chat-enter': !superseded }]}>
			<details>
				<summary>
					{#if superseded}
						<s class="headline">{headline}</s>
					{:else}
						<ThreadIcon plus />
						<span class="headline">{headline}</span>
					{/if}
				</summary>
				<div class="body">
					{@render details()}
				</div>
			</details>
			{#if !superseded && (onstart || ondismiss)}
				<div class="actions">
					{#if ondismiss}
						<Button size="sm" onclick={ondismiss}>Dismiss</Button>
					{/if}
					{#if onstart}
						<Button variant="primary" size="sm" onclick={onstart}>Spin off</Button>
					{/if}
				</div>
			{/if}
		</div>
	</section>
{:else}
	<section
		class={['intent', 'card', 'chat-enter', { stuck, minimized, toggling }]}
		style:--top="{stickyTop}px"
		style:--collapsed="{bodyHeight}px"
		aria-label={status ? 'Intent' : 'Suggested intent'}
	>
		{#snippet title()}
			{#if status}<StatusIcon state={icons[status]} />{/if}
			<span class="headline">{headline}</span>
			{#if minimized && checks.length}
				<span class="progress">
					<span class="segments" aria-hidden="true">
						{#each checks as check, index (index)}<span class={['segment', check]}></span>{/each}
					</span>
					<span class="count">{met}/{checks.length}</span>
				</span>
			{/if}
			{#if stuck}
				<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
					><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg
				>
			{/if}
		{/snippet}

		{#if stuck}
			<button
				type="button"
				class="head"
				aria-expanded={open}
				onclick={() => {
					toggling = true;
					open = !open;
				}}>{@render title()}</button
			>
		{:else}
			<p class="head">{@render title()}</p>
		{/if}

		<div class="body">
			<div class="clip">
				<div class="content" bind:offsetHeight={bodyHeight}>
					{#if same}
						<div class="duplicate" role="note">
							<p>
								<span class="label">Same goal as</span>
								<ChatMention mention={same} />
								{@render meta(same)}
							</p>
							{@render message(same, 'sm')}
						</div>
					{/if}
					{@render details()}

					{#if overlaps.length}
						<div class="section">
							<p class="heading">Overlaps</p>
							<ul class="similar">
								{#each overlaps as item (item.handle)}
									<li>
										<ChatMention mention={item} />
										{@render meta(item)}
										{@render message(item, 'xs')}
									</li>
								{/each}
							</ul>
						</div>
					{/if}

					{#if related.length}
						<details class="related">
							<summary>Related · {related.length}</summary>
							<ul class="similar">
								{#each related as item (item.handle)}
									<li><ChatMention mention={item} />{@render meta(item)}</li>
								{/each}
							</ul>
						</details>
					{/if}

					{#if onstart}
						<div class="actions">
							<Button variant="primary" onclick={onstart}>{same ? 'Start anyway' : 'Start'}</Button>
						</div>
					{/if}

					{#if note || onship || changes}
						<div class="footer">
							{#if note}<p class="note">{note}</p>{/if}
							{#if changes}
								<Button
									variant="ghost"
									size="sm"
									aria-label="View changes: {changes.files} {changes.files === 1
										? 'file'
										: 'files'}, {changes.additions} added, {changes.deletions} removed"
									onclick={onchanges}
								>
									{changes.files}
									{changes.files === 1 ? 'file' : 'files'}
									<span class="added">+{changes.additions}</span>
									<span class="removed">−{changes.deletions}</span>
								</Button>
							{/if}
							{#if onship}<Button variant="primary" size="sm" onclick={onship}>Ship</Button>{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>
	</section>
	{#if sticky}
		<div class="marker" {@attach watch}></div>
	{/if}
{/if}

<style>
	.intent {
		container: intent / inline-size;
	}

	.card {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		font-size: var(--text-chat);
		line-height: 1.5;

		p {
			margin: 0;
		}
	}

	section.card {
		--pad: var(--space-6);

		position: relative;
		z-index: 1;
		gap: 0;
		padding: 0;

		&.stuck {
			position: sticky;
			inset-block-start: var(--top);
			background: color-mix(in oklab, var(--color-bg) 92%, transparent);
			box-shadow: var(--shadow-floating);
			backdrop-filter: blur(8px);
		}

		&.minimized {
			--pad: var(--space-4);

			margin-block-end: var(--collapsed);
		}
	}

	.head {
		--icon-size: 1em;

		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		min-inline-size: 0;
		margin: 0;
		padding: var(--pad) var(--space-6) 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;

		> :global(svg:first-child) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}

		.headline {
			flex: 1;
			min-inline-size: 0;
		}
	}

	button.head {
		cursor: pointer;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
			border-radius: var(--radius-lg);
		}
	}

	.minimized .head {
		padding-block-end: var(--pad);

		.headline {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.progress,
	.chevron {
		align-self: center;
	}

	.progress {
		display: inline-flex;
		align-items: center;
		gap: var(--space-4);
	}

	.segments {
		display: flex;
		gap: 3px;
	}

	.segment {
		inline-size: 1rem;
		block-size: 4px;
		border-radius: 2px;
		background: var(--color-border);

		&.met {
			background: var(--color-accent);
		}

		&.unmet {
			background: var(--color-danger-text);
		}

		&.unverified {
			background: color-mix(in oklab, var(--color-accent) 45%, var(--color-border));
		}
	}

	.count {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.chevron {
		flex: none;
		inline-size: 1em;
		block-size: 1em;
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
	}

	.stuck:not(.minimized) .chevron {
		rotate: 180deg;
		align-self: start;
		margin-block-start: 0.25em;
	}

	.body {
		display: grid;
		grid-template-rows: 1fr;
	}

	.minimized .body {
		grid-template-rows: 0fr;
	}

	.clip {
		overflow: hidden;
		min-block-size: 0;
	}

	.content {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-6) var(--space-6);
	}

	.footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		margin-block-start: var(--space-2);
		padding-block-start: var(--space-4);
		border-block-start: 1px solid var(--color-border);
	}

	.note {
		flex: 1;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.added,
	.removed {
		font-family: var(--font-mono);
	}

	.added {
		color: var(--color-added);
	}

	.removed {
		color: var(--color-removed);
	}

	.marker {
		block-size: 1px;
		margin-block-start: -1px;
	}

	@keyframes arrive {
		from {
			opacity: 0;
			translate: 0 -0.75rem;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.minimized:not(.toggling) {
			animation: arrive 0.2s ease;
		}

		.toggling {
			&,
			.head,
			.body,
			.chevron {
				transition:
					grid-template-rows 0.25s ease,
					margin 0.25s ease,
					padding 0.25s ease,
					rotate 0.2s ease;
			}
		}
	}

	.headline {
		font-family: var(--font-mono);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.purpose {
		color: var(--color-muted);
	}

	.section {
		display: grid;
		gap: var(--space-3);
		margin-block-start: var(--space-2);
	}

	.purpose + .section {
		margin-block-start: var(--space-5);
	}

	.heading {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: 600;
	}

	.duplicate {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3) var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 1px solid color-mix(in oklab, var(--color-accent) 45%, var(--color-border));
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--color-accent) 8%, transparent);

		p {
			margin: 0;
		}

		.label {
			font-weight: 600;
		}

		:global(.mention) {
			max-inline-size: min(100%, 36em);
		}
	}

	.meta {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.related summary {
		display: list-item;
		inline-size: fit-content;
		font-family: inherit;
		list-style: revert;
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: 600;
		cursor: pointer;

		&:hover {
			color: var(--color-fg);
		}
	}

	.related .similar {
		margin-block-start: var(--space-3);
	}

	.similar {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: var(--space-4);
		}

		span {
			color: var(--color-muted);
			font-size: var(--text-meta);
		}
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-block-start: var(--space-2);
	}

	.collapsed {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		column-gap: var(--space-5);
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);

		details {
			display: grid;
			grid-area: 1 / 1 / 2 / -1;
			grid-template-columns: subgrid;

			&::details-content {
				grid-column: 1 / -1;
			}
		}

		summary {
			grid-column: 1;
		}

		.body {
			display: grid;
			gap: var(--space-4);
			margin-block-start: var(--space-4);
		}

		.actions {
			grid-area: 1 / 2;
			gap: var(--space-2);
			margin: 0;
		}
	}

	.superseded {
		padding: var(--space-4) var(--space-5) var(--space-4) var(--space-6);
		border-style: dashed;
		background: none;
		color: var(--color-muted);
	}

	summary {
		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		list-style: none;
		cursor: pointer;

		> :global(svg) {
			--icon-size: 1.3em;

			translate: 0 calc((var(--icon-size) - 1ex) / 2);
			color: var(--color-muted);
		}

		.headline {
			overflow: hidden;
			font-weight: 500;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		s {
			text-decoration-color: color-mix(in oklab, currentColor 60%, transparent);
		}
	}

	@container intent (width < 28rem) {
		.actions > :global(*) {
			flex: 1;
		}

		.collapsed {
			grid-template-columns: minmax(0, 1fr);

			.actions {
				grid-area: 2 / 1;
			}
		}
	}
</style>

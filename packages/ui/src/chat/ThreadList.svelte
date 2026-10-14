<script module lang="ts">
	import type { ThreadPreviewProps } from './ThreadPreview.svelte';
	import type { ThreadAction, ThreadStatus } from './types.ts';

	export interface ThreadListItem {
		id: string;
		headline: string;
		status: ThreadStatus;
		updatedAt: number;
		href: string;
		parent?: { id: string; headline: string };
		conflictsWith?: string;
		failed?: string;
		preview?: Omit<ThreadPreviewProps, 'headline'>;
		actions?: ThreadAction[];
	}

	const groups: { title: string; statuses: ThreadStatus[] }[] = [
		{ title: 'Needs you', statuses: ['needs-you'] },
		{ title: 'Running', statuses: ['running', 'shipping'] },
		{ title: 'Recent', statuses: ['shipped', 'discarded'] }
	];

	interface ThreadNode {
		thread: ThreadListItem;
		children: ThreadNode[];
	}

	const maxDepth = 3;

	// Spin-offs nest under their parent when both are in the same group; past maxDepth they stay level.
	function nest(threads: ThreadListItem[]) {
		const ids = new Set(threads.map((thread) => thread.id));
		const children = new Map<string | null, ThreadListItem[]>();
		for (const thread of threads) {
			const parent = thread.parent && ids.has(thread.parent.id) ? thread.parent.id : null;
			children.set(parent, [...(children.get(parent) ?? []), thread]);
		}
		const grow = (parent: string | null, depth: number): ThreadNode[] =>
			(children.get(parent) ?? []).flatMap((thread) => {
				const nested = grow(thread.id, depth + 1);
				return depth < maxDepth
					? [{ thread, children: nested }]
					: [{ thread, children: [] }, ...nested];
			});
		return grow(null, 0);
	}

	const previewDelay = 400;
	const closeDelay = 150;
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import Menu from '../Menu.svelte';
	import Popover from '../Popover.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import ThreadPreview from './ThreadPreview.svelte';
	import { formatAge } from './format.ts';
	import { clock } from './clock.svelte.ts';
	import { statuses } from './status.ts';

	interface Props {
		threads: ThreadListItem[];
		current?: string;
		newThread?: string;
		now?: number;
	}

	let { threads, current, newThread, now }: Props = $props();

	let time = $derived(now ?? clock.now);

	const id = $props.id();

	let previewed: { thread: ThreadListItem; anchor: HTMLElement } | null = $state(null);
	let hovered: ThreadListItem | null = $state(null);
	let timer: ReturnType<typeof setTimeout> | undefined;

	let sections = $derived(
		groups
			.map((group) => ({
				title: group.title,
				nodes: nest(
					threads
						.filter((thread) => group.statuses.includes(thread.status))
						.toSorted((a, b) => b.updatedAt - a.updatedAt)
				)
			}))
			.filter((section) => section.nodes.length)
	);

	function related(thread: ThreadListItem) {
		return !!hovered && (hovered.parent?.id === thread.id || thread.parent?.id === hovered.id);
	}

	function show(thread: ThreadListItem, anchor: HTMLElement) {
		clearTimeout(timer);
		hovered = thread;
		if (!thread.preview) {
			previewed = null;
			return;
		}
		const open = () => (previewed = { thread, anchor });
		if (previewed) open();
		else timer = setTimeout(open, previewDelay);
	}

	function hide() {
		clearTimeout(timer);
		hovered = null;
		previewed = null;
	}

	function leave() {
		clearTimeout(timer);
		hovered = null;
		if (previewed) timer = setTimeout(hide, closeDelay);
	}
</script>

<nav aria-label="Threads" class="threads">
	{#if !threads.length}
		<div class="empty">
			<p class="lead">Start your first thread</p>
			<p class="body">Describe a change and ReGit drafts a plan.</p>
			{#if newThread}
				<Button variant="primary" size="sm" popovertarget={newThread}>
					<ThreadIcon plus /> New thread
				</Button>
			{/if}
		</div>
	{/if}
	{#each sections as section, index (section.title)}
		<p id="{id}-section-{index}" class="title">{section.title}</p>
		<ul aria-labelledby="{id}-section-{index}">
			{@render branch(section.nodes)}
		</ul>
	{/each}
</nav>

{#snippet branch(nodes: ThreadNode[], parent?: ThreadListItem)}
	{#each nodes as { thread, children } (thread.id)}
		<li>
			<div class={['row', { 'has-actions': !!thread.actions?.length, related: related(thread) }]}>
				<a
					href={thread.href}
					aria-current={thread.id === current ? 'page' : undefined}
					class={{ attention: thread.status === 'needs-you', failed: !!thread.failed }}
					onpointerenter={(event) => show(thread, event.currentTarget)}
					onpointerleave={leave}
					onfocus={(event) => show(thread, event.currentTarget)}
					onblur={hide}
				>
					<StatusIcon
						state={thread.failed ? 'failed' : statuses[thread.status].icon}
						aria-label={thread.failed ?? statuses[thread.status].label}
						role="img"
					/>
					<span class="headline">{thread.headline}</span>
					{#if thread.parent && thread.parent.id !== parent?.id}
						<svg
							class="spun"
							viewBox="0 0 16 16"
							role="img"
							aria-label="Spun off from {thread.parent.headline}"
						>
							<circle cx="5" cy="3.5" r="1.5" />
							<circle cx="5" cy="12.5" r="1.5" />
							<circle cx="11" cy="4.5" r="1.5" />
							<path d="M5 5v6M11 6c0 3-6 2.5-6 5" />
						</svg>
					{/if}
					{#if thread.conflictsWith}
						<svg
							class="conflicts"
							viewBox="0 0 16 16"
							role="img"
							aria-label="Conflicts with {thread.conflictsWith}"
						>
							<path d="M8 2.25 14.5 13.5h-13Z" />
							<path d="M8 6.5v3.25M8 11.75v.01" />
						</svg>
					{/if}
					<time datetime={new Date(thread.updatedAt).toISOString()}
						>{formatAge(thread.updatedAt, time)}</time
					>
				</a>
				{#if thread.actions?.length}
					<div class="actions">
						<Menu label="Thread actions: {thread.headline}" items={thread.actions}>
							{#snippet trigger(props)}
								<Button
									variant="ghost"
									size="sm"
									icon
									aria-label="Thread actions: {thread.headline}"
									{...props}
									onpointerenter={hide}
									onfocus={hide}
								>
									<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
										<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
									</svg>
								</Button>
							{/snippet}
						</Menu>
					</div>
				{/if}
			</div>
			{#if children.length}
				<ul class="children" aria-label="Spun off from {thread.headline}">
					{@render branch(children, thread)}
				</ul>
			{/if}
		</li>
	{/each}
{/snippet}

<Popover
	id="{id}-preview"
	manual
	open={!!previewed}
	side="inline"
	anchor={previewed?.anchor}
	role="group"
	aria-label="Thread preview"
	onpointerenter={() => clearTimeout(timer)}
	onpointerleave={leave}
>
	{#if previewed?.thread.preview}
		<ThreadPreview headline={previewed.thread.headline} {...previewed.thread.preview} />
	{/if}
</Popover>

<style>
	.threads {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		gap: var(--space-2);
		font-size: var(--text-chat);
	}

	.empty {
		--icon-size: 1.1em;

		display: grid;
		justify-items: start;
		gap: var(--space-2);
		padding: var(--space-4);

		p {
			margin: 0;
		}

		.lead {
			font-weight: 600;
		}

		.body {
			margin-block-end: var(--space-5);
			color: var(--color-muted);
			font-size: var(--text-meta);
		}
	}

	.title {
		margin: var(--space-5) 0 var(--space-1);
		padding-inline: var(--space-4);
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: 600;

		&:first-child {
			margin-block-start: 0;
		}
	}

	ul {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		--icon-size: 0.9em;
		--guide: calc(var(--space-4) + var(--icon-size) / 2 - 0.5px);
		--guide-color: color-mix(in oklab, var(--color-muted) 40%, var(--color-bg));

		position: relative;
	}

	.row {
		position: relative;

		&:hover a,
		&:focus-within a {
			background: var(--color-surface);
			color: var(--color-fg);
		}

		&.related a {
			outline: 1px dashed var(--guide-color);
			outline-offset: -1px;
			color: var(--color-fg);
		}

		&:has(+ .children)::after {
			content: '';
			position: absolute;
			inset-inline-start: var(--guide);
			inset-block: calc(50% + var(--icon-size) / 2 + var(--space-1)) 0;
			border-inline-start: 1px solid var(--guide-color);
		}
	}

	.children {
		--indent: 1.25em;

		margin-block-start: var(--space-1);
		padding-inline-start: var(--indent);

		> li:not(:last-child)::before,
		> li > .row::before {
			content: '';
			position: absolute;
			inset-inline-start: calc(var(--guide) - var(--indent));
			inset-block: calc(-1 * var(--space-1)) 0;
			border-inline-start: 1px solid var(--guide-color);
		}

		> li > .row::before {
			inset-block-end: 50%;
			inline-size: calc(var(--indent) - var(--icon-size) / 2 - var(--space-2));
			border-block-end: 1px solid var(--guide-color);
			border-end-start-radius: var(--radius);
		}
	}

	.actions {
		position: absolute;
		inset-inline-end: var(--space-2);
		inset-block-start: 50%;
		translate: 0 -50%;
		opacity: 0;
		pointer-events: none;
		color: var(--color-muted);
	}

	.row:hover .actions,
	.row:focus-within .actions,
	.actions:has(:global(:popover-open)) {
		opacity: 1;
		pointer-events: auto;
	}

	.has-actions:hover time,
	.has-actions:focus-within time,
	.has-actions:has(:global(:popover-open)) time {
		visibility: hidden;
	}

	.icon {
		inline-size: 1.25em;
		block-size: 1.25em;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	a {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius);
		color: var(--color-muted);
		text-decoration: none;

		&.attention,
		&:hover,
		&[aria-current='page'] {
			color: var(--color-fg);
		}

		&.failed > :global(.status) {
			color: var(--color-danger-text);
		}

		&:hover,
		&[aria-current='page'] {
			background: var(--color-surface);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
		}
	}

	.headline {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.spun {
		flex: none;
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.conflicts {
		flex: none;
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		fill: none;
		stroke: var(--color-danger-text);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.has-actions time {
		min-inline-size: 2em;
		text-align: end;
	}

	@media (hover: none) {
		.actions {
			opacity: 1;
			pointer-events: auto;
		}

		.has-actions time {
			visibility: hidden;
		}
	}

	time {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}
</style>

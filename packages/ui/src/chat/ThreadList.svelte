<script module lang="ts">
	import type { ThreadPreviewProps } from './ThreadPreview.svelte';
	import type { ThreadStatus } from './types.ts';

	export interface ThreadListItem {
		id: string;
		headline: string;
		status: ThreadStatus;
		updatedAt: number;
		href: string;
		preview?: Omit<ThreadPreviewProps, 'headline'>;
	}

	const groups: { title: string; statuses: ThreadStatus[] }[] = [
		{ title: 'Needs you', statuses: ['needs-you'] },
		{ title: 'Running', statuses: ['running', 'shipping'] },
		{ title: 'Recent', statuses: ['draft', 'shipped', 'discarded'] }
	];

	const previewDelay = 400;
	const closeDelay = 150;
</script>

<script lang="ts">
	import Button from '../Button.svelte';
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
	let timer: ReturnType<typeof setTimeout> | undefined;

	let sections = $derived(
		groups
			.map((group) => ({
				title: group.title,
				threads: threads
					.filter((thread) => group.statuses.includes(thread.status))
					.toSorted((a, b) => b.updatedAt - a.updatedAt)
			}))
			.filter((section) => section.threads.length)
	);

	function show(thread: ThreadListItem, anchor: HTMLElement) {
		clearTimeout(timer);
		if (!thread.preview) return hide();
		const open = () => (previewed = { thread, anchor });
		if (previewed) open();
		else timer = setTimeout(open, previewDelay);
	}

	function hide() {
		clearTimeout(timer);
		previewed = null;
	}

	function leave() {
		clearTimeout(timer);
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
			{#each section.threads as thread (thread.id)}
				<li>
					<a
						href={thread.href}
						aria-current={thread.id === current ? 'page' : undefined}
						class={{ attention: thread.status === 'needs-you' }}
						onpointerenter={(event) => show(thread, event.currentTarget)}
						onpointerleave={leave}
						onfocus={(event) => show(thread, event.currentTarget)}
						onblur={hide}
					>
						<StatusIcon
							state={statuses[thread.status].icon}
							aria-label={statuses[thread.status].label}
							role="img"
						/>
						<span class="headline">{thread.headline}</span>
						<time datetime={new Date(thread.updatedAt).toISOString()}
							>{formatAge(thread.updatedAt, time)}</time
						>
					</a>
				</li>
			{/each}
		</ul>
	{/each}
</nav>

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

	a {
		--icon-size: 0.9em;

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

	time {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}
</style>

<script module lang="ts">
	import type { Verdict } from '@regit/core';
	import type { StatusIconState } from './status.ts';
	import type { ThreadStatus } from './types.ts';

	export interface ChildThreadView {
		id: string;
		number?: number;
		headline: string;
		status: ThreadStatus;
		needsYou?: boolean;
		href: string;
		doneWhen?: { met: number; total: number };
		previews?: { name: string; href: string }[];
		shipped?: { sha: string; verdict: Verdict };
	}

	const shown = 6;

	const verdicts: Record<Verdict, { label: string; tone?: 'good' | 'bad' }> = {
		landed: { label: 'Checking main' },
		passed: { label: 'Checks passed', tone: 'good' },
		failed: { label: 'Broke main', tone: 'bad' },
		deployed: { label: 'Deployed', tone: 'good' },
		reverted: { label: 'Reverted', tone: 'bad' }
	};
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import { needsYou, statuses } from './status.ts';

	interface Props {
		threads: ChildThreadView[];
	}

	let { threads }: Props = $props();

	const id = $props.id();

	let expanded = $state(false);

	let hidden = $derived(threads.length - shown > 1 ? threads.length - shown : 0);
	let visible = $derived(expanded || !hidden ? threads : threads.slice(0, shown));

	function status(thread: ChildThreadView): { label: string; icon: StatusIconState } {
		return thread.status === 'idle' && thread.needsYou ? needsYou : statuses[thread.status];
	}

	function ship(
		thread: ChildThreadView
	): { label: string; tone?: 'good' | 'bad'; sha?: string } | null {
		if (thread.status === 'shipping') return null;
		if (thread.shipped)
			return { ...verdicts[thread.shipped.verdict], sha: thread.shipped.sha.slice(0, 7) };
		return { label: 'Not shipped' };
	}
</script>

<section class="board chat-enter" aria-labelledby="{id}-title">
	<p id="{id}-title" class="title">
		Spun-off threads <span class="count">{threads.length}</span>
	</p>
	{#if !threads.length}
		<p class="empty">No threads launched from this one yet.</p>
	{:else}
		<ul id="{id}-list">
			{#each visible as thread (thread.id)}
				{@const state = status(thread)}
				{@const shipping = ship(thread)}
				<li class={{ attention: thread.status === 'idle' && thread.needsYou }}>
					<a class="thread" href={thread.href}>
						<StatusIcon state={state.icon} />
						{#if thread.number}<span class="number">#{thread.number}</span>{/if}
						<span class="headline">{thread.headline || 'New thread'}</span>
					</a>
					<div class="facts">
						<span class="fact state">{state.label}</span>
						{#if thread.doneWhen?.total}
							{@const { met, total } = thread.doneWhen}
							<span
								class={['fact', 'checks', { done: met === total }]}
								title="{met} of {total} done-when checks met"
							>
								<span class="bar" aria-hidden="true">
									<span style:inline-size="{(met / total) * 100}%"></span>
								</span>
								{met}/{total} met
							</span>
						{/if}
						{#each thread.previews ?? [] as preview (preview.name)}
							<a
								class="fact preview"
								href={preview.href}
								target="_blank"
								rel="noreferrer"
								aria-label="{preview.name} preview of {thread.headline || 'New thread'}"
							>
								<svg viewBox="0 0 16 16" aria-hidden="true">
									<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v4h-9v-9h4" />
								</svg>
								{preview.name}
							</a>
						{/each}
						{#if shipping}
							<span class={['fact', 'ship', shipping.tone]}>
								{#if shipping.sha}<code>{shipping.sha}</code>{/if}
								{shipping.label}
							</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if hidden}
			<div class="more">
				<Button
					variant="ghost"
					size="xs"
					aria-expanded={expanded}
					aria-controls="{id}-list"
					onclick={() => (expanded = !expanded)}
					>{expanded ? 'Show fewer' : `Show ${hidden} more`}</Button
				>
			</div>
		{/if}
	{/if}
</section>

<style>
	.board {
		--icon-size: 1em;

		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-3);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-chat);
	}

	p {
		margin: 0;
	}

	.title {
		padding-inline: var(--space-3);
		font-weight: 600;
	}

	.count {
		color: var(--color-muted);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.empty {
		padding-inline: var(--space-3);
		color: var(--color-muted);
		font-size: var(--text-meta);
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
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding: var(--space-3);
		border-radius: var(--radius);

		&:hover {
			background: var(--color-surface);
		}
	}

	.thread {
		display: flex;
		flex: 1 1 14rem;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
		color: var(--color-fg);
		text-decoration: none;

		&:hover .headline {
			text-decoration: underline;
		}

		&:focus-visible {
			border-radius: var(--radius);
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}
	}

	.number {
		flex: none;
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.headline {
		min-inline-size: 0;
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.fact {
		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		white-space: nowrap;
	}

	.attention .state {
		color: var(--color-fg);
		font-weight: 500;
	}

	.checks {
		font-variant-numeric: tabular-nums;

		&.done {
			color: var(--color-added);
		}
	}

	.bar {
		display: inline-flex;
		inline-size: 2.5em;
		block-size: 0.35em;
		overflow: hidden;
		border-radius: 1em;
		background: var(--color-surface);
		box-shadow: inset 0 0 0 1px var(--color-border);

		span {
			background: currentColor;
		}
	}

	.preview {
		color: var(--color-fg);
		text-decoration: none;

		svg {
			inline-size: 1em;
			block-size: 1em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		&:hover {
			color: var(--color-accent);
			text-decoration: underline;
		}

		&:focus-visible {
			border-radius: var(--radius);
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}
	}

	.ship {
		&.good {
			color: var(--color-added);
		}

		&.bad {
			color: var(--color-danger-text);
		}

		code {
			font-family: var(--font-mono);
		}
	}

	.more {
		font-size: var(--text-meta);
	}
</style>

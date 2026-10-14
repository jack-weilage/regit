<script module lang="ts">
	export interface ToolCallView {
		id: string;
		verb: string;
		target?: string;
		status: 'running' | 'done' | 'failed';
		startedAt: number;
		finishedAt?: number;
		output?: string;
	}
</script>

<script lang="ts">
	import StatusIcon from '../StatusIcon.svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';

	interface Props {
		calls: ToolCallView[];
		summary?: string;
		now?: number;
	}

	let { calls, summary, now }: Props = $props();

	const icon = { running: 'running', done: 'passed', failed: 'failed' } as const;
	const took = (call: ToolCallView) => (call.finishedAt ?? now ?? stopwatch.now) - call.startedAt;
</script>

{#snippet list()}
	<ul class="tools chat-enter" aria-label="Tool calls">
		{#each calls as call (call.id)}
			{#snippet row()}
				<StatusIcon state={icon[call.status]} />
				<span class="what">
					{call.verb}
					{#if call.target}<code>{call.target}</code>{/if}
				</span>
				{#if call.status === 'running' || took(call) >= 3000}
					<span class="took">· {formatDuration(took(call))}</span>
				{/if}
			{/snippet}
			<li class={call.status}>
				{#if call.output}
					<details>
						<summary>{@render row()}</summary>
						<pre>{call.output}</pre>
					</details>
				{:else}
					<div class="row">{@render row()}</div>
				{/if}
			</li>
		{/each}
	</ul>
{/snippet}

{#if summary}
	<details class="folded">
		<summary>{summary}</summary>
		{@render list()}
	</details>
{:else}
	{@render list()}
{/if}

<style>
	.folded > summary {
		inline-size: fit-content;
		color: var(--color-muted);
		font-size: var(--text-meta);
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

	.folded .tools {
		margin-block-start: var(--space-2);
		padding-inline-start: var(--space-4);
		border-inline-start: 1px solid var(--color-border);
	}

	.tools {
		--icon-size: 1em;

		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
		list-style: none;
	}

	li summary,
	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
		padding-block: var(--space-1);
	}

	li summary {
		list-style: none;
		cursor: pointer;

		&::-webkit-details-marker {
			display: none;
		}

		&:hover .what {
			color: var(--color-fg);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
			border-radius: var(--radius);
		}
	}

	.what {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.running .what {
		color: var(--color-fg);
	}

	.failed .what {
		color: var(--color-danger-text);
	}

	code {
		padding: 0.1em 0.3em;
		border-radius: 0.3em;
		background: color-mix(in oklab, currentColor 7%, transparent);
		font-family: var(--font-mono);
	}

	.took {
		flex: none;
		font-variant-numeric: tabular-nums;
	}

	pre {
		max-block-size: 16rem;
		margin: var(--space-2) 0 var(--space-3) calc(1em + var(--space-3));
		padding: var(--space-4) var(--space-5);
		overflow: auto;
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-fg);
		font-family: var(--font-mono);
		line-height: 1.5;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>

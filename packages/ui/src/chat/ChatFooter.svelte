<script module lang="ts">
	export interface Usage {
		task: string;
		model: string;
		tokens: number;
		cost: number;
	}

	const formatTokens = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 2
	}).format;

	const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

	function formatCost(cost: number) {
		return cost > 0 && cost < 0.01 ? `<${currency.format(0.01)}` : currency.format(cost);
	}
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import Popover from '../Popover.svelte';

	interface Props {
		mode: string;
		context: { used: number; limit: number; parts?: { label: string; tokens: number }[] };
		usage: Usage[];
	}

	let { mode, context, usage }: Props = $props();

	const id = $props.id();
	const hues = [250, 150, 300, 40, 190, 0];

	let footer: HTMLElement | undefined = $state();

	// The limit is where the thread compacts; one step can overshoot it before compaction runs.
	let percent = $derived(
		context.limit ? Math.min(100, Math.round((context.used / context.limit) * 100)) : 0
	);
	let total = $derived(
		usage.reduce((sum, row) => ({ tokens: sum.tokens + row.tokens, cost: sum.cost + row.cost }), {
			tokens: 0,
			cost: 0
		})
	);
</script>

<footer bind:this={footer}>
	<span>{mode}</span>
	<span class="trigger">
		<Button variant="ghost" size="xs" popovertarget="{id}-usage">
			<span class="ring" style:--used={percent} aria-hidden="true"></span>
			<span>{percent}% context</span>
			<span class="cost">{formatCost(total.cost)}</span>
		</Button>
	</span>
	<Popover id="{id}-usage" anchor={footer}>
		<div class="usage">
			<div class="context">
				<p class="summary">
					<span>Context until compaction</span>
					<span>{formatTokens(context.used)} / {formatTokens(context.limit)}</span>
				</p>
				<div
					class={['bar', { parts: context.parts }]}
					role="img"
					aria-label="{percent}% of the context before compaction"
				>
					{#each context.parts ?? [{ label: 'Used', tokens: context.used }] as part, index (part.label)}
						<span
							style:flex-basis="{(part.tokens / context.limit) * 100}%"
							style:--hue={hues[index % hues.length]}
						></span>
					{/each}
				</div>
				{#if context.parts}
					<ul class="legend">
						{#each context.parts as part, index (part.label)}
							<li style:--hue={hues[index % hues.length]}>
								{part.label} <span>{formatTokens(part.tokens)}</span>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
			{#if usage.length}
				<table>
					<thead>
						<tr><th>Task</th><th>Model</th><th>Tokens used</th><th>Cost</th></tr>
					</thead>
					<tbody>
						{#each usage as row (`${row.task}:${row.model}`)}
							<tr>
								<td>{row.task}</td>
								<td>{row.model}</td>
								<td>{formatTokens(row.tokens)}</td>
								<td>{formatCost(row.cost)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr>
							<td>Total</td>
							<td></td>
							<td>{formatTokens(total.tokens)}</td>
							<td>{formatCost(total.cost)}</td>
						</tr>
					</tfoot>
				</table>
			{:else}
				<p class="empty">No usage yet</p>
			{/if}
		</div>
	</Popover>
</footer>

<style>
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-6);
		padding-inline: var(--chat-inset);
		border-inline: 1px solid transparent;
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.trigger {
		margin-inline: calc(var(--space-3) * -1);
	}

	.ring {
		--size: 1.15em;

		flex: none;
		inline-size: var(--size);
		block-size: var(--size);
		translate: 0 calc((var(--size) - 1cap) / 2);
		border-radius: 50%;
		background: conic-gradient(currentColor calc(var(--used) * 1%), var(--color-border) 0);
		mask: radial-gradient(circle, transparent 45%, black 47%);
	}

	.cost {
		margin-inline-start: var(--space-2);
		color: var(--color-fg);
	}

	.usage {
		padding: var(--chat-inset);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;

		p {
			margin: 0;
		}
	}

	.context {
		display: grid;
		gap: var(--space-3);
		margin-block-end: var(--space-5);
	}

	.summary {
		display: flex;
		justify-content: space-between;
		gap: var(--space-6);

		span:first-child {
			color: var(--color-muted);
		}
	}

	.bar {
		display: flex;
		gap: 2px;
		block-size: 0.5em;
		overflow: hidden;
		border-radius: 999px;
		background: var(--color-surface);

		span {
			background: var(--color-muted);
		}

		&.parts span {
			background: light-dark(oklch(0.62 0.13 var(--hue)), oklch(0.7 0.12 var(--hue)));
		}
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-5);
		margin: 0;
		padding: 0;
		list-style: none;

		li::before {
			content: '';
			display: inline-block;
			inline-size: 0.65em;
			block-size: 0.65em;
			margin-inline-end: var(--space-2);
			border-radius: 2px;
			background: light-dark(oklch(0.62 0.13 var(--hue)), oklch(0.7 0.12 var(--hue)));
		}

		span {
			color: var(--color-muted);
		}
	}

	.empty {
		color: var(--color-muted);
	}

	table {
		inline-size: 100%;
		border-collapse: collapse;

		th {
			color: var(--color-muted);
			font-weight: 500;
			text-align: start;
		}

		th,
		td {
			padding: var(--space-2) var(--space-5) var(--space-2) 0;
		}

		:is(th, td):last-child {
			padding-inline-end: 0;
		}

		:is(th, td):nth-child(n + 3) {
			text-align: end;
		}

		td:nth-child(2) {
			color: var(--color-muted);
			font-family: var(--font-mono);
		}

		tfoot td {
			border-block-start: 1px solid var(--color-border);
			font-weight: 600;
		}
	}
</style>

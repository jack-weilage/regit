<script module lang="ts">
	export interface Usage {
		task: string;
		model: string;
		tokens: number;
		cost: number;
	}

	const formatTokens = new Intl.NumberFormat(undefined, {
		notation: 'compact',
		maximumFractionDigits: 1
	}).format;

	const formatCost = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' })
		.format;
</script>

<script lang="ts">
	interface Props {
		mode: string;
		context: { used: number; limit: number };
		usage: Usage[];
	}

	let { mode, context, usage }: Props = $props();

	const id = $props.id();

	let footer: HTMLElement;
	let position = $state({ right: 0, bottom: 0 });

	let percent = $derived(Math.round((context.used / context.limit) * 100));
	let total = $derived(
		usage.reduce((sum, row) => ({ tokens: sum.tokens + row.tokens, cost: sum.cost + row.cost }), {
			tokens: 0,
			cost: 0
		})
	);

	function place(event: ToggleEvent) {
		if (event.newState !== 'open') return;
		const rect = footer.getBoundingClientRect();
		position = { right: innerWidth - rect.right, bottom: innerHeight - rect.top + 6 };
	}
</script>

<footer bind:this={footer}>
	<span>{mode}</span>
	<button type="button" popovertarget="{id}-usage" class="usage">
		<span class="ring" style:--used={percent} aria-hidden="true"></span>
		<span>{percent}% context</span>
		<span class="cost">{formatCost(total.cost)}</span>
	</button>
	<div
		id="{id}-usage"
		popover
		onbeforetoggle={place}
		style:right="{position.right}px"
		style:bottom="{position.bottom}px"
	>
		<p>{formatTokens(context.used)} of {formatTokens(context.limit)} context used</p>
		<table>
			<thead>
				<tr><th>Task</th><th>Model</th><th>Tokens</th><th>Cost</th></tr>
			</thead>
			<tbody>
				{#each usage as row (row.task)}
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
					<td>Thread</td>
					<td></td>
					<td>{formatTokens(total.tokens)}</td>
					<td>{formatCost(total.cost)}</td>
				</tr>
			</tfoot>
		</table>
	</div>
</footer>

<style>
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding-inline: calc(0.75rem + 1px);
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;
	}

	.usage {
		display: inline-flex;
		align-items: baseline;
		gap: 0.375rem;
		margin-inline: -0.375rem;
		padding: 0.125rem 0.375rem;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;

		&:hover {
			background: var(--color-surface);
		}
	}

	.ring {
		--size: 0.875rem;

		flex: none;
		inline-size: var(--size);
		block-size: var(--size);
		translate: 0 calc((var(--size) - 1cap) / 2);
		border-radius: 50%;
		background: conic-gradient(currentColor calc(var(--used) * 1%), var(--color-border) 0);
		mask: radial-gradient(circle, transparent 45%, black 47%);
	}

	.cost {
		margin-inline-start: 0.25rem;
		color: var(--color-fg);
	}

	[popover] {
		inset: auto;
		margin: 0;
		padding: 0.625rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 2);
		background: var(--color-bg);
		box-shadow: 0 0.25rem 1rem light-dark(rgb(0 0 0 / 0.08), rgb(0 0 0 / 0.4));
		color: var(--color-fg);
		font-size: var(--text-meta);
		font-variant-numeric: tabular-nums;

		p {
			margin: 0 0 0.5rem;
			color: var(--color-muted);
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		[popover] {
			transform-origin: bottom right;
			transition:
				opacity 0.15s,
				translate 0.15s,
				scale 0.15s,
				display 0.15s allow-discrete,
				overlay 0.15s allow-discrete;

			&:not(:popover-open) {
				opacity: 0;
				translate: 0 0.25rem;
				scale: 0.98;
			}

			@starting-style {
				opacity: 0;
				translate: 0 0.25rem;
				scale: 0.98;
			}
		}
	}

	table {
		border-collapse: collapse;

		th {
			color: var(--color-muted);
			font-weight: 500;
			text-align: start;
		}

		th,
		td {
			padding: 0.25rem 0.75rem 0.25rem 0;
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

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
		context: { used: number; limit: number; parts?: { label: string; tokens: number }[] };
		usage: Usage[];
	}

	let { mode, context, usage }: Props = $props();

	const id = $props.id();
	const hues = [250, 150, 300, 40, 190, 0];
	const gap = 6;

	let footer: HTMLElement;
	let placement = $state({ right: 0, offset: 0, below: false });

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
		const below = rect.top < innerHeight - rect.bottom;
		placement = {
			right: innerWidth - rect.right,
			offset: below ? rect.bottom + gap : innerHeight - rect.top + gap,
			below
		};
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
		class={{ below: placement.below }}
		onbeforetoggle={place}
		style:right="{placement.right}px"
		style:top={placement.below ? `${placement.offset}px` : undefined}
		style:bottom={placement.below ? undefined : `${placement.offset}px`}
	>
		<div class="context">
			<p class="summary">
				<span>Context window</span>
				<span>{formatTokens(context.used)} / {formatTokens(context.limit)}</span>
			</p>
			<div
				class={['bar', { parts: context.parts }]}
				role="img"
				aria-label="{percent}% of the context window used"
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
			margin: 0;
		}
	}

	.context {
		display: grid;
		gap: 0.375rem;
		margin-block-end: 0.75rem;
	}

	.summary {
		display: flex;
		justify-content: space-between;
		gap: 1rem;

		span:first-child {
			color: var(--color-muted);
		}
	}

	.bar {
		display: flex;
		gap: 2px;
		block-size: 0.375rem;
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
		gap: 0.125rem 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;

		li::before {
			content: '';
			display: inline-block;
			inline-size: 0.5rem;
			block-size: 0.5rem;
			margin-inline-end: 0.3rem;
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

			&.below {
				transform-origin: top right;

				&:not(:popover-open) {
					translate: 0 -0.25rem;
				}

				@starting-style {
					translate: 0 -0.25rem;
				}
			}
		}
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

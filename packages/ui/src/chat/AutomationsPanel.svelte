<script lang="ts">
	import { describeTrigger, type Automation } from '@regit/core';
	import Button from '../Button.svelte';
	import AutomationIcon from './AutomationIcon.svelte';
	import { clock } from './clock.svelte.ts';
	import { formatAgo, formatDate } from './format.ts';

	interface Props {
		automations: Automation[];
		// Start folded into a one-line summary.
		compact?: boolean;
		busy?: string | null;
		now?: number;
		oncancel: (id: string) => void;
	}

	let { automations, compact = false, busy = null, now, oncancel }: Props = $props();

	const id = $props.id();

	let time = $derived(now ?? clock.now);
	let active = $derived(automations.filter((automation) => !automation.ended));
	let ended = $derived(automations.filter((automation) => automation.ended));
	let soonest = $derived(
		active
			.map((automation) => automation.nextAt)
			.filter((at): at is number => at !== null)
			.sort((a, b) => a - b)[0]
	);
	let summary = $derived(
		[
			`${active.length} ${active.length === 1 ? 'automation' : 'automations'}`,
			soonest ? `next ${formatAgo(soonest, time)}` : active.length ? 'waiting' : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	function status(automation: Automation) {
		const { runs, nextAt, expiresAt } = automation;
		return [
			nextAt === null ? 'Waiting' : `Next ${formatAgo(nextAt, time)}`,
			runs.limit > 1 ? `${runs.done} of ${runs.limit} runs` : null,
			`ends ${formatDate(expiresAt)}`
		]
			.filter(Boolean)
			.join(' · ');
	}

	function outcome({ ended, runs }: Automation) {
		if (!ended) return '';
		if (ended.reason === 'runs')
			return `Finished after ${runs.done} ${runs.done === 1 ? 'run' : 'runs'}`;
		if (ended.reason === 'cancelled') return `Cancelled${ended.by ? ` by ${ended.by}` : ''}`;
		if (ended.reason === 'thread') return 'Stopped with the thread';
		return `Expired after ${runs.done} ${runs.done === 1 ? 'run' : 'runs'}`;
	}
</script>

{#snippet list()}
	{#if active.length}
		<ul class="active" aria-label="Active automations">
			{#each active as automation (automation.id)}
				<li>
					<div class="text">
						<p class="title">
							<span class="name">{automation.name}</span>
							<span class="trigger">{describeTrigger(automation.on, automation.delayMs)}</span>
						</p>
						<p class="message">{automation.message}</p>
						<p class="status">{status(automation)}</p>
					</div>
					<Button
						size="xs"
						variant="ghost"
						disabled={busy === automation.id}
						aria-label="Cancel {automation.name}"
						onclick={() => oncancel(automation.id)}>Cancel</Button
					>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="empty">
			No active automations. Ask the agent to check on something later, such as “check this after it
			deploys”.
		</p>
	{/if}
	{#if ended.length}
		<details class="ended">
			<summary>{ended.length} ended</summary>
			<ul aria-label="Ended automations">
				{#each ended as automation (automation.id)}
					<li>
						<p class="title">
							<span class="name">{automation.name}</span>
							<span class="trigger">{outcome(automation)}</span>
						</p>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/snippet}

{#if compact}
	<details class="panel compact" aria-labelledby="{id}-title">
		<summary>
			<AutomationIcon />
			<span id="{id}-title">{summary}</span>
		</summary>
		<div class="body">{@render list()}</div>
	</details>
{:else}
	<section class="panel" aria-labelledby="{id}-title">
		<h2 id="{id}-title"><AutomationIcon />Automations</h2>
		{@render list()}
	</section>
{/if}

<style>
	.panel {
		--icon-size: 1em;

		display: grid;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-chat);
	}

	h2,
	.compact > summary {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		font-size: var(--text-meta);
		font-weight: 600;
	}

	.compact {
		padding-block: var(--space-3);

		> summary {
			color: var(--color-muted);
			font-weight: 400;
			cursor: pointer;
			list-style: none;

			&::-webkit-details-marker {
				display: none;
			}

			&::after {
				content: '';
				inline-size: 0.4em;
				block-size: 0.4em;
				margin-inline-start: auto;
				border-block-end: 1.5px solid currentColor;
				border-inline-end: 1.5px solid currentColor;
				rotate: 45deg;
				translate: 0 -0.15em;
			}
		}

		&[open] > summary::after {
			rotate: -135deg;
			translate: 0 0.1em;
		}

		.body {
			display: grid;
			gap: var(--space-4);
			padding-block-start: var(--space-4);
		}
	}

	ul {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: start;
		gap: var(--space-4);
	}

	.active {
		gap: 0;

		> li {
			padding-block: var(--space-4);

			& + li {
				border-block-start: 1px solid var(--color-border);
			}

			&:first-child {
				padding-block-start: 0;
			}

			&:last-child {
				padding-block-end: 0;
			}
		}
	}

	.text {
		display: grid;
		flex: 1;
		gap: var(--space-2);
		min-inline-size: 0;
	}

	p {
		margin: 0;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
	}

	.name {
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.trigger,
	.status,
	.empty,
	.ended > summary {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.message {
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.status {
		font-variant-numeric: tabular-nums;
	}

	.ended {
		display: grid;
		gap: var(--space-3);

		> summary {
			cursor: pointer;
		}

		ul {
			gap: var(--space-2);
			padding-block-start: var(--space-3);
		}
	}
</style>

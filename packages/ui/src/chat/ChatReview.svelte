<script module lang="ts">
	import type { StatusIconState } from './status.ts';

	export type ReviewVerdict = 'sent-back' | 'needs-you' | 'passed';

	const icons: Record<ReviewVerdict, StatusIconState> = {
		'sent-back': 'failed',
		'needs-you': 'attention',
		passed: 'passed'
	};
</script>

<script lang="ts">
	import StatusIcon from '../StatusIcon.svelte';
	import type { CheckState } from './ChatChecks.svelte';

	interface Props {
		verdict: ReviewVerdict;
		round: number;
		doneWhen: string[];
		checks: CheckState[];
	}

	let { verdict, round, doneWhen, checks }: Props = $props();

	let met = $derived(checks.filter((check) => check === 'met').length);
	let unverified = $derived(checks.filter((check) => check === 'unverified').length);
	let title = $derived(
		verdict === 'passed'
			? `All ${doneWhen.length} met · ready to ship`
			: verdict === 'sent-back'
				? `${met} of ${doneWhen.length} met · sent back to the agent`
				: unverified
					? `${met} of ${doneWhen.length} met · ${unverified} couldn't be checked`
					: `${met} of ${doneWhen.length} met · needs you`
	);
</script>

<section class="review chat-enter" aria-label="Review {round}">
	<div class="head">
		<span class="title"><StatusIcon state={icons[verdict]} />{title}</span>
		<span class="round">Review {round}</span>
	</div>
	<ul>
		{#each doneWhen as check, index (check)}
			{@const state = checks[index] ?? 'pending'}
			<li class={state}>
				<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.25" />
					{#if state === 'met'}<path d="m5.4 8.2 1.8 1.8 3.4-3.6" />{/if}
					{#if state === 'unmet'}<path d="m6 6 4 4m0-4-4 4" />{/if}
					{#if state === 'unverified'}<path d="M8 4.75v4M8 11.1v.15" />{/if}
				</svg>
				<span>{check}</span>
			</li>
		{/each}
	</ul>
</section>

<style>
	.review {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		font-size: var(--text-chat);
		line-height: 1.5;
	}

	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2) var(--space-4);
	}

	.title {
		--icon-size: 1em;

		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);
		font-weight: 600;

		> :global(svg) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}
	}

	.round {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-meta);
	}

	li {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
	}

	.met span {
		color: var(--color-muted);
	}

	.mark {
		flex: none;
		inline-size: 1.1em;
		block-size: 1.1em;
		translate: 0 calc((1.1em - 1cap) / 2);
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.met .mark {
		stroke: var(--color-accent);
	}

	.unmet .mark {
		stroke: var(--color-danger-text);
	}

	.unverified .mark path {
		stroke: var(--color-accent);
		stroke-width: 1.75;
	}
</style>

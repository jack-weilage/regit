<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import AutomationIcon from './AutomationIcon.svelte';
	import { useFormat } from './format.ts';

	interface Props {
		name: string;
		trigger: string;
		run: number;
		limit: number;
		time?: Date;
		pending?: boolean;
		children: Snippet;
	}

	let { name, trigger, run, limit, time, pending = false, children }: Props = $props();

	const format = useFormat();
</script>

<article class="automation chat-enter" aria-label="Automation {name}">
	<header>
		<AutomationIcon />
		<span><strong>{name}</strong> · {trigger}</span>
		<span class="run">
			{limit > 1 ? `Run ${run} of ${limit}` : 'Ran once'}{#if time}{' · '}<time
					datetime={time.toISOString()}>{format.time(time)}</time
				>{/if}
		</span>
	</header>
	{@render children()}
	{#if pending}
		<p class="pending"><StatusIcon state="running" />Not read yet</p>
	{/if}
</article>

<style>
	.automation {
		display: grid;
		gap: var(--space-3);
		max-inline-size: min(40rem, 100%);
		padding: 0.6em 0.9em;
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--color-surface) 50%, transparent);
	}

	header,
	.pending {
		--icon-size: 1em;

		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	strong {
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-weight: 600;
	}

	.run {
		margin-inline-start: auto;
		font-variant-numeric: tabular-nums;
	}
</style>

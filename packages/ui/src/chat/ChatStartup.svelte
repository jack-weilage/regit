<script module lang="ts">
	export interface StartupStage {
		label: string;
		status: 'pending' | 'running' | 'done' | 'failed';
		startedAt?: number;
		finishedAt?: number;
	}
</script>

<script lang="ts">
	import StatusIcon from '../StatusIcon.svelte';
	import { stopwatch } from './clock.svelte.ts';
	import { formatDuration } from './format.ts';

	interface Props {
		stages: StartupStage[];
		finished?: boolean;
		now?: number;
	}

	let { stages, finished = false, now }: Props = $props();

	let time = $derived(now ?? stopwatch.now);

	let ready = $derived(finished && stages.every((stage) => stage.status === 'done'));
	let failed = $derived(stages.some((stage) => stage.status === 'failed'));
	let started = $derived(stages.find((stage) => stage.startedAt)?.startedAt);
	let endedAt = $derived(stages.at(-1)?.finishedAt);

	const icon = {
		pending: 'pending',
		running: 'running',
		done: 'passed',
		failed: 'failed'
	} as const;
	const took = (stage: StartupStage) =>
		stage.startedAt === undefined ? null : (stage.finishedAt ?? time) - stage.startedAt;
</script>

{#snippet list()}
	<ol>
		{#each stages as stage (stage.label)}
			<li class={stage.status}>
				<StatusIcon state={icon[stage.status]} />
				<span class="label">{stage.label}</span>
				{#if took(stage) !== null}
					<span class="took">{formatDuration(took(stage)!)}</span>
				{/if}
			</li>
		{/each}
	</ol>
{/snippet}

<section class="startup chat-enter" aria-label="Sandbox startup">
	{#if ready && started !== undefined && endedAt !== undefined}
		<details>
			<summary>Sandbox ready · {formatDuration(endedAt - started)}</summary>
			{@render list()}
		</details>
	{:else}
		<p class="title" role="status">
			{failed ? "Sandbox couldn't start" : 'Starting a sandbox'}
			{#if started !== undefined && !failed}
				<span class="took" aria-hidden="true">· {formatDuration(time - started)}</span>
			{/if}
		</p>
		{@render list()}
	{/if}
</section>

<style>
	.startup {
		--icon-size: 1em;

		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.title,
	summary {
		margin: 0;
		padding-block: var(--space-1);
	}

	summary {
		inline-size: fit-content;
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

	ol {
		display: grid;
		gap: var(--space-1);
		max-inline-size: 24rem;
		margin: var(--space-2) 0 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding-block: var(--space-1);
	}

	.running .label {
		color: var(--color-fg);
	}

	.failed .label {
		color: var(--color-danger-text);
	}

	.took {
		font-variant-numeric: tabular-nums;
	}

	li .took {
		margin-inline-start: auto;
	}
</style>

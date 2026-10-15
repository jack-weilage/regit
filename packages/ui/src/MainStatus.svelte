<script module lang="ts">
	import type { MainStatus, VerifyStage } from '@regit/core';

	const stages: Record<VerifyStage, string> = {
		checking: 'Checking',
		rechecking: 'Checking again',
		bisecting: 'Finding what broke',
		deploying: 'Deploying',
		reverting: 'Reverting'
	};

	const short = (sha: string) => sha.slice(0, 7);
</script>

<script lang="ts">
	import Popover from './Popover.svelte';
	import StatusIcon from './StatusIcon.svelte';
	import { clock, stopwatch } from './chat/clock.svelte.ts';
	import { formatDuration, useFormat } from './chat/format.ts';

	interface Props {
		main: MainStatus;
		threadHref?: (thread: string) => string | undefined;
		now?: number;
	}

	let { main, threadHref, now }: Props = $props();

	const format = useFormat();

	const id = $props.id();
	let waitingButton: HTMLButtonElement | undefined = $state();

	let branch = $derived(main.branch ?? 'main');
	let red = $derived(main.verified && !main.verified.passed ? main.verified : null);
	let failing = $derived(red?.results.filter(({ status }) => status === 'failed') ?? []);
	let deployFailed = $derived(
		main.deployFailure && (!main.deployed || main.deployFailure.at > main.deployed.at)
			? main.deployFailure
			: null
	);
	let culpritHref = $derived(red?.culprit?.thread ? threadHref?.(red.culprit.thread) : undefined);
	let summary = $derived.by(() => {
		if (red) return { icon: 'failed', text: `${branch} is failing`, at: red.at } as const;
		if (deployFailed)
			return {
				icon: 'attention',
				text: `Deploying ${short(deployFailed.sha)} failed`,
				at: deployFailed.at
			} as const;
		if (main.failure)
			return {
				icon: 'attention',
				text: `Couldn't check ${short(main.failure.sha)}`,
				at: main.failure.at
			} as const;
		if (main.deployed)
			return {
				icon: 'passed',
				text: `Live ${short(main.deployed.sha)}`,
				at: main.deployed.at
			} as const;
		if (main.green)
			return { icon: 'passed', text: `${branch} is passing`, at: main.green.at } as const;
		return null;
	});
</script>

{#if summary || main.verifying || main.waiting.length}
	<section class="main" aria-label="{branch} checks and deploys">
		{#if main.waiting.length}
			<button bind:this={waitingButton} type="button" class="waiting" popovertarget="{id}-waiting">
				<StatusIcon state="pending" />
				<span class="text">{main.waiting.length} waiting to deploy</span>
				<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
					><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg
				>
			</button>
			<Popover id="{id}-waiting" anchor={waitingButton} align="start" matchWidth>
				<ul class="queue" aria-label="Waiting to deploy">
					{#each main.waiting as commit (commit.sha)}
						{@const href = commit.thread ? threadHref?.(commit.thread) : undefined}
						<li>
							<StatusIcon state="pending" />
							<span class="commit">
								{#if href}<a {href}>{commit.headline || short(commit.sha)}</a>{:else}<span
										class="headline">{commit.headline || short(commit.sha)}</span
									>{/if}
								<code>{short(commit.sha)}</code>
							</span>
						</li>
					{/each}
				</ul>
			</Popover>
		{/if}
		{#if main.verifying}
			{@const { stage, sha, note, started } = main.verifying}
			<p class="activity">
				<StatusIcon state="running" />
				<span class="text"
					>{stages[stage]}
					{short(sha)}{#if note}<span class="note">{note}</span>{/if}</span
				>
				<span class="when">{formatDuration((now ?? stopwatch.now) - started)}</span>
			</p>
		{/if}
		{#if summary}
			<p class={['summary', summary.icon]}>
				<StatusIcon state={summary.icon} />
				<span class="text">{summary.text}</span>
				<time class="when" datetime={new Date(summary.at).toISOString()}
					>{format.ago(summary.at, now ?? clock.now)}</time
				>
			</p>
		{/if}
		{#if red}
			<div class="detail">
				{#if red.culprit}
					<p>
						Broken by
						{#if culpritHref}<a href={culpritHref}
								>{red.culprit.headline || short(red.culprit.sha)}</a
							>{:else}{red.culprit.headline || short(red.culprit.sha)}{/if}
						<code>{short(red.culprit.sha)}</code>
					</p>
				{/if}
				<ul aria-label="Failing checks">
					{#each failing as result (result.name)}
						<li>
							<details>
								<summary>{result.name}</summary>
								<pre>{result.output}</pre>
							</details>
						</li>
					{/each}
				</ul>
				{#if main.green}
					<p class="muted">Deploys wait; the last passing commit is {short(main.green.sha)}.</p>
				{/if}
			</div>
		{:else if deployFailed}
			<details class="detail">
				<summary>Deploy output</summary>
				<pre>{deployFailed.output}</pre>
			</details>
		{:else if main.failure}
			<p class="detail muted">{main.failure.error}</p>
		{/if}
	</section>
{/if}

<style>
	.main {
		display: grid;
		gap: var(--space-3);
		min-inline-size: 0;
		padding: var(--space-4) var(--space-5);
		border-block-start: 1px solid var(--color-border);
		font-size: var(--text-meta);
		line-height: 1.5;
	}

	p,
	ul {
		margin: 0;
	}

	.summary,
	.activity,
	.waiting {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
	}

	.summary {
		font-weight: 600;

		&.failed :global(svg) {
			color: var(--color-danger-text);
		}

		&.attention :global(svg) {
			color: var(--color-accent);
		}

		&.passed :global(svg) {
			color: var(--color-muted);
		}
	}

	.activity {
		color: var(--color-muted);
	}

	.waiting {
		inline-size: calc(100% + 2 * var(--space-3));
		margin-inline: calc(-1 * var(--space-3));
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;

		&:hover,
		&:has(+ :popover-open) {
			background: var(--color-surface);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}

		:global(svg.status) {
			color: var(--color-muted);
		}
	}

	.chevron {
		flex: none;
		inline-size: 1em;
		block-size: 1em;
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.queue {
		display: grid;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);
		font-size: var(--text-meta);
		line-height: 1.5;

		li {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			column-gap: var(--space-4);
			align-items: baseline;
			color: var(--color-muted);
		}
	}

	.commit {
		display: grid;
		min-inline-size: 0;

		a,
		.headline {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			color: var(--color-fg);
		}
	}

	.text {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.note {
		margin-inline-start: var(--space-3);
	}

	.when {
		flex: none;
		color: var(--color-muted);
		font-weight: normal;
		font-variant-numeric: tabular-nums;
	}

	.detail {
		display: grid;
		gap: var(--space-2);
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.muted {
		color: var(--color-muted);
	}

	a {
		color: inherit;
		text-decoration-color: var(--color-muted);
		text-underline-offset: 2px;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
			border-radius: var(--radius);
		}
	}

	code {
		font-family: var(--font-mono);
		color: var(--color-muted);
	}

	ul {
		display: grid;
		gap: var(--space-1);
		padding: 0;
		list-style: none;
	}

	summary {
		inline-size: fit-content;
		cursor: pointer;
		color: var(--color-danger-text);

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
			border-radius: var(--radius);
		}
	}

	.detail > summary {
		color: var(--color-fg);
	}

	pre {
		max-block-size: 12em;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		margin: var(--space-2) 0 0;
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		font-family: var(--font-mono);
		font-size: inherit;
	}
</style>

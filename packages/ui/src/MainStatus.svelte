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
	import StatusIcon from './StatusIcon.svelte';
	import { clock, stopwatch } from './chat/clock.svelte.ts';
	import { formatAgo, formatDuration } from './chat/format.ts';

	interface Props {
		main: MainStatus;
		culpritHref?: string;
		now?: number;
	}

	let { main, culpritHref, now }: Props = $props();

	let branch = $derived(main.branch ?? 'main');
	let red = $derived(main.verified && !main.verified.passed ? main.verified : null);
	let failing = $derived(red?.results.filter(({ status }) => status === 'failed') ?? []);
	let deployFailed = $derived(
		main.deployFailure && (!main.deployed || main.deployFailure.at > main.deployed.at)
			? main.deployFailure
			: null
	);
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
				text: `Deployed ${short(main.deployed.sha)}`,
				at: main.deployed.at
			} as const;
		if (main.green)
			return { icon: 'passed', text: `${branch} is passing`, at: main.green.at } as const;
		return null;
	});
</script>

{#if summary || main.verifying}
	<section class="main" aria-label="{branch} checks and deploys">
		{#if summary}
			<p class={['summary', summary.icon]}>
				<StatusIcon state={summary.icon} />
				<span class="text">{summary.text}</span>
				<time class="when" datetime={new Date(summary.at).toISOString()}
					>{formatAgo(summary.at, now ?? clock.now)}</time
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
	.activity {
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

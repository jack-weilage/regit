<script lang="ts">
	import {
		ciSecretPattern,
		ciSecretRule,
		type CiRun,
		type CiStatus,
		type CiStep,
		type QueuedCiRun
	} from '@regit/core';
	import type { Attachment } from 'svelte/attachments';
	import Button from './Button.svelte';
	import StatusIcon from './StatusIcon.svelte';
	import { ciStatuses, ciStepStatuses } from './ci-status.ts';
	import { clock, stopwatch } from './chat/clock.svelte.ts';
	import { formatAgo, formatDuration } from './chat/format.ts';

	interface Props {
		repo: string;
		runs: CiRun[];
		queued?: QueuedCiRun | null;
		selected?: string | null;
		step?: string | null;
		log?: string | null;
		secrets?: string[] | null;
		now?: number;
		onrerun?: (id: string) => void;
		oncancel?: (id: string) => void;
		onsetsecret?: (secret: { name: string; value: string }) => void;
		ondeletesecret?: (name: string) => void;
	}

	let {
		repo,
		runs,
		queued = null,
		selected = $bindable(null),
		step = $bindable(null),
		log = null,
		secrets = null,
		now,
		onrerun,
		oncancel,
		onsetsecret,
		ondeletesecret
	}: Props = $props();

	const id = $props.id();

	let name = $state('');
	let value = $state('');

	const active = (status: CiStatus) => status === 'preparing' || status === 'running';

	let time = $derived(now ?? (runs.some((run) => active(run.status)) ? stopwatch.now : clock.now));
	let run = $derived(runs.find((run) => run.id === selected) ?? runs[0]);
	let current = $derived(
		run?.steps.find((candidate) => candidate.name === step) ??
			run?.steps.find((candidate) => candidate.status === 'running') ??
			run?.steps.find((candidate) => candidate.status === 'failed') ??
			run?.steps.at(-1)
	);
	let invalid = $derived(name !== '' && !ciSecretPattern.test(name));

	const short = (sha: string) => sha.slice(0, 7);
	const took = (start: number, end: number | null) => formatDuration((end ?? time) - start);

	function output(step: CiStep) {
		if (log === null) return 'Loading…';
		if (log) return log;
		if (step.status === 'pending') return 'Not started.';
		if (step.status === 'skipped') return 'Skipped.';
		return 'No output yet.';
	}

	function pick(next: string) {
		selected = next;
		step = null;
	}

	function save(event: SubmitEvent) {
		event.preventDefault();
		if (!ciSecretPattern.test(name) || !value) return;
		onsetsecret?.({ name, value });
		name = '';
		value = '';
	}

	const follow: Attachment<HTMLElement> = (node) => {
		let pinned = true;
		const onscroll = () => (pinned = node.scrollHeight - node.scrollTop - node.clientHeight < 8);
		const observer = new MutationObserver(() => {
			if (pinned) node.scrollTop = node.scrollHeight;
		});
		node.scrollTop = node.scrollHeight;
		observer.observe(node, { childList: true, characterData: true, subtree: true });
		node.addEventListener('scroll', onscroll);
		return () => {
			observer.disconnect();
			node.removeEventListener('scroll', onscroll);
		};
	};
</script>

<section class="ci" aria-labelledby="{id}-title">
	<header>
		<h1 id="{id}-title">CI</h1>
		<p class="meta">
			<span>{repo}</span><span>Runs <code>.agents/ci.yml</code> when commits land</span>
		</p>
	</header>

	<div class={['body', { split: !!run }]}>
		{#if run}
			<div class="runs">
				{#if queued}
					<p class="queued">
						<StatusIcon state="pending" />
						<span class="title">
							Queued · <span class="sha">{short(queued.sha)}</span>
							<span class="headline">{queued.headline || 'No message'}</span>
						</span>
					</p>
				{/if}
				<ul aria-label="Runs">
					{#each runs as item (item.id)}
						<li>
							<button
								type="button"
								class={['run', item.status]}
								aria-pressed={item.id === run.id}
								onclick={() => pick(item.id)}
							>
								<StatusIcon state={ciStatuses[item.status].icon} />
								<span class="text">
									<span class="title">
										<span class="sha">{short(item.sha)}</span>
										<span class="headline">{item.headline || 'No message'}</span>
									</span>
									<span class="meta">
										{ciStatuses[item.status].label} · {took(item.startedAt, item.finishedAt)} ·
										{formatAgo(item.startedAt, time)}{item.by ? ` · run again by ${item.by}` : ''}
									</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<div class="detail">
				<div class="summary">
					<div class="what">
						<h2>
							<span class="sha">{short(run.sha)}</span>
							{run.headline || 'No message'}
						</h2>
						<p class="meta">
							<span>{run.branch}</span>
							<span>{ciStatuses[run.status].label}</span>
							<span>{took(run.startedAt, run.finishedAt)}</span>
						</p>
					</div>
					{#if secrets}
						{#if active(run.status)}
							<Button size="sm" onclick={() => oncancel?.(run.id)}>Cancel</Button>
						{:else}
							<Button size="sm" onclick={() => onrerun?.(run.id)}>Run again</Button>
						{/if}
					{/if}
				</div>

				{#if run.error}<p class="error">{run.error}</p>{/if}

				<ol class="steps" aria-label="Steps">
					{#each run.steps as item (item.name)}
						<li>
							<button
								type="button"
								class={['step', item.status]}
								aria-pressed={item.name === current?.name}
								onclick={() => (step = item.name)}
							>
								<StatusIcon
									state={ciStepStatuses[item.status].icon}
									role="img"
									aria-label={ciStepStatuses[item.status].label}
								/>
								<span class="name">{item.name}</span>
								{#if item.status === 'failed' && item.exitCode !== null}
									<span class="exit">exit {item.exitCode}</span>
								{/if}
								{#if item.startedAt !== null}
									<span class="time">{took(item.startedAt, item.finishedAt)}</span>
								{/if}
							</button>
						</li>
					{/each}
				</ol>

				{#if current}
					<div class="output">
						{#if current.command}<code class="command">{current.command}</code>{/if}
						{#key `${run.id}/${current.name}`}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<pre
								role="log"
								aria-label="Log of {current.name}"
								tabindex="0"
								{@attach current.status === 'running' && follow}>{output(current)}</pre>
						{/key}
					</div>
				{/if}
			</div>
		{:else}
			<p class="empty">
				No runs yet. Add steps to <code>.agents/ci.yml</code> to run them on each commit that lands.
			</p>
		{/if}

		{#if secrets}
			<section class="secrets" aria-labelledby="{id}-secrets">
				<h2 id="{id}-secrets">Secrets</h2>
				<p class="hint">Passed to every step as environment variables.</p>
				{#if secrets.length}
					<ul aria-label="Secrets">
						{#each secrets as secret (secret)}
							<li>
								<code>{secret}</code>
								<Button
									size="xs"
									variant="ghost"
									aria-label="Remove {secret}"
									onclick={() => ondeletesecret?.(secret)}>Remove</Button
								>
							</li>
						{/each}
					</ul>
				{/if}
				<form onsubmit={save}>
					<input
						aria-label="Secret name"
						placeholder="API_TOKEN"
						autocomplete="off"
						spellcheck="false"
						aria-invalid={invalid}
						aria-describedby={invalid ? `${id}-rule` : undefined}
						bind:value={name}
					/>
					<input
						type="password"
						aria-label="Secret value"
						placeholder="Value"
						autocomplete="new-password"
						bind:value
					/>
					<Button type="submit" size="sm">Save</Button>
					{#if invalid}<p id="{id}-rule" class="rule">{ciSecretRule}</p>{/if}
				</form>
			</section>
		{/if}
	</div>
</section>

<style>
	.ci {
		container: ci / inline-size;
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-inline-size: 0;
		background: var(--color-bg);
		font-size: var(--text-chat);
		line-height: 1.5;
	}

	header {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-block-end: 1px solid var(--color-border);
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		font-size: inherit;
		font-weight: 600;
	}

	h2 {
		font-size: inherit;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	code,
	pre,
	.sha {
		font-family: var(--font-mono);
	}

	.meta {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	p.meta {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);

		> * + *::before {
			content: '·';
			margin-inline-end: var(--space-3);
			opacity: 0.6;
		}
	}

	.body {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr);
		align-content: start;
		min-block-size: 0;
		overflow-y: auto;
	}

	.runs {
		display: grid;
		gap: var(--space-1);
		padding: var(--space-3);
		border-block-end: 1px solid var(--color-border);

		ul {
			display: grid;
			gap: var(--space-1);
			margin: 0;
			padding: 0;
			list-style: none;
		}
	}

	.queued,
	.run {
		--icon-size: 1em;

		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);

		> :global(.status) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}
	}

	.queued {
		color: var(--color-muted);
	}

	.run,
	.step {
		inline-size: 100%;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;

		&:hover,
		&[aria-pressed='true'] {
			background: var(--color-surface);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
		}

		&.passed > :global(.status) {
			color: var(--color-added);
		}

		&.failed > :global(.status) {
			color: var(--color-danger-text);
		}

		&.cancelled > :global(.status),
		&.skipped > :global(.status) {
			color: var(--color-muted);
		}
	}

	.text {
		display: grid;
		min-inline-size: 0;
	}

	.title {
		display: flex;
		gap: var(--space-3);
		min-inline-size: 0;
		white-space: nowrap;
	}

	.headline {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.run .meta {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.detail {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-block-size: 0;
		padding: var(--space-5) var(--space-6);
		border-block-end: 1px solid var(--color-border);
	}

	.summary {
		display: flex;
		align-items: start;
		gap: var(--space-5);

		.what {
			display: grid;
			flex: 1;
			gap: var(--space-2);
			min-inline-size: 0;
		}

		h2 .sha {
			margin-inline-end: var(--space-3);
			color: var(--color-muted);
			font-weight: 400;
		}
	}

	.error {
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		background: color-mix(in oklab, var(--color-danger) 10%, var(--color-bg));
		color: var(--color-danger-text);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.steps {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.step {
		--icon-size: 1em;

		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-3) var(--space-4);

		.name {
			flex: 1;
			min-inline-size: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.exit {
			color: var(--color-danger-text);
			font-family: var(--font-mono);
			font-size: var(--text-meta);
		}

		.time {
			color: var(--color-muted);
			font-size: var(--text-meta);
			font-variant-numeric: tabular-nums;
		}

		&.pending,
		&.skipped {
			color: var(--color-muted);
		}
	}

	.output {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-block-size: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.command {
		padding: var(--space-3) var(--space-5);
		border-block-end: 1px solid var(--color-border);
		background: var(--color-surface);
		font-size: var(--text-meta);
		overflow-wrap: anywhere;
	}

	pre {
		flex: 1;
		min-block-size: 8rem;
		max-block-size: 24rem;
		margin: 0;
		padding: var(--space-4) var(--space-5);
		overflow: auto;
		font-size: var(--text-meta);
		white-space: pre-wrap;
		overflow-wrap: anywhere;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
		}
	}

	.empty {
		padding: var(--space-7) var(--space-6);
		color: var(--color-muted);
	}

	.secrets {
		display: grid;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-6);

		.hint {
			color: var(--color-muted);
			font-size: var(--text-meta);
		}

		ul {
			display: grid;
			gap: var(--space-1);
			margin: 0;
			padding: 0;
			list-style: none;
		}

		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-4);

			code {
				min-inline-size: 0;
				overflow-wrap: anywhere;
				font-size: var(--text-meta);
			}
		}
	}

	form {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);

		input {
			flex: 1;
			min-inline-size: 8rem;
			padding: 0.35em 0.6em;
			border: 1px solid var(--color-border);
			border-radius: var(--radius);
			background: var(--color-bg);
			color: inherit;
			font: inherit;
			font-size: var(--text-meta);

			&:first-child {
				font-family: var(--font-mono);
			}

			&[aria-invalid='true'] {
				border-color: var(--color-danger-text);
			}

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: -1px;
			}
		}

		.rule {
			flex-basis: 100%;
			color: var(--color-danger-text);
			font-size: var(--text-meta);
		}
	}

	@container ci (width >= 48rem) {
		.body.split {
			grid-template-columns: minmax(16rem, 22rem) minmax(0, 1fr);
			grid-template-rows: minmax(0, 1fr) auto;
			grid-template-areas:
				'runs detail'
				'secrets detail';
			align-content: stretch;
			overflow: hidden;

			.runs {
				grid-area: runs;
				align-content: start;
				overflow-y: auto;
				border-block-end: 0;
				border-inline-end: 1px solid var(--color-border);
			}

			.secrets {
				grid-area: secrets;
				border-block-start: 1px solid var(--color-border);
				border-inline-end: 1px solid var(--color-border);
			}

			.detail {
				grid-area: detail;
				overflow-y: auto;
				border-block-end: 0;
			}

			pre {
				max-block-size: none;
			}
		}
	}
</style>

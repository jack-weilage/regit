<script lang="ts">
	import ChatMention from './ChatMention.svelte';
	import type { Mentionable } from './types.ts';

	interface Props {
		headline: string;
		purpose: string;
		doneWhen: string[];
		similar?: Mentionable[];
		superseded?: boolean;
		onstart?: () => void;
	}

	let { headline, purpose, doneWhen, similar = [], superseded = false, onstart }: Props = $props();
</script>

{#snippet details()}
	<p class="purpose">{purpose}</p>
	<div class="section">
		<p class="heading">Done when</p>
		<ul class="checks">
			{#each doneWhen as check (check)}
				<li>
					<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /></svg>
					{check}
				</li>
			{/each}
		</ul>
	</div>
{/snippet}

<section class="intent" aria-label={superseded ? 'Superseded intent' : 'Suggested intent'}>
	{#if superseded}
		<details class="card superseded">
			<summary>
				<span class="label">Superseded</span>
				<span class="headline">{headline}</span>
			</summary>
			<div class="body">
				{@render details()}
			</div>
		</details>
	{:else}
		<div class="card chat-enter">
			<p class="headline">{headline}</p>

			{@render details()}

			{#if similar.length}
				<div class="section">
					<p class="heading">Similar threads</p>
					<ul class="similar">
						{#each similar as thread (thread.handle)}
							<li>
								<ChatMention mention={thread} />
								{#if thread.detail}
									<span>{thread.detail}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if onstart}
				<div class="actions">
					<button type="button" onclick={onstart}>Start</button>
				</div>
			{/if}
		</div>
	{/if}
</section>

<style>
	.intent {
		container: intent / inline-size;
	}

	.card {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: calc(var(--radius) * 2);
		background: var(--color-bg);
		font-size: var(--text-chat);
		line-height: 1.5;

		p {
			margin: 0;
		}
	}

	.headline {
		font-family: var(--font-mono);
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.purpose {
		color: var(--color-muted);
	}

	.section {
		display: grid;
		gap: 0.375rem;
		margin-block-start: 0.25rem;
	}

	.purpose + .section {
		margin-block-start: 0.75rem;
	}

	.heading {
		color: var(--color-muted);
		font-size: var(--text-meta);
		font-weight: 600;
	}

	.checks,
	.similar {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			gap: 0.5rem;
		}
	}

	.checks {
		li {
			align-items: baseline;
			padding: 0.5rem 0.75rem;
			border-radius: var(--radius);
			background: var(--color-surface);
		}

		svg {
			--size: 1rem;

			flex: none;
			inline-size: var(--size);
			block-size: var(--size);
			translate: 0 calc((var(--size) - 1cap) / 2);
			fill: none;
			stroke: var(--color-muted);
			stroke-width: 1.5;
		}
	}

	.similar {
		li {
			flex-wrap: wrap;
			align-items: baseline;
			column-gap: 0.5rem;
		}

		span {
			color: var(--color-muted);
			font-size: var(--text-meta);
		}
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-block-start: 0.25rem;
	}

	button {
		padding: 0.375rem 0.875rem;
		border: 0;
		border-radius: var(--radius);
		background: var(--color-accent);
		color: var(--color-accent-fg);
		font: inherit;
		font-weight: 500;
		cursor: pointer;

		&:hover {
			background: color-mix(in oklab, var(--color-accent) 88%, var(--color-fg));
		}
	}

	.superseded {
		display: block;
		padding: 0.5rem 0.75rem;
		border-style: dashed;
		background: none;
		color: var(--color-muted);

		.body {
			display: grid;
			gap: 0.5rem;
			margin-block-start: 0.5rem;
		}
	}

	summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-meta);
		list-style: none;
		cursor: pointer;

		&::before {
			content: '';
			flex: none;
			inline-size: 0.375rem;
			block-size: 0.375rem;
			border-block-end: 1.5px solid;
			border-inline-end: 1.5px solid;
			rotate: -45deg;
			transition: rotate 0.15s;
		}

		.label {
			flex: none;
			font-weight: 600;
		}

		.headline {
			overflow: hidden;
			font-weight: 500;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	details[open] summary::before {
		rotate: 45deg;
	}

	@container intent (width < 28rem) {
		.actions button {
			flex: 1;
		}
	}
</style>

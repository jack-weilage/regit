<script lang="ts">
	import Button from '../Button.svelte';
	import ChatChecks from './ChatChecks.svelte';
	import ChatMention from './ChatMention.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import type { Mentionable } from './types.ts';

	interface Props {
		headline: string;
		purpose: string;
		doneWhen: string[];
		similar?: Mentionable[];
		handoff?: boolean;
		superseded?: boolean;
		onstart?: () => void;
		ondismiss?: () => void;
	}

	let {
		headline,
		purpose,
		doneWhen,
		similar = [],
		handoff = false,
		superseded = false,
		onstart,
		ondismiss
	}: Props = $props();
</script>

{#snippet details()}
	<p class="purpose">{purpose}</p>
	<div class="section">
		<p class="heading">Done when</p>
		<ChatChecks checks={doneWhen} />
	</div>
{/snippet}

{#if superseded || handoff}
	<section class="intent" aria-label={superseded ? 'Superseded intent' : 'Suggested separate work'}>
		<div class={['card', 'collapsed', { superseded, 'chat-enter': !superseded }]}>
			<details>
				<summary>
					{#if superseded}
						<s class="headline">{headline}</s>
					{:else}
						<ThreadIcon plus />
						<span class="headline">{headline}</span>
					{/if}
				</summary>
				<div class="body">
					{@render details()}
				</div>
			</details>
			{#if !superseded && (onstart || ondismiss)}
				<div class="actions">
					{#if ondismiss}
						<Button size="sm" onclick={ondismiss}>Dismiss</Button>
					{/if}
					{#if onstart}
						<Button variant="primary" size="sm" onclick={onstart}>Spin off</Button>
					{/if}
				</div>
			{/if}
		</div>
	</section>
{:else}
	<section class="intent" aria-label="Suggested intent">
		<div class="card chat-enter">
			<p class="headline">{headline}</p>

			{@render details()}

			{#if similar.length}
				<div class="section">
					<p class="heading">Similar threads</p>
					<ul class="similar">
						{#each similar as item (item.handle)}
							<li>
								<ChatMention mention={item} />
								{#if item.detail}
									<span>{item.detail}</span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if onstart}
				<div class="actions">
					<Button variant="primary" onclick={onstart}>Start</Button>
				</div>
			{/if}
		</div>
	</section>
{/if}

<style>
	.intent {
		container: intent / inline-size;
	}

	.card {
		display: grid;
		gap: 0.5rem;
		padding: 1rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
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

	.similar {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			flex-wrap: wrap;
			align-items: baseline;
			gap: 0.5rem;
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

	.collapsed {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: baseline;
		column-gap: 0.75rem;
		padding: 0.5rem 0.5rem 0.5rem 1rem;

		details {
			display: grid;
			grid-area: 1 / 1 / 2 / -1;
			grid-template-columns: subgrid;

			&::details-content {
				grid-column: 1 / -1;
			}
		}

		summary {
			grid-column: 1;
		}

		.body {
			display: grid;
			gap: 0.5rem;
			margin-block-start: 0.5rem;
		}

		.actions {
			grid-area: 1 / 2;
			gap: 0.25rem;
			margin: 0;
		}
	}

	.superseded {
		padding: 0.5rem 0.75rem 0.5rem 1rem;
		border-style: dashed;
		background: none;
		color: var(--color-muted);
	}

	summary {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		list-style: none;
		cursor: pointer;

		> :global(svg) {
			--icon-size: 1rem;

			translate: 0 calc((var(--icon-size) - 1ex) / 2);
			color: var(--color-muted);
		}

		.headline {
			overflow: hidden;
			font-weight: 500;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		s {
			text-decoration-color: color-mix(in oklab, currentColor 60%, transparent);
		}
	}

	@container intent (width < 28rem) {
		.actions > :global(*) {
			flex: 1;
		}

		.collapsed {
			grid-template-columns: minmax(0, 1fr);

			.actions {
				grid-area: 2 / 1;
			}
		}
	}
</style>

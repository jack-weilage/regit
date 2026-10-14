<script lang="ts">
	import Avatar from '../Avatar.svelte';
	import Button from '../Button.svelte';
	import Menu from '../Menu.svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import ChatMention from './ChatMention.svelte';
	import { needsYou as flagged, statuses } from './status.ts';
	import type { Author, Mentionable, ThreadAction, ThreadStatus } from './types.ts';

	interface Props {
		headline: string;
		number?: number;
		status: ThreadStatus;
		needsYou?: boolean;
		parent?: Mentionable;
		people?: Author[];
		actions?: ThreadAction[];
		onpreview?: () => void;
	}

	let {
		headline,
		number,
		status,
		needsYou = false,
		parent,
		people = [],
		actions = [],
		onpreview
	}: Props = $props();

	let current = $derived(status === 'idle' && needsYou ? flagged : statuses[status]);
</script>

<header>
	<div class="main">
		<h1 class="headline">{headline}</h1>
		<p class="meta">
			{#if number}<span class="number">#{number}</span>{/if}
			<span class="status"><StatusIcon state={current.icon} />{current.label}</span>
			{#if parent}
				<span>Spun off from <ChatMention mention={parent} /></span>
			{/if}
			{#if people.length}
				<span class="people">
					{#each people as person (person.name)}
						<Avatar name={person.name} src={person.avatar} title={person.name} />
					{/each}
				</span>
			{/if}
		</p>
	</div>
	<div class="actions">
		{#if onpreview}
			<Button variant="ghost" size="sm" onclick={onpreview} aria-label="Preview">
				<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
					<path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
				</svg>
				<span class="label" aria-hidden="true">Preview</span>
			</Button>
		{/if}
		{#if actions.length}
			<Menu label="Thread actions" items={actions}>
				{#snippet trigger(props)}
					<Button variant="ghost" size="sm" icon aria-label="Thread actions" {...props}>
						<svg class="icon" viewBox="0 0 16 16" aria-hidden="true">
							<path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />
						</svg>
					</Button>
				{/snippet}
			</Menu>
		{/if}
	</div>
</header>

<style>
	header {
		container: header / inline-size;
		display: flex;
		align-items: start;
		gap: var(--space-5);
		padding: var(--space-4) var(--space-6);
		border-block-end: 1px solid var(--color-border);
		font-size: var(--text-chat);
	}

	.main {
		display: grid;
		gap: var(--space-2);
		min-inline-size: 0;
	}

	.headline {
		margin: 0;
		font-family: var(--font-mono);
		font-size: inherit;
		font-weight: 600;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	.meta {
		--avatar-size: 1.5em;

		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);

		> * + *::before {
			content: '·';
			margin-inline-end: var(--space-3);
			opacity: 0.6;
		}
	}

	.status {
		--icon-size: 1em;

		display: inline-flex;
		align-items: baseline;
		gap: var(--space-3);

		> :global(svg) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}
	}

	.people {
		display: inline-flex;
		align-items: baseline;

		> :global(.avatar) {
			translate: 0 calc((var(--avatar-size) - 1cap) / 2);
		}

		> :global(.avatar + .avatar) {
			margin-inline-start: -0.35em;
			box-shadow: 0 0 0 2px var(--color-bg);
		}
	}

	.actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-1);
		margin-block: -0.3em;
		margin-inline-start: auto;
		color: var(--color-muted);
	}

	.icon {
		inline-size: 1.25em;
		block-size: 1.25em;
		align-self: center;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@container header (width < 28rem) {
		.label {
			display: none;
		}

		.meta {
			flex-direction: column;
			gap: var(--space-2);

			> * + *::before {
				content: none;
			}
		}
	}
</style>

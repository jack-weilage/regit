<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from '../Avatar.svelte';
	import { formatTime } from './format.ts';
	import type { Author } from './types.ts';

	interface Props {
		author: Author;
		time?: Date;
		own?: boolean;
		children: Snippet;
	}

	let { author, time, own = false, children }: Props = $props();

	let headless = $derived(own || author.kind === 'agent');
</script>

<article
	class={['group', { own }]}
	data-kind={author.kind}
	aria-label={headless ? (own ? 'You' : author.name) : undefined}
>
	{#if !headless}
		<header class="chat-enter">
			<Avatar name={author.name} src={author.avatar} aria-hidden="true" />
			<span class="name">{author.name}</span>
			{#if time}
				<time datetime={time.toISOString()}>{formatTime(time)}</time>
			{/if}
		</header>
	{/if}
	<div class="messages">
		{@render children()}
	</div>
</article>

<style>
	.group {
		--chat-role: person;

		display: flex;
		flex-direction: column;
		align-items: start;
		gap: 0.375rem;
	}

	.group[data-kind='agent'] {
		--chat-role: agent;
	}

	.group.own {
		--chat-role: own;
	}

	header {
		--avatar-size: 1.125rem;

		display: flex;
		align-items: center;
		gap: 0.375rem;
		max-inline-size: 100%;
		padding-inline: 0.25rem;
		font-size: var(--text-meta);
		line-height: 1rem;
	}

	.name {
		overflow: hidden;
		font-weight: 500;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	time {
		flex: none;
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
	}

	.messages {
		display: flex;
		flex-direction: column;
		align-items: start;
		gap: 0.25rem;
		align-self: stretch;
		min-inline-size: 0;
	}

	.group.own .messages {
		align-items: end;
	}

	.group[data-kind='agent'] .messages {
		align-items: stretch;
		gap: 0.75rem;
	}
</style>

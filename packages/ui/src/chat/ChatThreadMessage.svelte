<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusIcon from '../StatusIcon.svelte';
	import ChatMention from './ChatMention.svelte';
	import type { Mentionable } from './types.ts';

	interface Props {
		direction: 'in' | 'out';
		thread: Mentionable;
		pending?: boolean;
		children: Snippet;
	}

	let { direction, thread, pending = false, children }: Props = $props();
</script>

<article
	class="thread-message chat-enter"
	aria-label="{direction === 'in' ? 'Message from' : 'Message to'} {thread.label}"
>
	<header>{direction === 'in' ? 'From' : 'To'} <ChatMention mention={thread} /></header>
	{@render children()}
	{#if pending}
		<p class="pending"><StatusIcon state="running" />Not read yet</p>
	{/if}
</article>

<style>
	.thread-message {
		display: grid;
		gap: var(--space-3);
		max-inline-size: min(40rem, 100%);
		padding: 0.6em 0.9em;
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
	}

	header,
	.pending {
		--icon-size: 1em;

		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}
</style>

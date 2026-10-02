<script lang="ts">
	import Avatar from '../Avatar.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import type { Mentionable } from './types.ts';

	interface Props {
		mention: Mentionable;
	}

	let { mention }: Props = $props();
</script>

<svelte:element this={mention.href ? 'a' : 'span'} class="mention" href={mention.href}>
	{#if mention.kind === 'thread'}
		<ThreadIcon />
	{:else}
		<Avatar name={mention.label} src={mention.avatar} aria-hidden="true" />
	{/if}
	<span class="label">{mention.label}</span>
</svelte:element>

<style>
	.mention {
		--icon-size: 0.875em;
		--avatar-size: 1.125em;

		box-sizing: border-box;
		display: inline-flex;
		align-items: baseline;
		gap: 0.3em;
		max-inline-size: min(100%, 20em);
		padding: 0.05em 0.3em;
		border-radius: 0.25rem;
		background: color-mix(in oklab, currentColor 8%, transparent);
		color: inherit;
		font-weight: 500;
		text-decoration: none;

		& :global(svg) {
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}

		& :global(.avatar) {
			translate: 0 calc((var(--avatar-size) - 1cap) / 2);
		}
	}

	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	a.mention:hover {
		background: color-mix(in oklab, currentColor 14%, transparent);
	}
</style>

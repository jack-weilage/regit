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
		<ThreadIcon />{mention.label}
	{:else}
		<Avatar name={mention.label} src={mention.avatar} aria-hidden="true" />{mention.label}
	{/if}
</svelte:element>

<style>
	.mention {
		--icon-size: 0.875em;
		--avatar-size: 1.125em;

		padding: 0.05em 0.3em;
		border-radius: 0.25rem;
		background: color-mix(in oklab, currentColor 8%, transparent);
		color: inherit;
		font-weight: 500;
		text-decoration: none;

		& :global(svg) {
			margin-inline-end: 0.25em;
			vertical-align: calc((1cap - var(--icon-size)) / 2);
		}

		& :global(.avatar) {
			margin-inline-end: 0.3em;
			vertical-align: calc((1cap - var(--avatar-size)) / 2);
		}
	}

	a.mention:hover {
		background: color-mix(in oklab, currentColor 14%, transparent);
	}
</style>

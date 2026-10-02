<script lang="ts">
	// TODO: show a profile preview on hover wherever avatars appear (thread previews, the thread header, chat groups, mentions)
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLSpanElement> {
		name: string;
		src?: string;
		shape?: 'circle' | 'square';
	}

	let { name, src, shape = 'circle', ...rest }: Props = $props();

	let initials = $derived(
		name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((word) => word[0]!.toUpperCase())
			.join('')
	);
	let hue = $derived([...name].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 360, 0));
</script>

<span class="avatar" data-shape={shape} style:--hue={hue} role="img" aria-label={name} {...rest}>
	{#if src}
		<img {src} alt="" />
	{:else}
		<span class="initials">{initials}</span>
	{/if}
</span>

<style>
	@property --avatar-size {
		syntax: '<length>';
		inherits: true;
		initial-value: 32px;
	}

	.avatar {
		contain: layout;
		display: inline-block;
		flex: none;
		inline-size: var(--avatar-size);
		block-size: var(--avatar-size);
		overflow: hidden;
		border-radius: 50%;
		background: light-dark(oklch(0.92 0.05 var(--hue)), oklch(0.34 0.06 var(--hue)));
		color: light-dark(oklch(0.38 0.1 var(--hue)), oklch(0.9 0.06 var(--hue)));
		user-select: none;
	}

	.initials {
		display: grid;
		place-items: center;
		block-size: 100%;
		font-size: calc(var(--avatar-size) * 0.4);
		font-weight: 600;
		line-height: 1;
	}

	.avatar[data-shape='square'] {
		border-radius: calc(var(--avatar-size) * 0.25);
	}

	img {
		display: block;
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
</style>

<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	interface Props extends SVGAttributes<SVGSVGElement> {
		plus?: boolean;
	}

	let { plus = false, ...rest }: Props = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true" {...rest}>
	{#if plus}
		<path d="M9.5 3H3a1 1 0 0 0-1 1v6.5a1 1 0 0 0 1 1h1.5V14l3-2.5H13a1 1 0 0 0 1-1v-3" />
		<path d="M12.5 1v4M10.5 3h4" />
	{:else}
		<path
			d="M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
		/>
	{/if}
</svg>

<style>
	svg {
		flex: none;
		inline-size: var(--icon-size, 1.25em);
		block-size: var(--icon-size, 1.25em);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.25;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

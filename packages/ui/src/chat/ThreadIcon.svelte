<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	let props: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true" {...props}>
	<path
		d="M3 3h10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H7.5L4.5 14v-2.5H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
	/>
</svg>

<style>
	svg {
		flex: none;
		inline-size: var(--icon-size, 1rem);
		block-size: var(--icon-size, 1rem);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.25;
		stroke-linejoin: round;
	}
</style>

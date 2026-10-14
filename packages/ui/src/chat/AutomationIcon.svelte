<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	let props: SVGAttributes<SVGSVGElement> = $props();
</script>

<svg class="automation-icon" viewBox="0 0 16 16" aria-hidden="true" {...props}>
	<circle cx="8" cy="8.5" r="5.25" />
	<path d="M8 5.75V8.5l1.75 1.25M6.5 1.75h3" />
</svg>

<style>
	.automation-icon {
		flex: none;
		inline-size: var(--icon-size, 1em);
		block-size: var(--icon-size, 1em);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

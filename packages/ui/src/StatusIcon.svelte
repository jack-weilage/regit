<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	interface Props extends SVGAttributes<SVGSVGElement> {
		state: 'pending' | 'running' | 'attention' | 'passed' | 'failed';
	}

	let { state, ...rest }: Props = $props();
</script>

<svg class={['status', state]} viewBox="0 0 16 16" aria-hidden="true" {...rest}>
	{#if state === 'attention'}
		<circle cx="8" cy="8" r="4.5" />
	{:else}
		<circle class="track" cx="8" cy="8" r="6" />
		{#if state === 'running'}
			<path class="arc" d="M8 2a6 6 0 0 1 6 6" />
		{:else if state === 'passed'}
			<path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
		{:else if state === 'failed'}
			<path d="m6 6 4 4m0-4-4 4" />
		{/if}
	{/if}
</svg>

<style>
	.status {
		flex: none;
		inline-size: var(--icon-size, 1em);
		block-size: var(--icon-size, 1em);
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.track {
		opacity: 0.4;
	}

	.passed .track,
	.failed .track {
		opacity: 1;
	}

	.running .arc {
		stroke: var(--color-accent);
	}

	.attention {
		fill: var(--color-accent);
		stroke: none;
	}

	@media (prefers-reduced-motion: no-preference) {
		.running {
			animation: spin 0.9s linear infinite;
		}
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}
</style>

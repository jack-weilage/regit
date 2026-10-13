<script lang="ts">
	import type { SVGAttributes } from 'svelte/elements';

	interface Props extends SVGAttributes<SVGSVGElement> {
		state: 'pending' | 'running' | 'shipping' | 'attention' | 'passed' | 'failed';
	}

	let { state, ...rest }: Props = $props();
</script>

<svg
	class={['status', state]}
	viewBox="0 0 16 16"
	aria-hidden={rest['aria-label'] ? undefined : 'true'}
	{...rest}
>
	{#if state === 'attention'}
		<circle cx="8" cy="8" r="4.5" />
	{:else if state === 'shipping'}
		<path
			class="water"
			d="M-4 14c1-.8 2-.8 3 0s2 .8 3 0 2-.8 3 0 2 .8 3 0 2-.8 3 0 2 .8 3 0 2-.8 3 0 2 .8 3 0"
		/>
		<g class="ship">
			<path d="M1.75 9.5h12.5l-1.5 3h-9.5z" />
			<path d="M3.5 7h3v2.5h-3zM6.5 7h3v2.5h-3zM10.75 5v4.5h2V5z" />
		</g>
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

	.shipping {
		overflow: hidden;

		.water {
			opacity: 0.45;
		}

		.ship {
			stroke: var(--color-accent);
		}
	}

	.attention {
		fill: var(--color-accent);
		stroke: none;
	}

	@media (prefers-reduced-motion: no-preference) {
		.running {
			animation: spin 0.9s linear infinite;
		}

		.shipping {
			.water {
				animation: waves 0.6s linear infinite;
			}

			.ship {
				animation: bob 1.2s ease-in-out infinite;
			}
		}
	}

	@keyframes waves {
		to {
			translate: -6px 0;
		}
	}

	@keyframes bob {
		50% {
			translate: 0 -0.6px;
		}
	}

	@keyframes spin {
		to {
			rotate: 1turn;
		}
	}
</style>

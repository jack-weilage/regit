<script module lang="ts">
	export type CheckState = 'pending' | 'checking' | 'met' | 'unmet' | 'unverified';
</script>

<script lang="ts">
	import StatusIcon from '../StatusIcon.svelte';

	interface Props {
		checks: string[];
		states?: CheckState[];
	}

	let { checks, states = [] }: Props = $props();

	const labels: Record<CheckState, string> = {
		pending: 'Not checked yet',
		checking: 'Checking',
		met: 'Met',
		unmet: 'Not met',
		unverified: "Couldn't be checked"
	};
</script>

<ul>
	{#each checks as check, index (check)}
		{@const state = states[index] ?? 'pending'}
		<li class={state}>
			{#if state === 'checking'}
				<StatusIcon state="running" />
			{:else}
				<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
					<circle cx="8" cy="8" r="6.25" />
					{#if state === 'met'}<path d="m5.4 8.2 1.8 1.8 3.4-3.6" />{/if}
					{#if state === 'unmet'}<path d="m6 6 4 4m0-4-4 4" />{/if}
					{#if state === 'unverified'}<path d="M8 4.75v4M8 11.1v.15" />{/if}
				</svg>
			{/if}
			<span class="text">
				{check}
				{#if states.length}<span class="visually-hidden">({labels[state]})</span>{/if}
			</span>
		</li>
	{/each}
</ul>

<style>
	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		--icon-size: 1.25em;

		display: flex;
		align-items: baseline;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-5);
		border-radius: var(--radius);
		background: var(--color-surface);

		> :global(svg) {
			flex: none;
			translate: 0 calc((var(--icon-size) - 1cap) / 2);
		}
	}

	.met .text {
		color: var(--color-muted);
	}

	.mark {
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.met .mark {
		stroke: var(--color-accent);
	}

	.unmet .mark {
		stroke: var(--color-danger-text);
	}

	.unverified .mark path {
		stroke: var(--color-accent);
		stroke-width: 1.75;
	}

	.visually-hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>

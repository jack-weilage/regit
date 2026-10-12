<script lang="ts">
	interface Props {
		checks: string[];
	}

	let { checks }: Props = $props();
</script>

<ul>
	{#each checks as check (check)}
		<li>
			<svg class="mark" viewBox="0 0 16 16" aria-hidden="true"
				><circle cx="8" cy="8" r="6.25" /></svg
			>
			<span class="text">{check}</span>
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

	.mark {
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

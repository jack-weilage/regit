<script lang="ts">
	interface Props {
		checks: string[];
	}

	let { checks }: Props = $props();
</script>

<ul>
	{#each checks as check (check)}
		<li>
			<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.25" /></svg>
			{check}
		</li>
	{/each}
</ul>

<style>
	ul {
		display: grid;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-radius: var(--radius);
		background: var(--color-surface);
	}

	svg {
		--size: 1rem;

		flex: none;
		inline-size: var(--size);
		block-size: var(--size);
		translate: 0 calc((var(--size) - 1cap) / 2);
		fill: none;
		stroke: var(--color-muted);
		stroke-width: 1.5;
	}
</style>

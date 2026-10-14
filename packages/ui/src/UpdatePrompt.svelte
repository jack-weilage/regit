<script lang="ts">
	let { onrefresh }: { onrefresh: () => void } = $props();
</script>

<button class="pill" type="button" onclick={onrefresh}>
	<svg viewBox="0 0 16 16" aria-hidden="true">
		<path d="M13.2 5.5A5.5 5.5 0 1 0 13.5 8M13 2.5v3.5H9.5" />
	</svg>
	<span>New version available</span>
	<span class="action">Refresh</span>
</button>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-4);
		padding: 1em 1.35em;
		border: 0;
		border-radius: 999px;
		background: var(--color-fg);
		color: var(--color-bg);
		font: inherit;
		font-size: var(--text-meta);
		font-weight: 500;
		cursor: pointer;

		&:hover {
			background: color-mix(in oklab, var(--color-fg) 88%, var(--color-bg));
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 3px;
		}

		svg {
			inline-size: 1.1em;
			block-size: 1.1em;
			fill: none;
			stroke: currentColor;
			stroke-linecap: round;
			stroke-linejoin: round;
			stroke-width: 1.5;
		}
	}

	.action {
		color: light-dark(#fdba74, #c2410c);
		font-weight: 600;
	}
</style>

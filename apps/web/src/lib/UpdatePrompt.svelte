<script lang="ts">
	function refresh() {
		window.location.reload();
	}
</script>

<button class="prompt pill" type="button" onclick={refresh}>
	<svg viewBox="0 0 16 16" aria-hidden="true">
		<path d="M13.2 5.5A5.5 5.5 0 1 0 13.5 8M13 2.5v3.5H9.5" />
	</svg>
	<span>New version available</span>
	<span class="action">Refresh</span>
</button>

<style>
	.prompt {
		position: fixed;
		inset-block-end: calc(var(--space-7) + 2em);
		inset-inline-start: var(--space-7);
		z-index: 20;
		font: inherit;
		font-size: var(--text-meta);
		box-shadow: var(--shadow-floating);
	}

	button {
		border: 0;
		cursor: pointer;
		font: inherit;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 3px;
		}
	}

	.pill {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: 1em 1.35em;
		border-radius: 999px;
		background: var(--color-fg);
		color: var(--color-bg);
		font-weight: 500;

		&:hover {
			background: color-mix(in oklab, var(--color-fg) 88%, var(--color-bg));
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
		color: light-dark(#fdba74, #fb923c);
		font-weight: 600;
	}

	@media (max-width: 48rem) {
		.prompt {
			inset-block-end: calc(var(--space-7) + 6em);
		}
	}
</style>

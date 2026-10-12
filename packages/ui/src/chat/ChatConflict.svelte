<script lang="ts">
	import Button from '../Button.svelte';

	interface Props {
		headline: string;
		files: string[];
		updating?: boolean;
		onupdate?: () => void;
	}

	let { headline, files, updating = false, onupdate }: Props = $props();
</script>

<section class="conflict chat-enter" aria-label="Conflicts with main">
	<div class="layout">
		<svg class="mark" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 2.25 14.5 13.5h-13Z" />
			<path d="M8 6.5v3.25M8 11.75v.01" />
		</svg>
		<div class="body">
			<p class="title">Conflicts with main</p>
			<p class="detail"><code>{headline}</code> landed and changes the same lines in</p>
			<ul>
				{#each files as file (file)}<li><code>{file}</code></li>{/each}
			</ul>
		</div>
		{#if onupdate}
			<div class="action">
				<Button variant="primary" size="sm" disabled={updating} onclick={onupdate}
					>{updating ? 'Updating…' : 'Bring up to date'}</Button
				>
			</div>
		{/if}
	</div>
</section>

<style>
	.conflict {
		--icon-size: 1.1em;

		container-type: inline-size;
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-5);
		border: 1px solid color-mix(in oklab, var(--color-danger-text) 35%, var(--color-border));
		border-radius: var(--radius);
		font-size: var(--text-chat);
	}

	.layout {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: start;
		gap: var(--space-4);
	}

	.mark {
		inline-size: var(--icon-size);
		block-size: var(--icon-size);
		translate: 0 calc((var(--icon-size) - 1cap) / 2);
		fill: none;
		stroke: var(--color-danger-text);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.action {
		align-self: center;
	}

	@container (width < 30rem) {
		.layout {
			grid-template-columns: auto minmax(0, 1fr);
		}

		.action {
			grid-column: 2;
		}
	}

	.body {
		display: grid;
		gap: var(--space-2);
	}

	p,
	ul {
		margin: 0;
	}

	.title {
		font-weight: 600;
	}

	.detail {
		color: var(--color-muted);
	}

	ul {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		padding: 0;
		list-style: none;
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
		overflow-wrap: anywhere;
	}

	li code {
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius);
		background: var(--color-surface);
	}
</style>

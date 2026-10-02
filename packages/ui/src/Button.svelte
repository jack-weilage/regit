<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'quiet' | 'ghost';
		size?: 'md' | 'sm' | 'xs';
		icon?: boolean;
		element?: HTMLButtonElement;
	}

	let {
		variant = 'quiet',
		size = 'md',
		icon = false,
		element = $bindable(),
		type = 'button',
		children,
		...rest
	}: Props = $props();
</script>

<button bind:this={element} class={['button', variant, size, { icon }]} {type} {...rest}>
	{@render children?.()}
</button>

<style>
	.button {
		display: inline-flex;
		align-items: baseline;
		justify-content: center;
		gap: var(--space-3);
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		font: inherit;
		font-size: var(--text-chat);
		line-height: 1.5;
		cursor: pointer;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}

		&:disabled {
			cursor: not-allowed;
		}
	}

	.md {
		padding: 0.5em 1em;
	}

	.sm {
		padding: 0.3em 0.6em;
	}

	.xs {
		padding: 0.15em 0.5em;
		font-size: var(--text-meta);
	}

	.icon {
		padding: 0.45em;
	}

	.primary {
		background: var(--color-accent);
		color: var(--color-accent-fg);
		font-weight: 500;

		&:hover:not(:disabled) {
			background: color-mix(in oklab, var(--color-accent) 88%, var(--color-fg));
		}

		&:disabled {
			background: var(--color-surface);
			color: var(--color-muted);
		}
	}

	.quiet {
		color: var(--color-muted);
		font-weight: 500;
	}

	.quiet,
	.ghost {
		&:hover:not(:disabled) {
			background: var(--color-surface);
		}
	}
</style>

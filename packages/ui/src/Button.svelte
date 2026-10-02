<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'quiet' | 'ghost';
		size?: 'md' | 'sm' | 'xs';
		icon?: boolean;
	}

	let {
		variant = 'quiet',
		size = 'md',
		icon = false,
		type = 'button',
		children,
		...rest
	}: Props = $props();
</script>

<button class={['button', variant, size, { icon }]} {type} {...rest}>
	{@render children?.()}
</button>

<style>
	.button {
		display: inline-flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.375rem;
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
		padding: 0.375rem 0.875rem;
	}

	.sm {
		padding: 0.25rem 0.625rem;
	}

	.xs {
		padding: 0.125rem 0.375rem;
		font-size: var(--text-meta);
	}

	.icon {
		padding: 0.375rem;
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

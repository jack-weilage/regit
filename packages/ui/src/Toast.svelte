<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	interface Props {
		action?: { label: string; onclick: () => void };
		duration?: number;
		ondismiss: () => void;
		children: Snippet;
	}

	let { action, duration = 8000, ondismiss, children }: Props = $props();

	const expire: Attachment = () => {
		const timer = setTimeout(ondismiss, duration);
		return () => clearTimeout(timer);
	};
</script>

<div class="toast" role="status" {@attach expire}>
	<span class="message">{@render children()}</span>
	{#if action}
		<button
			type="button"
			onclick={() => {
				action.onclick();
				ondismiss();
			}}>{action.label}</button
		>
	{/if}
</div>

<style>
	.toast {
		position: fixed;
		inset-block-end: var(--space-7);
		inset-inline-start: 50%;
		z-index: 10;
		display: flex;
		align-items: center;
		gap: var(--space-5);
		box-sizing: border-box;
		max-inline-size: calc(100% - 2rem);
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
		border-radius: 999px;
		background: var(--color-fg);
		color: var(--color-bg);
		box-shadow: var(--shadow-floating);
		font-size: var(--text-meta);
		translate: -50% 0;
	}

	.message {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		:global(code) {
			font-family: var(--font-mono);
		}
	}

	button {
		flex: none;
		padding: 0.2em 0.6em;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: light-dark(#fdba74, #c2410c);
		font: inherit;
		font-weight: 600;
		cursor: pointer;

		&:hover {
			background: color-mix(in oklab, var(--color-bg) 15%, transparent);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.toast {
			transition:
				opacity 0.2s,
				translate 0.2s;

			@starting-style {
				opacity: 0;
				translate: -50% 0.5rem;
			}
		}
	}
</style>

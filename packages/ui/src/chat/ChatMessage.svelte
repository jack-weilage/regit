<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="message chat-enter">
	{@render children()}
</div>

<style>
	.message {
		max-inline-size: 100%;
		font-size: var(--text-chat);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	@container style(--chat-role: person) or style(--chat-role: own) {
		.message {
			--tight: 0.25rem;

			padding: 0.5rem 0.875rem;
			border-radius: 0.875rem;
			background: var(--color-surface);
		}
	}

	@container style(--chat-role: person) {
		.message {
			border-start-start-radius: var(--tight);

			&:not(:last-child) {
				border-end-start-radius: var(--tight);
			}
		}
	}

	@container style(--chat-role: own) {
		.message {
			max-inline-size: min(36rem, 85%);
			border-start-end-radius: var(--tight);

			&:not(:last-child) {
				border-end-end-radius: var(--tight);
			}
		}
	}

	.message :global {
		> * {
			margin-block: 0;
		}

		> * + * {
			margin-block-start: 0.625em;
		}

		code,
		pre {
			font-family: var(--font-mono);
			background: color-mix(in oklab, currentColor 7%, transparent);
		}

		code {
			padding: 0.1em 0.3em;
			border-radius: 0.25rem;
			font-size: 0.875em;
		}

		pre {
			padding: 0.75rem;
			overflow-x: auto;
			border-radius: var(--radius);
			font-size: var(--text-meta);
			line-height: 1.6;
			tab-size: 2;

			code {
				padding: 0;
				background: none;
				font-size: inherit;
			}
		}
	}
</style>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import StatusIcon from '../StatusIcon.svelte';

	interface Props {
		steering?: boolean;
		pending?: boolean;
		children: Snippet;
	}

	let { steering = false, pending = false, children }: Props = $props();
</script>

<div class={['message', 'chat-enter', { steering }]}>
	{@render children()}
</div>
{#if steering && pending}
	<p class="pending"><StatusIcon state="running" />Steering</p>
{/if}

<style>
	.message {
		max-inline-size: 100%;
		font-size: var(--text-chat);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	@container style(--chat-role: person) or style(--chat-role: own) {
		.message {
			--tight: 0.3em;

			padding: 0.6em 0.9em;
			border-radius: 1.1em;
			background: var(--color-surface);
		}
	}

	@container style(--chat-role: person) {
		.message {
			border-start-start-radius: var(--tight);

			&:not(:last-of-type) {
				border-end-start-radius: var(--tight);
			}
		}
	}

	@container style(--chat-role: own) {
		.message {
			max-inline-size: min(36rem, 85%);
			border-start-end-radius: var(--tight);

			&:not(:last-of-type) {
				border-end-end-radius: var(--tight);
			}
		}
	}

	.steering {
		outline: 1px dashed color-mix(in oklab, var(--color-accent) 60%, var(--color-border));
		outline-offset: -1px;
	}

	@container style(--chat-role: person) or style(--chat-role: own) {
		.steering {
			background: none;
		}
	}

	.pending {
		--icon-size: 1em;

		display: inline-flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
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
			border-radius: 0.3em;
			font-size: 0.875em;
		}

		pre {
			padding: var(--space-5);
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

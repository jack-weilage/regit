<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';

	interface Props {
		label: string;
		children: Snippet;
	}

	let { label, children }: Props = $props();

	const enableEntrances: Attachment<HTMLElement> = (log) => {
		let frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => log.style.setProperty('--chat-ready', '1'));
		});
		return () => cancelAnimationFrame(frame);
	};
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="log" role="log" aria-label={label} tabindex="0" {@attach enableEntrances}>
	<div class="content">
		{@render children()}
	</div>
</div>

<style>
	.log {
		container: chat / inline-size;
		display: flex;
		flex-direction: column-reverse;
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -2px;
		}
	}

	.content {
		display: flex;
		flex-direction: column;
		gap: var(--space-7);
		padding: var(--space-6);
	}
</style>

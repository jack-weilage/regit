<script lang="ts">
	import Button from '../Button.svelte';
	import ChatDiff from './ChatDiff.svelte';
	import type { DiffFile } from './types.ts';

	interface Props {
		files: DiffFile[];
		embedded?: boolean;
		onclose?: () => void;
	}

	let { files, embedded = false, onclose }: Props = $props();

	const id = $props.id();

	let additions = $derived(files.reduce((sum, file) => sum + file.additions, 0));
	let deletions = $derived(files.reduce((sum, file) => sum + file.deletions, 0));
</script>

<section class="panel" aria-labelledby="{id}-title">
	<header class={{ hidden: embedded && !files.length }}>
		<div class="title">
			<h2 id="{id}-title" class={{ hidden: embedded }}>Changes</h2>
			<p class="summary">
				{files.length}
				{files.length === 1 ? 'file' : 'files'}
				<span class="added">+{additions}</span>
				<span class="removed">−{deletions}</span>
			</p>
		</div>
		{#if onclose}
			<Button variant="ghost" size="sm" icon aria-label="Close changes" onclick={onclose}>
				<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
			</Button>
		{/if}
	</header>
	<div class="body">
		{#if files.length}
			<ChatDiff {files} />
		{:else}
			<p class="empty">No changes yet.</p>
		{/if}
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		block-size: 100%;
		min-inline-size: 0;
		background: var(--color-bg);
		font-size: var(--text-chat);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		padding: var(--space-5) var(--space-5) var(--space-5) var(--space-6);
		border-block-end: 1px solid var(--color-border);

		svg {
			inline-size: 1.1em;
			block-size: 1.1em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
			stroke-linecap: round;
		}
	}

	.title {
		display: grid;
		flex: 1;
		gap: var(--space-1);
		min-inline-size: 0;
	}

	h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.summary {
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);

		span {
			font-family: var(--font-mono);
		}
	}

	.added {
		color: var(--color-added);
	}

	.removed {
		color: var(--color-removed);
	}

	.hidden {
		position: absolute;
		inline-size: 1px;
		block-size: 1px;
		overflow: hidden;
		clip-path: inset(50%);
	}

	.empty {
		margin: 0;
		color: var(--color-muted);
	}

	.body {
		flex: 1;
		min-block-size: 0;
		padding: var(--space-5) var(--space-6) var(--space-7);
		overflow-y: auto;
	}
</style>

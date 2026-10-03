<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Button from '../Button.svelte';

	interface Props {
		open?: boolean;
		headline: string;
		messages: number;
		checkpoints: number;
		running?: boolean;
		shipped?: { sha: string };
		restoreDays?: number;
		onconfirm: () => void;
	}

	let {
		open = $bindable(false),
		headline,
		messages,
		checkpoints,
		running = false,
		shipped,
		restoreDays = 7,
		onconfirm
	}: Props = $props();

	const id = $props.id();

	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

	const sync: Attachment<HTMLDialogElement> = (dialog) => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	};

	function confirm() {
		open = false;
		onconfirm();
	}
</script>

<dialog
	{@attach sync}
	class="dialog"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(event) => event.target === event.currentTarget && (open = false)}
>
	<h2 id="{id}-title">{shipped ? 'Delete this conversation?' : 'Delete this thread?'}</h2>
	{#if shipped}
		<p>
			<code>{headline}</code> shipped in <code>{shipped.sha.slice(0, 7)}</code>. Its record stays so
			history still makes sense:
		</p>
		<ul>
			<li>Removed: the conversation and the agent's branch</li>
			<li class="kept">Kept: the headline, who shipped it, and the commit</li>
		</ul>
	{:else}
		<p><code>{headline}</code> and everything ReGit made for it will be removed:</p>
		<ul>
			<li>The conversation{messages ? `, ${plural(messages, 'message')}` : ''}</li>
			{#if checkpoints}
				<li>The agent's branch, {plural(checkpoints, 'checkpoint')}</li>
			{/if}
			{#if running}
				<li>The running attempt, which stops now</li>
			{/if}
		</ul>
	{/if}
	<p class="hint">You can restore it for {plural(restoreDays, 'day')}.</p>
	<div class="buttons">
		<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
		<Button variant="danger" onclick={confirm}>
			{shipped ? 'Delete conversation' : 'Delete thread'}
		</Button>
	</div>
</dialog>

<style>
	.dialog {
		box-sizing: border-box;
		inline-size: min(26rem, calc(100% - 2rem));
		padding: var(--space-7);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-floating);
		color: var(--color-fg);
		font-size: var(--text-chat);
		line-height: 1.5;

		&[open] {
			display: grid;
			gap: var(--space-5);
		}

		&::backdrop {
			background: color-mix(in oklab, var(--color-bg) 55%, transparent);
			backdrop-filter: blur(2px);
		}
	}

	h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	p {
		margin: 0;
		overflow-wrap: anywhere;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}

	ul {
		display: grid;
		gap: var(--space-3);
		margin: 0;
		padding: var(--space-5) var(--space-6);
		border-radius: var(--radius);
		background: var(--color-surface);
		list-style: none;

		li::before {
			content: '–';
			margin-inline-end: var(--space-4);
			color: var(--color-muted);
		}
	}

	.kept,
	.hint {
		color: var(--color-muted);
	}

	.hint {
		font-size: var(--text-meta);
	}

	.buttons {
		display: flex;
		justify-content: end;
		gap: var(--space-3);
	}

	@media (prefers-reduced-motion: no-preference) {
		.dialog[open] {
			transition:
				opacity 0.15s,
				scale 0.15s;

			@starting-style {
				opacity: 0;
				scale: 0.98;
			}
		}
	}
</style>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Button from '../Button.svelte';
	import StatusIcon from '../StatusIcon.svelte';

	interface Props {
		open?: boolean;
		repo: string;
		base?: string;
		headline: string;
		body: string;
		files: number;
		additions: number;
		deletions: number;
		review: { verdict: 'pass' | 'fail' | 'needs-human'; met: number; total: number } | null;
		behind?: number;
		onship: (message: { title: string; body: string }) => void;
	}

	let {
		open = $bindable(false),
		repo,
		base = 'main',
		headline,
		body,
		files,
		additions,
		deletions,
		review,
		behind = 0,
		onship
	}: Props = $props();

	const id = $props.id();

	let title = $state('');
	let message = $state('');

	let passed = $derived(review?.verdict === 'pass');

	const sync: Attachment<HTMLDialogElement> = (dialog) => {
		if (open && !dialog.open) {
			title = headline;
			message = body;
			dialog.showModal();
		}
		if (!open && dialog.open) dialog.close();
	};

	function ship(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim()) return;
		open = false;
		onship({ title: title.trim(), body: message.trim() });
	}

	const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
</script>

<dialog
	{@attach sync}
	class="dialog"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(event) => event.target === event.currentTarget && (open = false)}
>
	<form onsubmit={ship}>
		<h2 id="{id}-title">Ship to <code>{base}</code>?</h2>
		<p class="target">
			<code>{repo}</code> · {plural(files, 'file')}
			<span class="added">+{additions}</span>
			<span class="removed">−{deletions}</span>
		</p>

		<ul class="facts">
			<li>
				<StatusIcon state={passed ? 'passed' : 'attention'} />
				<span>
					{#if review}{review.met}/{review.total} checks met{:else}Not reviewed{/if}
				</span>
			</li>
			{#if behind}
				<li>
					<StatusIcon state="shipping" />
					<span>
						<code>{base}</code> has {plural(behind, 'new commit')}
					</span>
				</li>
			{/if}
		</ul>

		<div class="field">
			<span>Commit message</span>
			<input bind:value={title} required aria-label="Commit title" />
			<textarea bind:value={message} rows="4" aria-label="Commit description"></textarea>
		</div>

		<div class="buttons">
			<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button type="submit" variant="primary">{passed ? 'Ship' : 'Ship anyway'}</Button>
		</div>
	</form>
</dialog>

<style>
	.dialog {
		box-sizing: border-box;
		inline-size: min(32rem, calc(100% - 2rem));
		padding: var(--space-7);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-floating);
		color: var(--color-fg);
		font-size: var(--text-chat);
		line-height: 1.5;

		&::backdrop {
			background: color-mix(in oklab, var(--color-bg) 55%, transparent);
			backdrop-filter: blur(2px);
		}
	}

	form {
		display: grid;
		gap: var(--space-5);
	}

	h2 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	p {
		margin: 0;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}

	.target {
		margin-block-start: calc(-1 * var(--space-3));
		color: var(--color-muted);

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

	.facts {
		display: grid;
		gap: var(--space-4);
		margin: 0;
		padding: var(--space-5) var(--space-6);
		border-radius: var(--radius);
		background: var(--color-surface);
		list-style: none;

		li {
			display: flex;
			align-items: baseline;
			gap: var(--space-4);

			:global(svg) {
				flex: none;
				inline-size: 1em;
				block-size: 1em;
				translate: 0 0.15em;
			}
		}
	}

	.field {
		display: grid;
		gap: var(--space-3);

		span {
			color: var(--color-muted);
			font-size: var(--text-meta);
			font-weight: 600;
		}
	}

	input,
	textarea {
		box-sizing: border-box;
		inline-size: 100%;
		padding: var(--space-4) var(--space-5);
		border: 1px solid var(--color-border);
		border-radius: var(--radius);
		background: var(--color-bg);
		color: inherit;
		font: inherit;

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: -1px;
		}
	}

	input {
		font-family: var(--font-mono);
	}

	textarea {
		field-sizing: content;
		min-block-size: 4lh;
		max-block-size: 10lh;
		resize: none;
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

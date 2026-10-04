<script module lang="ts">
	export interface GitTokenView {
		id: string;
		label: string;
		scope: 'read' | 'write';
		expiresAt: number;
		lastUsedAt: number | null;
	}
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Button from './Button.svelte';
	import { formatAgo, formatDate } from './chat/format.ts';

	interface Props {
		open?: boolean;
		repo: string;
		url: string;
		tokens: GitTokenView[];
		created?: { label: string; secret: string } | null;
		now?: number;
		oncreate: (token: { label: string; scope: 'read' | 'write'; days: number }) => void;
		onrevoke: (id: string) => void;
	}

	let {
		open = $bindable(false),
		repo,
		url,
		tokens,
		created = null,
		now,
		oncreate,
		onrevoke
	}: Props = $props();

	const id = $props.id();
	let label = $state('');
	let scope = $state<'read' | 'write'>('write');
	let days = $state(90);
	let copied = $state<string | null>(null);

	let time = $derived(now ?? Date.now());

	const sync: Attachment<HTMLDialogElement> = (dialog) => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	};

	async function copy(text: string) {
		await navigator.clipboard?.writeText(text);
		copied = text;
	}

	function create(event: SubmitEvent) {
		event.preventDefault();
		oncreate({ label: label.trim() || 'Access token', scope, days });
		label = '';
	}
</script>

<dialog
	{@attach sync}
	class="dialog"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(event) => event.target === event.currentTarget && (open = false)}
>
	<h2 id="{id}-title">Clone {repo}</h2>
	<div class="command">
		<code>git clone {url}</code>
		<Button size="sm" variant="ghost" onclick={() => copy(`git clone ${url}`)}>
			{copied === `git clone ${url}` ? 'Copied' : 'Copy'}
		</Button>
	</div>
	<p class="hint">Use an access token as the password.</p>

	{#if created}
		<div class="created" role="status">
			<p>New token · {created.label}</p>
			<div class="command">
				<code>{created.secret}</code>
				<Button size="sm" variant="ghost" onclick={() => copy(created.secret)}>
					{copied === created.secret ? 'Copied' : 'Copy'}
				</Button>
			</div>
			<p class="hint">Shown once.</p>
		</div>
	{/if}

	{#if tokens.length}
		<ul aria-label="Access tokens">
			{#each tokens as token (token.id)}
				<li>
					<span class="token">
						<span>{token.label}</span>
						<span class="hint">
							{token.scope === 'write' ? 'Read and write' : 'Read'} ·
							{token.expiresAt <= time ? 'expired' : `expires ${formatDate(token.expiresAt)}`} ·
							{token.lastUsedAt ? `used ${formatAgo(token.lastUsedAt, time)}` : 'never used'}
						</span>
					</span>
					<Button
						size="xs"
						variant="ghost"
						aria-label="Revoke {token.label}"
						onclick={() => onrevoke(token.id)}
					>
						Revoke
					</Button>
				</li>
			{/each}
		</ul>
	{/if}

	<form class="new" onsubmit={create}>
		<input aria-label="Token name" placeholder="Laptop" bind:value={label} />
		<select aria-label="Access" bind:value={scope}>
			<option value="write">Read and write</option>
			<option value="read">Read</option>
		</select>
		<select aria-label="Expires after" bind:value={days}>
			<option value={30}>30 days</option>
			<option value={90}>90 days</option>
			<option value={365}>1 year</option>
		</select>
		<Button type="submit" size="sm">Create token</Button>
	</form>

	<div class="buttons">
		<Button variant="ghost" onclick={() => (open = false)}>Done</Button>
	</div>
</dialog>

<style>
	.dialog {
		box-sizing: border-box;
		inline-size: min(34rem, calc(100% - 2rem));
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
	}

	.hint {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.command {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-5);
		border-radius: var(--radius);
		background: var(--color-surface);

		code {
			flex: 1;
			min-inline-size: 0;
			overflow-wrap: anywhere;
			font-family: var(--font-mono);
			font-size: var(--text-meta);
		}
	}

	.created {
		display: grid;
		gap: var(--space-3);
	}

	ul {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;

		li {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: var(--space-4);
			padding-block: var(--space-2);
		}
	}

	.token {
		display: grid;
		min-inline-size: 0;
	}

	.new {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);

		input {
			flex: 1;
			min-inline-size: 8rem;
		}

		input,
		select {
			padding: 0.35em 0.6em;
			border: 1px solid var(--color-border);
			border-radius: var(--radius);
			background: var(--color-bg);
			color: inherit;
			font: inherit;
			font-size: var(--text-meta);

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: -1px;
			}
		}
	}

	.buttons {
		display: flex;
		justify-content: end;
	}
</style>

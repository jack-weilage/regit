<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { machines, type DeploySecret, type Machine } from '@regit/core';
	import Button from './Button.svelte';
	import { useFormat } from './chat/format.ts';

	interface Props {
		open?: boolean;
		repo: string;
		secrets: DeploySecret[];
		machine: Machine;
		now?: number;
		onmachine: (machine: Machine) => void;
		onsave: (secret: { name: string; value: string }) => Promise<unknown>;
		onremove: (name: string) => void;
	}

	let {
		open = $bindable(false),
		repo,
		secrets,
		machine,
		now,
		onmachine,
		onsave,
		onremove
	}: Props = $props();

	const format = useFormat();

	const id = $props.id();
	let name = $state('');
	let value = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let nameInput = $state<HTMLInputElement>();

	let time = $derived(now ?? Date.now());

	const sync: Attachment<HTMLDialogElement> = (dialog) => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	};

	async function save(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = null;
		try {
			await onsave({ name: name.trim(), value });
			name = '';
			value = '';
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
		} finally {
			busy = false;
		}
	}
</script>

<dialog
	{@attach sync}
	class="dialog"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(event) => event.target === event.currentTarget && (open = false)}
>
	<h2 id="{id}-title">Deploys for {repo}</h2>

	<label class="machine">
		<span>Machine for deploy checks and deploys</span>
		<select value={machine} onchange={(event) => onmachine(event.currentTarget.value as Machine)}>
			{#each Object.entries(machines) as [option, { vcpu, memoryGib, diskGb }] (option)}
				<option value={option}
					>{vcpu === 0.5 ? '½' : vcpu} vCPU · {memoryGib} GiB · {diskGb} GB disk</option
				>
			{/each}
		</select>
		<span class="hint">Takes effect the next time the deploy sandbox starts.</span>
	</label>

	<h3>Secrets</h3>
	<p class="hint">
		<code>.agents/deploy</code> gets these as environment variables when main's deploy checks pass. Agents
		never see them, and values can't be read back.
	</p>

	{#if secrets.length}
		<ul aria-label="Deploy secrets">
			{#each secrets as secret (secret.name)}
				<li>
					<span class="secret">
						<code>{secret.name}</code>
						<span class="hint">set by {secret.updatedBy} {format.ago(secret.updatedAt, time)}</span>
					</span>
					<span class="actions">
						<Button
							size="xs"
							variant="ghost"
							aria-label="Replace {secret.name}"
							onclick={() => {
								name = secret.name;
								value = '';
								nameInput?.focus();
							}}>Replace</Button
						>
						<Button
							size="xs"
							variant="ghost"
							aria-label="Remove {secret.name}"
							onclick={() => onremove(secret.name)}>Remove</Button
						>
					</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="hint">No secrets yet.</p>
	{/if}

	<form class="new" onsubmit={save}>
		<input
			bind:this={nameInput}
			aria-label="Secret name"
			placeholder="CLOUDFLARE_API_TOKEN"
			required
			pattern="[A-Z_][A-Z0-9_]*"
			maxlength="128"
			autocomplete="off"
			spellcheck="false"
			bind:value={name}
		/>
		<textarea
			aria-label="Secret value"
			placeholder="Value"
			required
			rows="2"
			autocomplete="off"
			spellcheck="false"
			bind:value></textarea>
		<Button type="submit" size="sm" disabled={busy}>Save secret</Button>
	</form>
	{#if error}<p class="error" role="alert">{error}</p>{/if}

	<div class="buttons">
		<Button variant="ghost" onclick={() => (open = false)}>Done</Button>
	</div>
</dialog>

<style>
	.dialog {
		container-type: inline-size;
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

	h2,
	h3 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	h3 {
		font-size: inherit;
	}

	.machine {
		display: grid;
		gap: var(--space-2);

		select {
			justify-self: start;
			max-inline-size: 100%;
			padding: 0.35em 0.6em;
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
	}

	p {
		margin: 0;
	}

	.hint {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	code {
		font-family: var(--font-mono);
		font-size: var(--text-meta);
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

	.secret {
		display: grid;
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex: none;
		gap: var(--space-2);
	}

	.new {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: var(--space-3);

		textarea {
			grid-column: 1;
			resize: vertical;
		}

		:global(button) {
			grid-column: 2;
			grid-row: 1 / 3;
			align-self: end;
		}

		input,
		textarea {
			box-sizing: border-box;
			min-inline-size: 0;
			padding: 0.35em 0.6em;
			border: 1px solid var(--color-border);
			border-radius: var(--radius);
			background: var(--color-bg);
			color: inherit;
			font: inherit;
			font-family: var(--font-mono);
			font-size: var(--text-meta);

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: -1px;
			}
		}
	}

	.error {
		color: var(--color-danger-text);
		font-size: var(--text-meta);
	}

	.buttons {
		display: flex;
		justify-content: end;
	}

	@container (width < 24rem) {
		.new {
			grid-template-columns: minmax(0, 1fr);

			:global(button) {
				grid-column: 1;
				grid-row: auto;
				justify-self: end;
			}
		}
	}
</style>

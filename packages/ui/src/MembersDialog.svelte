<script module lang="ts">
	export type MemberRole = 'owner' | 'editor' | 'viewer';

	export interface MemberView {
		id: string;
		label: string;
		role: MemberRole;
		you?: boolean;
	}
</script>

<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import Button from './Button.svelte';

	interface Props {
		open?: boolean;
		repo: string;
		members: MemberView[];
		onadd: (member: { id: string; role: MemberRole }) => Promise<unknown>;
		onremove: (id: string) => Promise<unknown>;
	}

	let { open = $bindable(false), repo, members, onadd, onremove }: Props = $props();

	const roles: Record<MemberRole, string> = {
		owner: 'Owner',
		editor: 'Editor',
		viewer: 'Viewer'
	};

	const id = $props.id();
	let principal = $state('');
	let role = $state<MemberRole>('editor');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const sync: Attachment<HTMLDialogElement> = (dialog) => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	};

	async function attempt(action: () => Promise<unknown>) {
		busy = true;
		error = null;
		try {
			await action();
			return true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : String(cause);
			return false;
		} finally {
			busy = false;
		}
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		if (await attempt(() => onadd({ id: principal.trim(), role }))) principal = '';
	}
</script>

<dialog
	{@attach sync}
	class="dialog"
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(event) => event.target === event.currentTarget && (open = false)}
>
	<h2 id="{id}-title">Members of {repo}</h2>
	<p class="hint">Owners manage members and deploys and can ship; editors run threads.</p>

	<ul aria-label="Members">
		{#each members as member (member.id)}
			<li>
				<span class="member" title={member.id}>
					<code>{member.label}</code>
					{#if member.you}<span class="hint">You</span>{/if}
				</span>
				<span class="actions">
					<span class="role">{roles[member.role]}</span>
					{#if !member.you}
						<Button
							size="xs"
							variant="ghost"
							disabled={busy}
							aria-label="Remove {member.label}"
							onclick={() => attempt(() => onremove(member.id))}>Remove</Button
						>
					{/if}
				</span>
			</li>
		{/each}
	</ul>

	<form class="new" onsubmit={add}>
		<input
			aria-label="Access user ID"
			placeholder="Access user ID"
			required
			maxlength="1024"
			autocomplete="off"
			spellcheck="false"
			bind:value={principal}
		/>
		<select aria-label="Role" bind:value={role}>
			{#each Object.entries(roles) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</select>
		<Button type="submit" size="sm" disabled={busy}>Add member</Button>
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

	.member {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		min-inline-size: 0;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-3);
	}

	.role {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.new {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: var(--space-3);

		input,
		select {
			box-sizing: border-box;
			min-inline-size: 0;
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

		input {
			font-family: var(--font-mono);
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
			grid-template-columns: minmax(0, 1fr) auto;

			input {
				grid-column: 1 / -1;
			}
		}
	}
</style>

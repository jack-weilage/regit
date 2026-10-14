<script lang="ts">
	import type { Snippet } from 'svelte';
	import Avatar from './Avatar.svelte';
	import Button from './Button.svelte';
	import MainStatusView from './MainStatus.svelte';
	import Menu from './Menu.svelte';
	import NewRepoPalette, { type NewRepo } from './NewRepoPalette.svelte';
	import type { MainStatus, Machine } from '@regit/core';
	import NewThreadPalette, { type Mode } from './chat/NewThreadPalette.svelte';
	import ThreadIcon from './chat/ThreadIcon.svelte';
	import ThreadList, { type ThreadListItem } from './chat/ThreadList.svelte';
	import type { Mentionable, SimilarThread } from './chat/types.ts';

	interface Props {
		repo: string;
		repos?: string[];
		threads: ThreadListItem[];
		current?: string;
		account?: { name: string; email: string; avatar?: string };
		mode?: Mode;
		machine?: Machine;
		similar?: SimilarThread[];
		size?: Exclude<Mode, 'auto'>;
		main?: MainStatus | null;
		now?: number;
		onswitchrepo?: (repo: string) => void;
		oncreaterepo?: (repo: NewRepo) => Promise<void>;
		onclone?: () => void;
		ondeploys?: () => void;
		onquery?: (text: string) => void;
		onstart: (thread: { text: string; mode: Mode; machine: Machine }) => void;
		onopenthread?: (thread: Mentionable) => void;
		children: Snippet;
	}

	let {
		repo,
		repos = [repo],
		threads,
		current,
		account,
		mode = $bindable('medium'),
		machine = $bindable('standard-1'),
		similar,
		size,
		main,
		now,
		onswitchrepo,
		oncreaterepo,
		onclone,
		ondeploys,
		onquery,
		onstart,
		onopenthread,
		children
	}: Props = $props();

	const id = $props.id();

	let open = $state(false);
	const threadHref = (id: string) => threads.find((thread) => thread.id === id)?.href;
</script>

<div class={['shell', { open }]}>
	<aside id="{id}-sidebar" class="sidebar" aria-label="Navigation">
		<div class="top">
			<Menu
				label="Repositories"
				align="start"
				items={[
					...repos.map((name) => ({
						label: name,
						checked: name === repo,
						onselect: () => onswitchrepo?.(name)
					})),
					...(onclone ? [{ label: 'Clone…', separated: true, onselect: onclone }] : []),
					...(ondeploys ? [{ label: 'Deploys…', separated: !onclone, onselect: ondeploys }] : []),
					...(oncreaterepo
						? [
								{
									label: 'New repository…',
									separated: !onclone && !ondeploys,
									onselect: () => document.getElementById(`${id}-new-repo`)?.showPopover()
								}
							]
						: [])
				]}
			>
				{#snippet trigger(props)}
					<button type="button" class="switcher" aria-label="Repository: {repo}" {...props}>
						<span class="name">{repo}</span>
						<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg>
					</button>
				{/snippet}
			</Menu>
			<Button variant="primary" icon aria-label="New thread" popovertarget="{id}-new-thread">
				<ThreadIcon plus />
			</Button>
		</div>

		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="list"
			onclick={(event) => (event.target as HTMLElement).closest('a') && (open = false)}
		>
			<ThreadList {threads} {current} {now} newThread="{id}-new-thread" />
		</div>

		{#if main}
			<MainStatusView {main} {threadHref} {now} />
		{/if}

		{#if account}
			<div class="account">
				<Avatar name={account.name} src={account.avatar} />
				<span>{account.email}</span>
			</div>
		{/if}
	</aside>

	<button
		type="button"
		class="backdrop"
		aria-label="Close navigation"
		tabindex="-1"
		onclick={() => (open = false)}
	></button>

	<main class="main">
		<button
			type="button"
			class="toggle"
			aria-controls="{id}-sidebar"
			aria-expanded={open}
			onclick={() => (open = !open)}
		>
			<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
			Threads
		</button>
		{@render children()}
	</main>

	<NewThreadPalette
		id="{id}-new-thread"
		{repo}
		bind:mode
		bind:machine
		{similar}
		{size}
		{onquery}
		onstart={(thread) => {
			open = false;
			onstart(thread);
		}}
		{onopenthread}
	/>
	{#if oncreaterepo}
		<NewRepoPalette id="{id}-new-repo" {repos} oncreate={oncreaterepo} />
	{/if}
</div>

<style>
	.shell {
		container: shell / inline-size;
		position: relative;
		display: grid;
		grid-template-columns: 17rem minmax(0, 1fr);
		block-size: 100%;
		overflow: hidden;
		font-size: var(--text-chat);
	}

	.sidebar {
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto auto;
		grid-template-columns: minmax(0, 1fr);
		min-inline-size: 0;
		border-inline-end: 1px solid var(--color-border);
		background: color-mix(in oklab, var(--color-surface) 40%, var(--color-bg));
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-3);
	}

	.switcher {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		min-inline-size: 0;
		padding: 0.3em 0.5em;
		border: 0;
		border-radius: var(--radius);
		background: none;
		color: inherit;
		font: inherit;
		font-family: var(--font-mono);
		font-weight: 600;
		cursor: pointer;

		&:hover {
			background: var(--color-surface);
		}

		&:focus-visible {
			outline: 2px solid var(--color-accent);
			outline-offset: 2px;
		}

		.name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		svg {
			flex: none;
			inline-size: 1em;
			block-size: 1em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.5;
		}
	}

	.list {
		overflow-y: auto;
		padding: var(--space-2) var(--space-3);
	}

	.account {
		--avatar-size: 1.6em;

		display: flex;
		align-items: center;
		gap: var(--space-3);
		min-inline-size: 0;
		padding: var(--space-4) var(--space-5);
		border-block-start: 1px solid var(--color-border);
		color: var(--color-muted);
		font-size: var(--text-meta);

		span {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}

	.main {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;

		> :global(:last-child) {
			flex: 1;
			min-block-size: 0;
		}
	}

	.toggle,
	.backdrop {
		display: none;
	}

	@container shell (width < 48rem) {
		.main {
			grid-column: 1 / -1;
		}

		.sidebar {
			position: absolute;
			inset-block: 0;
			inset-inline-start: 0;
			z-index: 2;
			inline-size: min(17rem, 85%);
			box-shadow: var(--shadow-floating);
			translate: -105% 0;
			visibility: hidden;
			transition:
				translate 0.2s,
				visibility 0.2s;
		}

		.open .sidebar {
			translate: 0;
			visibility: visible;
		}

		.backdrop {
			position: absolute;
			inset: 0;
			z-index: 1;
			display: block;
			border: 0;
			background: color-mix(in oklab, var(--color-bg) 55%, transparent);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.2s;
		}

		.open .backdrop {
			opacity: 1;
			pointer-events: auto;
		}

		.toggle {
			display: inline-flex;
			align-items: center;
			gap: var(--space-2);
			align-self: start;
			margin: var(--space-3) var(--space-4) 0;
			padding: 0.3em 0.6em;
			border: 1px solid var(--color-border);
			border-radius: var(--radius);
			background: var(--color-bg);
			color: var(--color-muted);
			font: inherit;
			font-size: var(--text-meta);
			cursor: pointer;

			svg {
				inline-size: 1.1em;
				block-size: 1.1em;
				fill: none;
				stroke: currentColor;
				stroke-width: 1.5;
				stroke-linecap: round;
			}
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.sidebar,
		.backdrop {
			transition: none;
		}
	}
</style>

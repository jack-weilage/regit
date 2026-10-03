<script module lang="ts">
	import { repoNamePattern, repoNameRule } from '@regit/core';

	export interface NewRepo {
		name: string;
		source?: string;
	}

	interface Source {
		url: string;
		label: string;
		name: string;
	}

	type Option =
		| { kind: 'create'; name: string }
		| { kind: 'import'; name: string; source: Source }
		| { kind: 'rename'; source: Source };

	function parseSource(text: string): Source | null {
		const url = /^https?:\/\//i.test(text)
			? text
			: /^[\w-]+(\.[\w-]+)+\/\S+$/.test(text)
				? `https://${text}`
				: null;
		if (!url || !URL.canParse(url)) return null;
		const label = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
		if (!label) return null;
		return { url, label, name: suggestName(label.split('/').at(-1)!) };
	}

	function suggestName(text: string) {
		return text
			.replace(/[^A-Za-z0-9._-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^-|-$/g, '');
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import StatusIcon from './StatusIcon.svelte';

	interface Props {
		id: string;
		repos?: string[];
		oncreate: (repo: NewRepo) => Promise<void>;
	}

	let { id, repos = [], oncreate }: Props = $props();

	let text = $state('');
	let renaming = $state<Source | null>(null);
	let active = $state(0);
	let busy = $state<{ verb: string; label: string } | null>(null);
	let failure = $state('');
	let palette: HTMLElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();

	let source = $derived(renaming ?? parseSource(text.trim()));
	let name = $derived(renaming || !source ? text.trim() : source.name);
	let problem = $derived(
		!name
			? ''
			: !repoNamePattern.test(name)
				? repoNameRule
				: repos.includes(name)
					? `${name} already exists.`
					: ''
	);
	let options = $derived.by<Option[]>(() => {
		const valid = name && !problem;
		if (!source) return valid ? [{ kind: 'create', name }] : [];
		return [
			...(valid ? [{ kind: 'import' as const, name, source }] : []),
			...(renaming ? [] : [{ kind: 'rename' as const, source }])
		];
	});

	function reset() {
		text = '';
		renaming = null;
		failure = '';
		active = 0;
	}

	async function choose(option: Option | undefined) {
		if (!option) return;
		if (option.kind === 'rename') {
			renaming = option.source;
			text = option.source.name;
			active = 0;
			input?.focus();
			return;
		}
		const importing = option.kind === 'import';
		busy = {
			verb: importing ? 'Importing' : 'Creating',
			label: importing ? option.source.label : option.name
		};
		failure = '';
		try {
			await oncreate(importing ? { name, source: option.source.url } : { name });
			busy = null;
			palette?.hidePopover();
		} catch (cause) {
			busy = null;
			failure = cause instanceof Error ? cause.message : 'The repository could not be created.';
			await tick();
			input?.focus();
		}
	}

	function onkeydown(event: KeyboardEvent) {
		const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
		if (event.key in moves && options.length) {
			event.preventDefault();
			active = (active + moves[event.key]! + options.length) % options.length;
		} else if (event.key === 'Enter') {
			event.preventDefault();
			choose(options[active]);
		}
	}
</script>

<div
	bind:this={palette}
	{id}
	popover="auto"
	class="palette"
	ontoggle={(event) => {
		if (event.newState === 'open') input?.focus();
		else if (!busy) reset();
	}}
>
	{#if busy}
		<div class="progress" role="status">
			<StatusIcon state="running" />
			<div>
				<p class="title">{busy.verb} {busy.label}</p>
				<p class="hint">
					{busy.verb === 'Importing'
						? 'Copying its history into ReGit. Large repositories take a minute.'
						: 'Setting up the repository.'}
				</p>
			</div>
		</div>
	{:else}
		<div class="prompt">
			<span class="chip">{renaming ? `Import ${renaming.label}` : 'New repository'}</span>
			<input
				bind:this={input}
				bind:value={text}
				placeholder={renaming ? 'Name' : 'Name, or a git URL to import'}
				aria-label={renaming ? 'Name' : 'Name or git URL'}
				aria-invalid={!!problem}
				aria-controls={options.length ? `${id}-options` : undefined}
				aria-activedescendant={options.length ? `${id}-option-${active}` : undefined}
				autocomplete="off"
				spellcheck="false"
				{onkeydown}
				oninput={() => {
					active = 0;
					failure = '';
				}}
			/>
		</div>

		{#if failure || problem}
			<p class="problem" role="alert">{failure || problem}</p>
		{/if}

		{#if options.length}
			<ul id="{id}-options" role="listbox" aria-label="Actions" class="options">
				{#each options as option, index (option.kind)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<li
						id="{id}-option-{index}"
						role="option"
						aria-selected={active === index}
						onclick={() => choose(option)}
					>
						{#if option.kind === 'create'}
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="M3.5 13V3a1 1 0 0 1 1-1h8v9h-8a1 1 0 0 0-1 1Zm0 0a1 1 0 0 0 1 1h8v-3" />
							</svg>
							<span><strong>Create {option.name}</strong></span>
						{:else}
							<svg viewBox="0 0 16 16" aria-hidden="true">
								<path d="M8 2v8m-3-3 3 3 3-3M3 11v2a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" />
							</svg>
							{#if option.kind === 'import'}
								<span
									><strong>Import {option.source.label}</strong> as <code>{option.name}</code></span
								>
							{:else}
								<span>Import with a different name…</span>
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<footer class="hint">
			{source ? 'Public repositories only for now' : 'Paste a git URL to import instead'}
		</footer>
	{/if}
</div>

<style>
	.palette {
		position: fixed;
		inset: 4rem 0 auto;
		box-sizing: border-box;
		inline-size: min(32rem, calc(100% - 2rem));
		margin: 0 auto;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-floating);
		color: var(--color-fg);
		font-size: var(--text-chat);

		&::backdrop {
			background: color-mix(in oklab, var(--color-bg) 55%, transparent);
			backdrop-filter: blur(2px);
		}
	}

	.prompt {
		display: grid;
		gap: var(--space-3);
		padding: var(--space-6) var(--space-6) var(--space-5);

		input {
			padding: 0;
			border: 0;
			background: none;
			color: inherit;
			font: inherit;
			font-size: 1rem;
			line-height: 1.5;
			outline: 0;

			&::placeholder {
				color: var(--color-muted);
			}
		}
	}

	.chip {
		justify-self: start;
		padding: 0.1em 0.5em;
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.problem {
		margin: 0;
		padding: var(--space-5) var(--space-6);
		border-block-start: 1px solid var(--color-border);
		color: light-dark(#b91c1c, #f87171);
	}

	.options {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: var(--space-3);
		border-block-start: 1px solid var(--color-border);
		list-style: none;

		li {
			display: flex;
			align-items: center;
			gap: var(--space-4);
			padding: var(--space-3) var(--space-4);
			border-radius: var(--radius);
			color: var(--color-muted);
			cursor: pointer;

			&[aria-selected='true'] {
				background: var(--color-surface);
				color: var(--color-fg);
			}
		}

		svg {
			flex: none;
			inline-size: 1.15em;
			block-size: 1.15em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.25;
			stroke-linecap: round;
			stroke-linejoin: round;
		}

		strong {
			font-weight: 600;
		}

		code {
			font-family: var(--font-mono);
			font-size: 0.95em;
		}
	}

	footer {
		padding: var(--space-4) var(--space-6);
		border-block-start: 1px solid var(--color-border);
	}

	.hint {
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.progress {
		display: flex;
		gap: var(--space-5);
		align-items: start;
		padding: var(--space-7) var(--space-6);

		p {
			margin: 0;
		}

		.title {
			margin-block-end: var(--space-1);
			font-weight: 600;
		}

		:global(svg) {
			margin-block-start: 0.1em;
		}
	}

	@media (prefers-reduced-motion: no-preference) {
		.palette {
			transition:
				opacity 0.15s,
				scale 0.15s,
				display 0.15s allow-discrete,
				overlay 0.15s allow-discrete;

			&:not(:popover-open) {
				opacity: 0;
				scale: 0.98;
			}

			@starting-style {
				opacity: 0;
				scale: 0.98;
			}
		}
	}
</style>

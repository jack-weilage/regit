<script module lang="ts">
	export type Mode = 'small' | 'medium' | 'large';

	const modes: { id: Mode; label: string; detail: string }[] = [
		{ id: 'small', label: 'Small', detail: 'Quick fixes' },
		{ id: 'medium', label: 'Medium', detail: 'Most work' },
		{ id: 'large', label: 'Large', detail: 'Hard problems' }
	];
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import Menu from '../Menu.svelte';
	import ChatMention from './ChatMention.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import type { Mentionable } from './types.ts';

	interface Props {
		id: string;
		repo: string;
		similar?: Mentionable[];
		mode?: Mode;
		onquery?: (text: string) => void;
		onstart: (thread: { text: string; mode: Mode }) => void;
		onopenthread?: (thread: Mentionable) => void;
	}

	let {
		id,
		repo,
		similar = [],
		mode = $bindable('medium'),
		onquery,
		onstart,
		onopenthread
	}: Props = $props();

	let text = $state('');
	let active = $state(0);
	let palette: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();

	let options = $derived([null, ...similar]);
	let current = $derived(modes.find((option) => option.id === mode)!);

	function choose(option: Mentionable | null) {
		if (option) {
			onopenthread?.(option);
		} else {
			if (!text.trim()) return;
			onstart({ text: text.trim(), mode });
			text = '';
		}
		palette?.hidePopover();
	}

	function onkeydown(event: KeyboardEvent) {
		const moves: Record<string, number> = { ArrowDown: 1, ArrowUp: -1 };
		if (event.key in moves) {
			event.preventDefault();
			active = (active + moves[event.key]! + options.length) % options.length;
		} else if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			choose(options[active] ?? null);
		}
	}
</script>

<div
	bind:this={palette}
	{id}
	popover="auto"
	class="palette"
	ontoggle={(event) => {
		active = 0;
		if (event.newState === 'open') input?.focus();
	}}
>
	<div class="prompt">
		<span class="repo">{repo}</span>
		<textarea
			bind:this={input}
			bind:value={text}
			rows="1"
			placeholder="What should change?"
			aria-label="What should change?"
			aria-controls="{id}-options"
			aria-activedescendant="{id}-option-{active}"
			{onkeydown}
			oninput={() => {
				active = 0;
				onquery?.(text);
			}}></textarea>
	</div>

	<ul id="{id}-options" role="listbox" aria-label="Actions" class="options">
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<li id="{id}-option-0" role="option" aria-selected={active === 0} onclick={() => choose(null)}>
			<ThreadIcon plus />
			<span><strong>Start a thread</strong> — draft an intent from this</span>
		</li>
		{#if similar.length}
			<li role="presentation" class="heading">Similar threads</li>
			{#each similar as thread, index (thread.handle)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{id}-option-{index + 1}"
					role="option"
					aria-selected={active === index + 1}
					onclick={() => choose(thread)}
				>
					<ChatMention mention={{ ...thread, href: undefined }} />
					{#if thread.detail}
						<span class="detail">{thread.detail}</span>
					{/if}
				</li>
			{/each}
		{/if}
	</ul>

	<footer>
		<Menu
			label="Mode"
			align="start"
			items={modes.map((option) => ({
				label: option.label,
				detail: option.detail,
				checked: option.id === mode,
				onselect: () => (mode = option.id)
			}))}
		>
			{#snippet trigger(props)}
				<Button variant="ghost" size="xs" aria-label="Mode: {current.label}" {...props}>
					{current.label}
					<svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
						><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></svg
					>
				</Button>
			{/snippet}
		</Menu>
	</footer>
</div>

<style>
	.palette {
		position: fixed;
		inset: 4rem 0 auto;
		box-sizing: border-box;
		inline-size: min(40rem, calc(100% - 2rem));
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
		border-block-end: 1px solid var(--color-border);

		textarea {
			field-sizing: content;
			max-block-size: 8lh;
			padding: 0;
			border: 0;
			background: none;
			color: inherit;
			font: inherit;
			font-size: 1rem;
			line-height: 1.5;
			resize: none;
			outline: 0;

			&::placeholder {
				color: var(--color-muted);
			}
		}
	}

	.repo {
		justify-self: start;
		padding: 0.1em 0.5em;
		border-radius: var(--radius);
		background: var(--color-surface);
		color: var(--color-muted);
		font-family: var(--font-mono);
		font-size: var(--text-meta);
	}

	.options {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: var(--space-3);
		list-style: none;

		li {
			--icon-size: 1.15em;

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

		.heading {
			padding-block: var(--space-4) var(--space-1);
			font-size: var(--text-meta);
			font-weight: 600;
			cursor: default;
		}

		strong {
			font-weight: 600;
		}

		.detail {
			font-size: var(--text-meta);
		}
	}

	footer {
		display: flex;
		padding: var(--space-3) var(--space-4);
		border-block-start: 1px solid var(--color-border);
	}

	.chevron {
		inline-size: 1em;
		block-size: 1em;
		align-self: center;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
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

<script module lang="ts">
	import type { Machine } from '@regit/core';

	export type Mode = 'small' | 'medium' | 'large';

	const modes: { id: Mode; label: string; detail: string }[] = [
		{ id: 'small', label: 'Small', detail: 'Quick fixes' },
		{ id: 'medium', label: 'Medium', detail: 'Most work' },
		{ id: 'large', label: 'Large', detail: 'Hard problems' }
	];

	const machines: { id: Machine; label: string; detail: string }[] = [
		{ id: 'standard-1', label: '½ vCPU · 4 GiB', detail: 'Small repos · up to $0.07/h' },
		{ id: 'standard-2', label: '1 vCPU · 6 GiB', detail: 'Most repos · up to $0.13/h' },
		{ id: 'standard-3', label: '2 vCPU · 8 GiB', detail: 'Large builds · up to $0.22/h' },
		{ id: 'standard-4', label: '4 vCPU · 12 GiB', detail: 'Monorepos · up to $0.40/h' }
	];
</script>

<script lang="ts">
	import Button from '../Button.svelte';
	import Menu from '../Menu.svelte';
	import ChatMention from './ChatMention.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import { statuses } from './status.ts';
	import type { Mentionable, SimilarThread } from './types.ts';

	const relations = { same: 'Same goal', overlap: 'Overlaps', related: 'Related' };
	const order = ['same', 'overlap', 'related'];

	interface Props {
		id: string;
		repo: string;
		similar?: SimilarThread[];
		mode?: Mode;
		machine?: Machine;
		onquery?: (text: string) => void;
		onstart: (thread: { text: string; mode: Mode; machine: Machine }) => void;
		onopenthread?: (thread: Mentionable) => void;
	}

	let {
		id,
		repo,
		similar = [],
		mode = $bindable('medium'),
		machine = $bindable('standard-1'),
		onquery,
		onstart,
		onopenthread
	}: Props = $props();

	let text = $state('');
	let active = $state(0);
	let palette: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();

	let matches = $derived(
		similar.toSorted((a, b) => order.indexOf(a.relation) - order.indexOf(b.relation))
	);
	let options = $derived([null, ...matches]);
	let current = $derived(modes.find((option) => option.id === mode)!);
	let currentMachine = $derived(machines.find((option) => option.id === machine)!);

	function choose(option: Mentionable | null) {
		if (option) {
			onopenthread?.(option);
		} else {
			if (!text.trim()) return;
			onstart({ text: text.trim(), mode, machine });
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
			{#each matches as thread, index (thread.handle)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{id}-option-{index + 1}"
					role="option"
					aria-selected={active === index + 1}
					onclick={() => choose(thread)}
				>
					<ChatMention mention={{ ...thread, href: undefined }} />
					<span class="detail"
						><span class={['relation', thread.relation]}>{relations[thread.relation]}</span> · {thread.detail ??
							statuses[thread.status].label}</span
					>
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
		<Menu
			label="Machine"
			align="start"
			items={machines.map((option) => ({
				label: option.label,
				detail: option.detail,
				checked: option.id === machine,
				onselect: () => (machine = option.id)
			}))}
		>
			{#snippet trigger(props)}
				<Button variant="ghost" size="xs" aria-label="Machine: {currentMachine.label}" {...props}>
					<svg class="chip" viewBox="0 0 16 16" aria-hidden="true"
						><rect x="4" y="4" width="8" height="8" rx="1.5" /><path
							d="M6.5 2v2M9.5 2v2M6.5 12v2M9.5 12v2M2 6.5h2M2 9.5h2M12 6.5h2M12 9.5h2"
						/></svg
					>
					{currentMachine.label}
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

		.relation.same {
			color: var(--color-fg);
			font-weight: 600;
		}
	}

	footer {
		display: flex;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-4);
		border-block-start: 1px solid var(--color-border);
	}

	.chip {
		inline-size: 1.1em;
		block-size: 1.1em;
		align-self: center;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.3;
		stroke-linecap: round;
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

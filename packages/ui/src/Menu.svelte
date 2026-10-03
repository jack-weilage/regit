<script module lang="ts">
	export interface MenuItem {
		label: string;
		detail?: string;
		checked?: boolean;
		separated?: boolean;
		danger?: boolean;
		onselect: () => void;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { createAttachmentKey } from 'svelte/attachments';
	import Popover from './Popover.svelte';

	interface Props {
		label: string;
		items: MenuItem[];
		align?: 'start' | 'end';
		trigger: Snippet<[Record<string | symbol, unknown>]>;
	}

	let { label, items, align, trigger }: Props = $props();

	const id = $props.id();

	let anchor: HTMLElement | undefined = $state();
	let menu: HTMLElement | undefined = $state();

	const triggerProps = {
		popovertarget: `${id}-menu`,
		'aria-haspopup': 'menu',
		[createAttachmentKey()]: (element: HTMLElement) => {
			anchor = element;
		}
	};

	function menuItems() {
		return [...(menu?.querySelectorAll<HTMLElement>('[role^=menuitem]') ?? [])];
	}

	function focusFirst(event: ToggleEvent) {
		if (event.newState !== 'open') return;
		const all = menuItems();
		(all.find((item) => item.ariaChecked === 'true') ?? all[0])?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		const all = menuItems();
		const index = all.indexOf(document.activeElement as HTMLElement);
		const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: all.length - 1 }[
			event.key
		];
		if (next === undefined) return;
		event.preventDefault();
		all[(next + all.length) % all.length]?.focus();
	}

	function select(item: MenuItem) {
		document.getElementById(`${id}-menu`)?.hidePopover();
		item.onselect();
	}
</script>

{@render trigger(triggerProps)}
<Popover id="{id}-menu" {anchor} {align} ontoggle={focusFirst}>
	<div bind:this={menu} class="menu" role="menu" aria-label={label} tabindex="-1" {onkeydown}>
		{#each items as item (item.label)}
			{#if item.separated}
				<div role="separator" class="separator"></div>
			{/if}
			<button
				type="button"
				role={item.checked === undefined ? 'menuitem' : 'menuitemradio'}
				class={{ danger: item.danger }}
				aria-checked={item.checked}
				onclick={() => select(item)}
			>
				<span class="label">{item.label}</span>
				{#if item.detail}
					<span class="detail">{item.detail}</span>
				{/if}
				{#if item.checked}
					<svg class="check" viewBox="0 0 16 16" aria-hidden="true"
						><path d="m3.5 8.5 3 3 6-7" /></svg
					>
				{/if}
			</button>
		{/each}
	</div>
</Popover>

<style>
	.menu {
		display: grid;
		min-inline-size: 10rem;
		padding: var(--space-2);
		font-size: var(--text-chat);
		outline: 0;

		button {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: var(--space-5);
			align-items: center;
			padding: var(--space-3) var(--space-4);
			border: 0;
			border-radius: var(--radius);
			background: none;
			color: inherit;
			font: inherit;
			text-align: start;
			cursor: pointer;

			&:hover,
			&:focus-visible {
				background: var(--color-surface);
				outline: 0;
			}
		}
	}

	.danger {
		color: var(--color-danger-text);
	}

	.separator {
		margin: var(--space-2) calc(-1 * var(--space-2));
		border-block-start: 1px solid var(--color-border);
	}

	.detail {
		grid-column: 1;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.check {
		grid-area: 1 / 2 / span 2;
		inline-size: 1em;
		block-size: 1em;
		fill: none;
		stroke: var(--color-accent);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>

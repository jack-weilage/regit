<script module lang="ts">
	export type SidebarTab = 'changes' | 'services';
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open?: boolean;
		tab?: SidebarTab;
		changes?: { files: number; additions: number; deletions: number } | null;
		live?: boolean;
		changesTab: Snippet<[close: () => void]>;
		servicesTab: Snippet<[close: () => void]>;
	}

	let {
		open = $bindable(false),
		tab = $bindable('changes'),
		changes = null,
		live = false,
		changesTab,
		servicesTab
	}: Props = $props();

	const id = $props.id();

	function show(next: SidebarTab) {
		if (open && tab === next) open = false;
		else {
			tab = next;
			open = true;
		}
	}

	const close = () => (open = false);
</script>

{#snippet changesIcon()}
	<svg viewBox="0 0 16 16" aria-hidden="true"
		><circle cx="4" cy="3.5" r="1.75" /><circle cx="12" cy="12.5" r="1.75" /><path
			d="M4 5.25V10a2 2 0 0 0 2 2h3.5M12 10.75V6a2 2 0 0 0-2-2H6.5"
		/></svg
	>
{/snippet}

{#snippet servicesIcon()}
	<svg viewBox="0 0 16 16" aria-hidden="true"
		><rect x="2" y="3" width="12" height="9" rx="1.5" /><path
			d="M5.5 14h5M6.5 6.5 9.5 8 6.5 9.5z"
		/></svg
	>
{/snippet}

<aside class={['sidebar', { open }]} aria-label="Thread panel">
	<nav class="rail" aria-label="Panels">
		<button
			type="button"
			class={{ active: open && tab === 'changes' }}
			aria-pressed={open && tab === 'changes'}
			aria-controls={open ? `${id}-panel` : undefined}
			aria-label={changes?.files
				? `Changes: ${changes.files} ${changes.files === 1 ? 'file' : 'files'}`
				: 'Changes'}
			onclick={() => show('changes')}
		>
			{@render changesIcon()}
			{#if changes?.files}<span class="count">{changes.files}</span>{/if}
		</button>
		<button
			type="button"
			class={{ active: open && tab === 'services' }}
			aria-pressed={open && tab === 'services'}
			aria-controls={open ? `${id}-panel` : undefined}
			aria-label={live ? 'Services: running' : 'Services'}
			onclick={() => show('services')}
		>
			{@render servicesIcon()}
			{#if live}<span class="live"></span>{/if}
		</button>
	</nav>

	{#if open}
		<div class="panel" id="{id}-panel">
			{#if tab === 'changes'}{@render changesTab(close)}{:else}{@render servicesTab(close)}{/if}
		</div>
		<button type="button" class="scrim" tabindex="-1" aria-label="Close panel" onclick={close}
		></button>
	{/if}
</aside>

<style>
	.sidebar {
		display: flex;
		flex-direction: row-reverse;
		block-size: 100%;
		min-block-size: 0;
		border-inline-start: 1px solid var(--color-border);
		background: var(--color-bg);
		font-size: var(--text-chat);

		svg {
			inline-size: 1.15em;
			block-size: 1.15em;
			fill: none;
			stroke: currentColor;
			stroke-width: 1.4;
			stroke-linecap: round;
			stroke-linejoin: round;
		}
	}

	.rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4) var(--space-3);

		button {
			position: relative;
			display: grid;
			place-items: center;
			inline-size: 2.25rem;
			block-size: 2.25rem;
			border: 0;
			border-radius: var(--radius);
			background: none;
			color: var(--color-muted);
			cursor: pointer;

			&:hover,
			&.active {
				background: var(--color-surface);
				color: var(--color-fg);
			}

			&.active::before {
				content: '';
				position: absolute;
				inset-block: var(--space-3);
				inset-inline-start: calc(-1 * var(--space-3));
				inline-size: 2px;
				border-radius: 1px;
				background: var(--color-accent);
			}

			&:focus-visible {
				outline: 2px solid var(--color-accent);
				outline-offset: 1px;
			}
		}

		.count {
			position: absolute;
			inset-block-start: -0.2rem;
			inset-inline-end: -0.2rem;
			min-inline-size: 1.1em;
			padding: 0 0.25em;
			border-radius: 1em;
			background: var(--color-surface);
			color: var(--color-fg);
			font-size: 0.65rem;
			line-height: 1.1rem;
		}

		.live {
			position: absolute;
			inset-block-start: 0.35rem;
			inset-inline-end: 0.35rem;
		}
	}

	.live {
		display: inline-block;
		inline-size: 0.45rem;
		block-size: 0.45rem;
		border-radius: 50%;
		background: var(--color-added);
	}

	.panel {
		display: flex;
		flex-direction: column;
		inline-size: clamp(22rem, 45cqi, 48rem);
		min-inline-size: 0;
		border-inline-end: 1px solid var(--color-border);
		background: var(--color-bg);
	}

	@media (prefers-reduced-motion: no-preference) {
		.panel {
			transition:
				opacity 0.15s,
				translate 0.15s;

			@starting-style {
				opacity: 0;
				translate: 1rem 0;
			}
		}
	}

	.scrim {
		display: none;
	}

	@container (width < 48rem) {
		.sidebar {
			--overlay: min(36rem, 100cqi - 3rem);
		}

		.panel {
			position: absolute;
			inset-block: 0;
			inset-inline-end: 3rem;
			z-index: 2;
			inline-size: var(--overlay);
			box-shadow: -0.5rem 0 1.5rem rgb(0 0 0 / 0.3);
		}

		.scrim {
			position: absolute;
			inset-block: 0;
			inset-inline: 0 calc(3rem + var(--overlay));
			z-index: 2;
			display: block;
			padding: 0;
			border: 0;
			background: rgb(0 0 0 / 0.4);
			cursor: default;
		}
	}
</style>

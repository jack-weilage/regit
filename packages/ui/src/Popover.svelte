<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		id: string;
		anchor?: HTMLElement;
		manual?: boolean;
		open?: boolean;
		matchWidth?: boolean;
		children: Snippet;
	}

	let {
		id,
		anchor,
		manual = false,
		open = false,
		matchWidth = false,
		children,
		...rest
	}: Props = $props();

	const gap = 6;

	let shown = $state(false);
	let placement = $state({ right: 0, offset: 0, width: 0, below: false });

	function place() {
		if (!anchor) return;
		const rect = anchor.getBoundingClientRect();
		const below = rect.top < innerHeight - rect.bottom;
		placement = {
			right: innerWidth - rect.right,
			offset: below ? rect.bottom + gap : innerHeight - rect.top + gap,
			width: rect.width,
			below
		};
	}

	const syncOpen: Attachment<HTMLElement> = (panel) => {
		if (manual) panel.togglePopover(open);
	};

	const followAnchor: Attachment = () => {
		if (!shown || !anchor) return;
		const observer = new ResizeObserver(place);
		observer.observe(anchor);
		addEventListener('resize', place);
		return () => {
			observer.disconnect();
			removeEventListener('resize', place);
		};
	};
</script>

<div
	{id}
	popover={manual ? 'manual' : 'auto'}
	class={['popover', { below: placement.below }]}
	onbeforetoggle={(event) => event.newState === 'open' && place()}
	ontoggle={(event) => (shown = event.newState === 'open')}
	style:right="{placement.right}px"
	style:top={placement.below ? `${placement.offset}px` : undefined}
	style:bottom={placement.below ? undefined : `${placement.offset}px`}
	style:inline-size={matchWidth ? `${placement.width}px` : undefined}
	{@attach syncOpen}
	{@attach followAnchor}
	{...rest}
>
	{@render children()}
</div>

<style>
	.popover {
		box-sizing: border-box;
		inset: auto;
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		box-shadow: var(--shadow-floating);
		color: var(--color-fg);
	}

	@media (prefers-reduced-motion: no-preference) {
		.popover {
			--shift: 0.25rem;

			transform-origin: bottom right;
			transition:
				opacity 0.15s,
				translate 0.15s,
				scale 0.15s,
				display 0.15s allow-discrete,
				overlay 0.15s allow-discrete;

			&.below {
				--shift: -0.25rem;

				transform-origin: top right;
			}

			&:not(:popover-open) {
				opacity: 0;
				translate: 0 var(--shift);
				scale: 0.98;
			}

			@starting-style {
				opacity: 0;
				translate: 0 var(--shift);
				scale: 0.98;
			}
		}
	}
</style>

<script module lang="ts">
	import type { Mentionable } from './types.ts';

	const mentionQuery = /(?:^|\s)@([\w-]*)$/;

	function matches(item: Mentionable, query: string) {
		const words = [item.handle, ...item.label.split(/\s+/)];
		return words.some((word) => word.toLowerCase().startsWith(query.toLowerCase()));
	}
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Avatar from '../Avatar.svelte';
	import Button from '../Button.svelte';
	import Popover from '../Popover.svelte';
	import ThreadIcon from './ThreadIcon.svelte';

	interface Props {
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		mentions?: Mentionable[];
		onsend: (message: string) => void;
	}

	let {
		value = $bindable(''),
		placeholder = 'Message',
		disabled = false,
		mentions = [],
		onsend
	}: Props = $props();

	const id = $props.id();

	let form: HTMLFormElement | undefined = $state();
	let textarea: HTMLTextAreaElement;
	let mention: { start: number; query: string } | null = $state(null);
	let active = $state(0);

	let message = $derived(value.trim());
	let suggestions = $derived.by(() => {
		if (!mention) return [];
		const { query } = mention;
		return mentions.filter((item) => matches(item, query)).slice(0, 8);
	});
	let open = $derived(suggestions.length > 0);

	function findMention() {
		const before = textarea.value.slice(0, textarea.selectionStart);
		const query = before.match(mentionQuery)?.[1];
		mention = query === undefined ? null : { start: before.length - query.length - 1, query };
		active = 0;
	}

	async function select(item: Mentionable) {
		if (!mention) return;
		const { start, query } = mention;
		const insert = `@${item.handle} `;
		value = value.slice(0, start) + insert + value.slice(start + query.length + 1);
		mention = null;
		await tick();
		textarea.setSelectionRange(start + insert.length, start + insert.length);
	}

	function onsubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!message || disabled) return;
		onsend(message);
		value = '';
		mention = null;
	}

	function onkeydown(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (event.isComposing) return;

		if (open) {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const step = event.key === 'ArrowDown' ? 1 : -1;
				active = (active + step + suggestions.length) % suggestions.length;
				return;
			}
			if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
				event.preventDefault();
				select(suggestions[active]!);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				mention = null;
				return;
			}
		}

		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			event.currentTarget.form?.requestSubmit();
		}
	}

	function onkeyup(event: KeyboardEvent) {
		if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) findMention();
	}
</script>

<form bind:this={form} {onsubmit}>
	<Popover id="{id}-popover" anchor={form} manual {open} matchWidth>
		<ul class="suggestions" id="{id}-suggestions" role="listbox" aria-label="Mention suggestions">
			{#each suggestions as item, index (`${item.kind}:${item.handle}`)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<li
					id="{id}-{index}"
					role="option"
					tabindex="-1"
					aria-selected={index === active}
					onpointermove={() => (active = index)}
					onpointerdown={(event) => event.preventDefault()}
					onclick={() => select(item)}
				>
					{#if item.kind === 'person'}
						<Avatar name={item.label} src={item.avatar} aria-hidden="true" />
					{:else}
						<ThreadIcon />
					{/if}
					<span class="label">{item.label}</span>
					<span class="detail">{item.detail ?? `@${item.handle}`}</span>
				</li>
			{/each}
		</ul>
	</Popover>
	<div class="field">
		<textarea
			bind:this={textarea}
			bind:value
			{placeholder}
			{disabled}
			{onkeydown}
			{onkeyup}
			oninput={findMention}
			onclick={findMention}
			onblur={() => (mention = null)}
			rows="1"
			aria-label={placeholder}
			aria-autocomplete="list"
			aria-controls={open ? `${id}-suggestions` : undefined}
			aria-activedescendant={open ? `${id}-${active}` : undefined}></textarea>
	</div>
	<Button type="submit" variant="primary" icon disabled={disabled || !message} aria-label="Send">
		<svg class="send" viewBox="0 0 16 16" aria-hidden="true">
			<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
		</svg>
	</Button>
</form>

<style>
	form {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: end;
		gap: var(--space-4);
		padding: var(--space-4);
		padding-inline-start: var(--chat-inset);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;

		&:focus-within {
			border-color: var(--color-accent);
			box-shadow: 0 0 0 3px color-mix(in oklab, var(--color-accent) 25%, transparent);
		}

		&:has(textarea:disabled) {
			opacity: 0.6;
		}
	}

	.suggestions {
		max-block-size: 16rem;
		margin: 0;
		padding: var(--space-2);
		overflow-y: auto;
		font-size: var(--text-chat);
		list-style: none;

		li {
			--avatar-size: 1.5em;
			--icon-size: 1.5em;

			display: flex;
			align-items: center;
			gap: var(--space-4);
			padding: var(--space-3) var(--space-4);
			border-radius: var(--radius);
			cursor: pointer;

			&[aria-selected='true'] {
				background: var(--color-surface);
			}

			> :global(svg) {
				box-sizing: border-box;
				padding: var(--space-1);
				color: var(--color-muted);
			}
		}

		.label {
			overflow: hidden;
			font-weight: 500;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.detail {
			flex: none;
			margin-inline-start: auto;
			color: var(--color-muted);
			font-size: var(--text-meta);
		}
	}

	.field {
		display: grid;
		min-inline-size: 0;

		> :global(:not(textarea)) {
			position: absolute;
		}
	}

	textarea {
		field-sizing: content;
		max-block-size: 12lh;
		padding: 0.3em 0;
		border: 0;
		outline: 0;
		background: none;
		color: inherit;
		font: inherit;
		font-size: var(--text-chat);
		line-height: 1.5;
		resize: none;

		&::placeholder {
			color: var(--color-muted);
		}
	}

	.send {
		inline-size: 1.25em;
		block-size: 1.25em;
		align-self: center;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media (pointer: coarse) {
		textarea {
			font-size: 1rem;
		}
	}
</style>

<script lang="ts">
	import Button from './Button.svelte';
	import StatusIcon from './StatusIcon.svelte';

	interface Props {
		title: string;
		detail?: string;
		inline?: boolean;
		back?: { href: string; label: string };
		onretry?: () => void;
	}

	let { title, detail, inline = false, back, onretry }: Props = $props();
</script>

{#if inline}
	<p class="inline">
		<StatusIcon state="failed" />
		<span>{title}</span>
		{#if onretry}
			<Button size="xs" onclick={onretry}>Try again</Button>
		{/if}
	</p>
{:else}
	<div class="page">
		<h1>{title}</h1>
		{#if detail}
			<p>{detail}</p>
		{/if}
		{#if back || onretry}
			<div class="buttons">
				{#if back}
					<a class="back" href={back.href}>{back.label}</a>
				{/if}
				{#if onretry}
					<Button variant="primary" onclick={onretry}>Try again</Button>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.inline {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin: 0;
		padding-inline: var(--chat-inset);
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.page {
		display: grid;
		align-content: center;
		justify-items: center;
		gap: var(--space-4);
		padding: var(--space-7);
		font-size: var(--text-chat);
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.page p {
		margin: 0;
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	.buttons {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-block-start: var(--space-3);
	}

	.back {
		padding: 0.5em 1em;
		border-radius: var(--radius);
		color: inherit;
		text-decoration: none;

		&:hover {
			background: var(--color-surface);
		}
	}
</style>

<script lang="ts">
	import Button from '../Button.svelte';
	import { clock } from './clock.svelte.ts';
	import { useFormat } from './format.ts';

	interface Props {
		deletedBy: string;
		deletedAt: number;
		purgeAt: number;
		back: string;
		now?: number;
		onrestore: () => void;
	}

	let { deletedBy, deletedAt, purgeAt, back, now, onrestore }: Props = $props();

	const format = useFormat();

	let time = $derived(now ?? clock.now);

	let days = $derived(Math.max(1, Math.ceil((purgeAt - time) / 86_400_000)));
</script>

<div class="deleted">
	<h1>This thread was deleted</h1>
	<p>
		{deletedBy} deleted it {format.ago(deletedAt, time)}. It's gone for good in {days}
		{days === 1 ? 'day' : 'days'}.
	</p>
	<div class="buttons">
		<a class="back" href={back}>Back to threads</a>
		<Button variant="primary" onclick={onrestore}>Restore</Button>
	</div>
</div>

<style>
	.deleted {
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

	p {
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

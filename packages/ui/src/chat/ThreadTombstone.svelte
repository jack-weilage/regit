<script lang="ts">
	import { useFormat } from './format.ts';

	interface Props {
		deletedBy: string;
		deletedAt: number;
		shippedBy: string;
		shippedAt: number;
		sha: string;
	}

	let { deletedBy, deletedAt, shippedBy, shippedAt, sha }: Props = $props();

	const format = useFormat();
</script>

<div class="tombstone">
	<p>The conversation was deleted by {deletedBy} on {format.date(deletedAt)}.</p>
	<p class="hint">
		Shipped by {shippedBy} in <code>{sha.slice(0, 7)}</code> on {format.date(shippedAt)}.
	</p>
</div>

<style>
	.tombstone {
		display: grid;
		gap: var(--space-3);
		margin: var(--space-6);
		padding: var(--space-5) var(--space-6);
		border: 1px dashed var(--color-border);
		border-radius: var(--radius);
		font-size: var(--text-chat);
	}

	p {
		margin: 0;
	}

	.hint {
		color: var(--color-muted);
		font-size: var(--text-meta);
	}

	code {
		font-family: var(--font-mono);
	}
</style>

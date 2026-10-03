<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ThreadTombstone from './ThreadTombstone.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Thread tombstone',
		component: ThreadTombstone,
		args: {
			deletedBy: 'Sam',
			deletedAt: Date.UTC(2026, 9, 3, 12),
			shippedBy: 'Lin',
			shippedAt: Date.UTC(2026, 8, 28, 12),
			sha: 'e2bac6e9f1c04b5a8d3e7f2a1b6c9d0e4f5a6b7c'
		}
	});
</script>

<Story
	name="Shipped"
	play={async ({ canvas }) => {
		await expect(canvas.getByText('e2bac6e')).toBeVisible();
		await expect(canvas.getByText(/deleted by Sam/)).toBeVisible();
	}}
/>

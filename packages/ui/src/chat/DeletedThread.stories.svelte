<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import DeletedThread from './DeletedThread.svelte';

	const now = Date.UTC(2026, 9, 3, 12);
	const hours = (count: number) => count * 3_600_000;

	const { Story } = defineMeta({
		title: 'Chat/Deleted thread',
		component: DeletedThread,
		args: {
			deletedBy: 'Sam',
			deletedAt: now - hours(2),
			purgeAt: now - hours(2) + hours(24 * 7),
			back: '#',
			now,
			onrestore: fn()
		}
	});
</script>

<Story
	name="Restorable"
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByText(/Sam deleted it 2 hours ago/)).toHaveTextContent(
			'gone for good in 7 days'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Restore' }));
		await expect(args.onrestore).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Last day"
	args={{ deletedAt: now - hours(24 * 6 + 4), purgeAt: now + hours(20) }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText(/6 days ago/)).toHaveTextContent('gone for good in 1 day');
	}}
/>

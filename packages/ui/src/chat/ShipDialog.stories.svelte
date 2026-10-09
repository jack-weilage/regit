<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ShipDialog from './ShipDialog.svelte';

	const { Story } = defineMeta({
		title: 'Legacy/Ship dialog',
		component: ShipDialog,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			open: true,
			repo: 'regit/web',
			headline: 'perf(settings): load members lazily',
			body: 'The settings page loaded every member before rendering, which took seconds for large orgs. Members now load in pages of 50.',
			files: 4,
			additions: 23,
			deletions: 8,
			review: { verdict: 'pass', met: 3, total: 3 },
			onship: fn()
		}
	});
</script>

<Story
	name="Reviewed"
	play={async ({ args, canvas, userEvent }) => {
		const dialog = await canvas.findByRole('dialog', { name: 'Ship to main?' });
		await expect(dialog).toHaveTextContent('3/3 checks met');
		const title = canvas.getByRole('textbox', { name: 'Commit title' });
		await userEvent.clear(title);
		await userEvent.type(title, 'perf(settings): page members');
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		await expect(args.onship).toHaveBeenCalledWith({
			title: 'perf(settings): page members',
			body: args.body
		});
		await waitFor(() => expect(dialog).not.toBeVisible());
	}}
/>

<Story
	name="Review didn't pass"
	args={{ review: { verdict: 'needs-human', met: 2, total: 3 } }}
	play={async ({ canvas }) => {
		const button = await canvas.findByRole('button', { name: 'Ship anyway' });
		await waitFor(() => expect(button).toBeVisible());
	}}
/>

<Story
	name="Main moved"
	args={{ behind: 3 }}
	play={async ({ canvas }) => {
		const dialog = await canvas.findByRole('dialog');
		await expect(dialog).toHaveTextContent('has 3 new commits');
	}}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ShipPanel from './ShipPanel.svelte';
	import { intent } from './fixtures.ts';

	const now = Date.UTC(2026, 9, 12, 18);

	const { Story } = defineMeta({
		title: 'Chat/Ship',
		component: ShipPanel,
		tags: ['!autodocs'],
		args: { intent, branch: 'main', status: 'needs-you', onship: fn().mockResolvedValue(undefined) }
	});
</script>

<Story
	name="Ship"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		const title = canvas.getByRole('textbox', { name: 'Commit title' });
		await expect(title).toHaveValue(intent.headline);
		await expect(canvas.getByRole('textbox', { name: 'Commit body' })).toHaveValue(intent.purpose);
		await userEvent.clear(title);
		await userEvent.type(title, 'perf: paginate members');
		await userEvent.click(canvas.getByRole('button', { name: 'Ship commit' }));
		await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Commit title' })).toBeNull());
		await expect(args.onship).toHaveBeenCalledWith({
			title: 'perf: paginate members',
			body: intent.purpose
		});
	}}
/>

<Story
	name="Working"
	args={{ status: 'running' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Ship' })).toBeDisabled();
	}}
/>

<Story
	name="Starting"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'starting',
			note: null,
			branch: null,
			since: now - 1_000,
			started: now - 1_000
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Shipping to main')).toBeVisible();
		await expect(canvas.queryByRole('button')).toBeNull();
		await expect(canvas.queryByRole('listitem', { current: 'step' })).toBeNull();
	}}
/>

<Story
	name="Pushing"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'pushing',
			note: 'a1b2c3d onto 9f8e7d6',
			branch: 'main',
			since: now - 12_000,
			started: now - 12_000
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('listitem', { current: 'step' })).toHaveTextContent(
			'Pushing to main a1b2c3d onto 9f8e7d6'
		);
		await expect(canvas.getByText('12s')).toBeVisible();
	}}
/>

<Story
	name="Rebuilding"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'building',
			note: 'master moved, so rebuilding on top of it',
			branch: 'master',
			since: now - 3_000,
			started: now - 31_000
		}
	}}
/>

<Story
	name="Retrying"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'fetching',
			note: 'Retrying, attempt 2',
			branch: null,
			since: now - 4_000,
			started: now - 4_000
		}
	}}
/>

<Story
	name="Error"
	args={{
		onship: fn(async () => {
			throw new Error('Repository owner permission is required');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Ship commit' }));
		await waitFor(() =>
			expect(canvas.getByRole('alert')).toHaveTextContent('Repository owner permission is required')
		);
		await expect(canvas.getByRole('button', { name: 'Ship commit' })).toBeEnabled();
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem; max-inline-size: 100%">
		<ShipPanel
			{intent}
			branch="main"
			status="needs-you"
			onship={fn().mockResolvedValue(undefined)}
		/>
	</div>
</Story>

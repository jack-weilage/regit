<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import CloneDialog, { type GitTokenView } from './CloneDialog.svelte';

	const now = Date.UTC(2026, 9, 4, 18);
	const day = 24 * 60 * 60 * 1000;

	const tokens: GitTokenView[] = [
		{
			id: 'laptop',
			label: 'Laptop',
			scope: 'write',
			expiresAt: now + 80 * day,
			lastUsedAt: now - 2 * 60 * 60 * 1000
		},
		{ id: 'ci', label: 'CI', scope: 'read', expiresAt: now - day, lastUsedAt: null }
	];

	const { Story } = defineMeta({
		title: 'Clone dialog',
		component: CloneDialog,
		tags: ['!autodocs'],
		args: {
			open: true,
			repo: 'regit',
			url: 'https://git.regit.dev/regit.git',
			now,
			oncreate: fn(),
			onrevoke: fn()
		}
	});
</script>

<Story
	name="Tokens"
	args={{ tokens }}
	play={async ({ args, canvas, userEvent }) => {
		await waitFor(() =>
			expect(canvas.getByText('git clone https://git.regit.dev/regit.git')).toBeVisible()
		);
		await expect(canvas.getByText(/Read · expired/)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Revoke CI' }));
		await expect(args.onrevoke).toHaveBeenCalledWith('ci');
		await userEvent.type(canvas.getByRole('textbox', { name: 'Token name' }), 'Desktop');
		await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Access' }), 'read');
		await userEvent.click(canvas.getByRole('button', { name: 'Create token' }));
		await expect(args.oncreate).toHaveBeenCalledWith({ label: 'Desktop', scope: 'read', days: 90 });
	}}
/>

<Story
	name="New token"
	args={{
		tokens: tokens.slice(0, 1),
		created: { label: 'Laptop', secret: 'regit_5f2c9a0e81b74d3a96c1e07f42ab8d5c13e9f60a7b2d4c18' }
	}}
	play={async ({ canvas }) => {
		await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Shown once.'));
	}}
/>

<Story name="No tokens" args={{ tokens: [] }} />

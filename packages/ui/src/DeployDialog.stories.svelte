<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import type { DeploySecret } from '@regit/core';
	import DeployDialog from './DeployDialog.svelte';

	const now = Date.UTC(2026, 9, 13, 18);
	const day = 24 * 60 * 60 * 1000;

	const secrets: DeploySecret[] = [
		{ name: 'CLOUDFLARE_ACCOUNT_ID', updatedAt: now - 3 * day, updatedBy: 'Sam' },
		{ name: 'CLOUDFLARE_API_TOKEN', updatedAt: now - 60 * 60 * 1000, updatedBy: 'Lin' }
	];

	const { Story } = defineMeta({
		title: 'Deploy dialog',
		component: DeployDialog,
		tags: ['!autodocs'],
		args: {
			open: true,
			repo: 'regit',
			machine: 'standard-3',
			now,
			onmachine: fn(),
			onsave: fn(async () => {}),
			onremove: fn()
		}
	});
</script>

<Story
	name="Secrets"
	args={{ secrets }}
	play={async ({ args, canvas, userEvent }) => {
		await waitFor(() => expect(canvas.getByText('CLOUDFLARE_API_TOKEN')).toBeVisible());
		const machine = canvas.getByRole('combobox', { name: /Machine for deploy checks/ });
		await expect(machine).toHaveValue('standard-3');
		await userEvent.selectOptions(machine, 'standard-4');
		await expect(args.onmachine).toHaveBeenCalledWith('standard-4');
		await expect(canvas.getByText('set by Lin 1 hour ago')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Remove CLOUDFLARE_ACCOUNT_ID' }));
		await expect(args.onremove).toHaveBeenCalledWith('CLOUDFLARE_ACCOUNT_ID');
		await userEvent.click(canvas.getByRole('button', { name: 'Replace CLOUDFLARE_API_TOKEN' }));
		await expect(canvas.getByRole('textbox', { name: 'Secret name' })).toHaveValue(
			'CLOUDFLARE_API_TOKEN'
		);
		await userEvent.type(canvas.getByRole('textbox', { name: 'Secret value' }), 'new-token');
		await userEvent.click(canvas.getByRole('button', { name: 'Save secret' }));
		await expect(args.onsave).toHaveBeenCalledWith({
			name: 'CLOUDFLARE_API_TOKEN',
			value: 'new-token'
		});
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'Secret value' })).toHaveValue('')
		);
	}}
/>

<Story
	name="Save fails"
	args={{
		secrets: [],
		onsave: fn(async () => {
			throw new Error('Deploy secrets need DEPLOY_SECRETS_KEY set on forge');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await waitFor(() => expect(canvas.getByText('No secrets yet.')).toBeVisible());
		await userEvent.type(canvas.getByRole('textbox', { name: 'Secret name' }), 'API_TOKEN');
		await userEvent.type(canvas.getByRole('textbox', { name: 'Secret value' }), 'value');
		await userEvent.click(canvas.getByRole('button', { name: 'Save secret' }));
		await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent('DEPLOY_SECRETS_KEY'));
	}}
/>

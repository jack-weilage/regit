<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import MembersDialog, { type MemberView } from './MembersDialog.svelte';

	const members: MemberView[] = [
		{ id: 'sam', label: '7c1e2f04-sam', role: 'owner', you: true },
		{ id: 'lin', label: '0b9d33aa-lin', role: 'editor' },
		{ id: 'ana', label: 'e41f8c27-ana', role: 'viewer' }
	];

	const { Story } = defineMeta({
		title: 'Members dialog',
		component: MembersDialog,
		tags: ['!autodocs'],
		args: {
			open: true,
			repo: 'regit',
			members,
			onadd: fn(async () => {}),
			onremove: fn(async () => {})
		}
	});
</script>

<Story
	name="List"
	play={async ({ canvas }) => {
		const list = await waitFor(() => canvas.getByRole('list', { name: 'Members' }));
		await expect(list.querySelectorAll('li')).toHaveLength(3);
		await expect(canvas.getByText('You')).toBeVisible();
		await expect(canvas.queryByRole('button', { name: 'Remove 7c1e2f04-sam' })).toBeNull();
		await expect(canvas.getByRole('button', { name: 'Remove 0b9d33aa-lin' })).toBeVisible();
	}}
/>

<Story
	name="Add"
	play={async ({ args, canvas, userEvent }) => {
		const input = await waitFor(() => canvas.getByRole('textbox', { name: 'Access user ID' }));
		await userEvent.type(input, 'd2a0-kim');
		await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Role' }), 'viewer');
		await userEvent.click(canvas.getByRole('button', { name: 'Add member' }));
		await expect(args.onadd).toHaveBeenCalledWith({ id: 'd2a0-kim', role: 'viewer' });
		await waitFor(() => expect(input).toHaveValue(''));
	}}
/>

<Story
	name="Remove"
	play={async ({ args, canvas, userEvent }) => {
		await waitFor(() => expect(canvas.getByText('e41f8c27-ana')).toBeVisible());
		await userEvent.click(canvas.getByRole('button', { name: 'Remove e41f8c27-ana' }));
		await expect(args.onremove).toHaveBeenCalledWith('ana');
	}}
/>

<Story
	name="Add fails"
	args={{
		onadd: fn(async () => {
			throw new Error('Owners cannot demote themselves');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		const input = await waitFor(() => canvas.getByRole('textbox', { name: 'Access user ID' }));
		await userEvent.type(input, 'sam');
		await userEvent.click(canvas.getByRole('button', { name: 'Add member' }));
		await waitFor(() => expect(canvas.getByRole('alert')).toHaveTextContent('demote'));
		await expect(input).toHaveValue('sam');
	}}
/>

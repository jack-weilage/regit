<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, waitFor } from 'storybook/test';
	import Button from './Button.svelte';
	import NewRepoPalette from './NewRepoPalette.svelte';

	const url = 'https://github.com/acme/billing-api';

	const { Story } = defineMeta({
		title: 'New repository palette',
		component: NewRepoPalette,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { id: 'new-repo', repos: ['hello-world'], oncreate: fn(async () => {}) }
	});
</script>

{#snippet page(args: ComponentProps<typeof NewRepoPalette>)}
	<div style="block-size: 20rem; padding: 1rem">
		<Button popovertarget="new-repo">New repository</Button>
		<NewRepoPalette {...args} />
	</div>
{/snippet}

<Story
	name="Open"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		const input = canvas.getByRole('textbox', { name: 'Name or git URL' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.type(input, 'billing-api');
		await waitFor(() =>
			expect(canvas.getByRole('option', { name: /Create billing-api/ })).toBeVisible()
		);
	}}
	template={page}
/>

<Story
	name="Create"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		const input = canvas.getByRole('textbox', { name: 'Name or git URL' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard('billing-api{Enter}');
		await expect(args.oncreate).toHaveBeenCalledWith({ name: 'billing-api' });
		await waitFor(() => expect(input).not.toBeVisible());
	}}
	template={page}
/>

<Story
	name="Import"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'Name or git URL' })).toHaveFocus()
		);
		await userEvent.paste(`${url}.git`);
		await waitFor(() =>
			expect(
				canvas.getByRole('option', { name: 'Import acme/billing-api as billing-api' })
			).toBeVisible()
		);
		await expect(canvas.getByText('Public repositories only for now')).toBeVisible();
		await userEvent.keyboard('{Enter}');
		await expect(args.oncreate).toHaveBeenCalledWith({ name: 'billing-api', source: `${url}.git` });
	}}
	template={page}
/>

<Story
	name="Import with a different name"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'Name or git URL' })).toHaveFocus()
		);
		await userEvent.paste('github.com/acme/billing-api');
		await userEvent.keyboard('{ArrowDown}{Enter}');
		const input = canvas.getByRole('textbox', { name: 'Name' });
		await expect(input).toHaveValue('billing-api');
		await waitFor(() =>
			expect(canvas.getByText('Import acme/billing-api', { selector: 'span' })).toBeVisible()
		);
		await userEvent.clear(input);
		await userEvent.type(input, 'payments{Enter}');
		await expect(args.oncreate).toHaveBeenCalledWith({ name: 'payments', source: url });
	}}
	template={page}
/>

<Story
	name="Invalid name"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		const input = canvas.getByRole('textbox', { name: 'Name or git URL' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard('billing--api{Enter}');
		await expect(canvas.getByRole('alert')).toHaveTextContent('without a double hyphen');
		await expect(canvas.queryByRole('listbox')).toBeNull();
		await expect(args.oncreate).not.toHaveBeenCalled();
	}}
	template={page}
/>

<Story
	name="Name taken"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'Name or git URL' })).toHaveFocus()
		);
		await userEvent.paste('https://github.com/acme/hello-world');
		await expect(canvas.getByRole('alert')).toHaveTextContent('hello-world already exists.');
		await expect(canvas.getAllByRole('option')).toHaveLength(1);
		await expect(canvas.getByRole('option')).toHaveTextContent('Import with a different name');
	}}
	template={page}
/>

<Story
	name="Importing"
	args={{ oncreate: fn(() => new Promise<void>(() => {})) }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'Name or git URL' })).toHaveFocus()
		);
		await userEvent.paste(url);
		await userEvent.keyboard('{Enter}');
		await expect(canvas.getByRole('status')).toHaveTextContent('Importing acme/billing-api');
	}}
	template={page}
/>

<Story
	name="Failed"
	args={{
		oncreate: fn(async () => {
			throw new Error('github.com/acme/billing-api could not be found.');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New repository' }));
		const input = canvas.getByRole('textbox', { name: 'Name or git URL' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.paste(url);
		await userEvent.keyboard('{Enter}');
		await expect(await canvas.findByRole('alert')).toHaveTextContent('could not be found');
		await expect(canvas.getByRole('textbox', { name: 'Name or git URL' })).toHaveValue(url);
	}}
	template={page}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChatComposer from './ChatComposer.svelte';
	import { mentionables } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Composer',
		component: ChatComposer,
		args: { onsend: fn(), placeholder: 'Describe what you want changed', mentions: mentionables }
	});
</script>

<Story
	name="Empty"
	play={async ({ args, canvas, userEvent }) => {
		const box = canvas.getByRole('textbox');
		await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
		await userEvent.type(box, '  Make it faster  {Enter}');
		await expect(args.onsend).toHaveBeenCalledWith('Make it faster');
		await expect(box).toHaveValue('');
	}}
/>

<Story
	name="New line"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.type(canvas.getByRole('textbox'), 'First line{Shift>}{Enter}{/Shift}');
		await expect(args.onsend).not.toHaveBeenCalled();
		await expect(canvas.getByRole('textbox')).toHaveValue('First line\n');
	}}
/>

<Story
	name="Mention suggestions"
	play={async ({ args, canvas, userEvent }) => {
		const box = canvas.getByRole('textbox');
		await userEvent.type(box, 'Ask @li');
		await waitFor(() => expect(canvas.getByRole('option', { name: /Lin Wei/ })).toBeVisible());
		await userEvent.keyboard('{Enter}');
		await expect(args.onsend).not.toHaveBeenCalled();
		await expect(box).toHaveValue('Ask @lin ');
		await userEvent.type(box, '@');
		await waitFor(() => expect(canvas.getByRole('listbox')).toBeVisible());
		await userEvent.keyboard('{Escape}');
		await waitFor(() => expect(canvas.getByRole('listbox')).not.toBeVisible());
	}}
/>
<Story
	name="Draft"
	args={{ value: 'Make the settings page load faster for orgs with thousands of members.' }}
/>
<Story name="Disabled" args={{ disabled: true }} />
<Story name="Narrow" asChild>
	<div style="inline-size: 20rem">
		<ChatComposer onsend={fn()} placeholder="Reply" mentions={mentionables} />
	</div>
</Story>

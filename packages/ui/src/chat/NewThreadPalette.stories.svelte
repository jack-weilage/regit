<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, waitFor } from 'storybook/test';
	import Button from '../Button.svelte';
	import NewThreadPalette from './NewThreadPalette.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import { threads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/New thread palette',
		component: NewThreadPalette,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { id: 'new-thread', repo: 'regit/web', onstart: fn(), onopenthread: fn() }
	});
</script>

{#snippet page(args: ComponentProps<typeof NewThreadPalette>)}
	<div style="block-size: 32rem; padding: 1rem">
		<Button variant="primary" icon aria-label="New thread" popovertarget="new-thread">
			<ThreadIcon plus />
		</Button>
		<NewThreadPalette {...args} />
	</div>
{/snippet}

<Story
	name="Open"
	args={{ similar: threads.slice(0, 2) }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		const input = canvas.getByRole('textbox', { name: 'What should change?' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.type(input, 'The settings page takes forever to load for big orgs');
		await expect(input).toBeVisible();
	}}
	template={page}
/>

<Story
	name="Start a thread"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		const input = canvas.getByRole('textbox', { name: 'What should change?' });
		await waitFor(() => expect(input).toHaveFocus());
		await userEvent.keyboard('Settings are slow{Shift>}{Enter}{/Shift}for big orgs{Enter}');
		await expect(args.onstart).toHaveBeenCalledWith({
			text: 'Settings are slow\nfor big orgs',
			mode: 'medium'
		});
		await waitFor(() => expect(input).not.toBeVisible());
	}}
	template={page}
/>

<Story
	name="Choose a mode"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Mode: Medium' }));
		await userEvent.click(await canvas.findByRole('menuitemradio', { name: /Large/ }));
		await waitFor(() => expect(canvas.getByRole('button', { name: 'Mode: Large' })).toBeVisible());

		await userEvent.type(
			canvas.getByRole('textbox', { name: 'What should change?' }),
			'Rewrite the router{Enter}'
		);
		await expect(args.onstart).toHaveBeenCalledWith({ text: 'Rewrite the router', mode: 'large' });
	}}
	template={page}
/>

<Story
	name="Similar threads"
	args={{ similar: threads.slice(0, 2) }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'What should change?' })).toHaveFocus()
		);
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect(args.onopenthread).toHaveBeenCalledWith(threads[0]);
	}}
	template={page}
/>

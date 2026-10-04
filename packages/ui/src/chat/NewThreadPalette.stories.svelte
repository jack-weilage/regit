<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, waitFor } from 'storybook/test';
	import Button from '../Button.svelte';
	import NewThreadPalette from './NewThreadPalette.svelte';
	import ThreadIcon from './ThreadIcon.svelte';
	import { similarThreads } from './fixtures.ts';

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
	args={{ similar: similarThreads.slice(2) }}
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
			mode: 'medium',
			machine: 'standard-1'
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
		await expect(args.onstart).toHaveBeenCalledWith({
			text: 'Rewrite the router',
			mode: 'large',
			machine: 'standard-1'
		});
	}}
	template={page}
/>

<Story
	name="Choose a machine"
	args={{ machine: 'standard-3' }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Machine: 2 vCPU · 8 GiB' }));
		await userEvent.click(await canvas.findByRole('menuitemradio', { name: /4 vCPU/ }));
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: 'Machine: 4 vCPU · 12 GiB' })).toBeVisible()
		);

		await userEvent.type(
			canvas.getByRole('textbox', { name: 'What should change?' }),
			'Upgrade the build toolchain{Enter}'
		);
		await expect(args.onstart).toHaveBeenCalledWith({
			text: 'Upgrade the build toolchain',
			mode: 'medium',
			machine: 'standard-4'
		});
	}}
	template={page}
/>

<Story
	name="Similar threads"
	args={{ similar: similarThreads.toReversed() }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		await waitFor(() =>
			expect(canvas.getByRole('textbox', { name: 'What should change?' })).toHaveFocus()
		);
		await userEvent.keyboard('{ArrowDown}{Enter}');
		await expect(canvas.getAllByRole('option')[1]).toHaveTextContent('Same goal · Running');
		await expect(args.onopenthread).toHaveBeenCalledWith(similarThreads[0]);
	}}
	template={page}
/>

<Story
	name="Auto"
	args={{ mode: 'auto', size: 'large', similar: similarThreads.slice(1, 2) }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'New thread' }));
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: 'Mode: Auto · Large' })).toBeVisible()
		);
	}}
	template={page}
/>

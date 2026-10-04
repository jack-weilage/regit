<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChatHeader from './ChatHeader.svelte';
	import { threads } from './fixtures.ts';

	const discard = fn();

	const { Story } = defineMeta({
		title: 'Chat/Header',
		component: ChatHeader,
		args: {
			headline: 'perf(settings): render org settings without loading every member',
			status: 'running',
			parent: threads[0],
			people: [
				{ name: 'Sam Rivera', kind: 'person' },
				{ name: 'Lin Wei', kind: 'person' }
			],
			actions: [
				{ label: 'Copy link', onselect: fn() },
				{ label: 'Try another approach', onselect: fn() },
				{
					label: 'Discard thread',
					detail: 'Stops the attempt, keeps the conversation',
					onselect: discard
				},
				{ label: 'Delete thread…', separated: true, danger: true, onselect: fn() }
			],
			onpreview: fn()
		}
	});
</script>

<Story
	name="Running"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Preview' }));
		await expect(args.onpreview).toHaveBeenCalledOnce();
		await userEvent.click(canvas.getByRole('button', { name: 'Thread actions' }));
		await waitFor(() => expect(canvas.getByRole('menuitem', { name: 'Copy link' })).toHaveFocus());
		await userEvent.keyboard('{ArrowUp}');
		await expect(canvas.getByRole('menuitem', { name: 'Delete thread…' })).toHaveFocus();
		await expect(canvas.getByRole('separator')).toBeInTheDocument();
		await userEvent.keyboard('{ArrowUp}');
		await expect(canvas.getByRole('menuitem', { name: /Discard thread/ })).toHaveFocus();
		await userEvent.keyboard('{Enter}');
		await expect(discard).toHaveBeenCalledOnce();
		await waitFor(() => expect(canvas.getByRole('menu')).not.toBeVisible());
	}}
/>

<Story name="Needs you" args={{ status: 'needs-you' }} />
<Story name="Shipped" args={{ status: 'shipped', onpreview: undefined }} />
<Story name="Draft" args={{ status: 'draft', parent: undefined, people: [], actions: [] }} />

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem">
		<ChatHeader
			headline="perf(settings): stop loading the full audit log on the settings page"
			status="shipping"
			parent={threads[0]}
			onpreview={fn()}
			actions={[{ label: 'Copy link', onselect: fn() }]}
		/>
	</div>
</Story>

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
			number: 1234,
			headline: 'perf(settings): render org settings without loading every member',
			status: 'running',
			parent: { ...threads[0]!, number: 7 },
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
		await expect(canvas.getByText('#1234')).toBeVisible();
		await expect(canvas.getByRole('heading')).not.toHaveTextContent('1234');
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
<Story name="Idle" args={{ status: 'needs-you', parent: undefined, people: [], actions: [] }} />

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem">
		<ChatHeader
			number={1234}
			headline="perf(settings): stop loading the full audit log on the settings page"
			status="shipping"
			parent={{ ...threads[0]!, number: 7 }}
			onpreview={fn()}
			actions={[{ label: 'Copy link', onselect: fn() }]}
		/>
	</div>
</Story>

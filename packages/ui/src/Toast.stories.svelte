<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import Toast from './Toast.svelte';

	const { Story } = defineMeta({
		title: 'Toast',
		component: Toast,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: { ondismiss: fn() }
	});
</script>

<Story
	name="Undo"
	args={{ action: { label: 'Undo', onclick: fn() } }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent('Deleted perf(settings)');
		await userEvent.click(canvas.getByRole('button', { name: 'Undo' }));
		await expect(args.action!.onclick).toHaveBeenCalledOnce();
		await expect(args.ondismiss).toHaveBeenCalledOnce();
	}}
>
	{#snippet template(args)}
		{@const { children: _, ...props } = args}
		<div style="block-size: 10rem">
			<Toast {...props}>Deleted <code>perf(settings): load members lazily</code></Toast>
		</div>
	{/snippet}
</Story>

<Story
	name="Expires"
	args={{ duration: 200 }}
	play={async ({ args }) => {
		await waitFor(() => expect(args.ondismiss).toHaveBeenCalledOnce());
	}}
>
	{#snippet template(args)}
		{@const { children: _, ...props } = args}
		<div style="block-size: 10rem">
			<Toast {...props}>Thread restored</Toast>
		</div>
	{/snippet}
</Story>

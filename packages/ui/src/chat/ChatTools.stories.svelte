<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatTools, { type ToolCallView } from './ChatTools.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Tool calls',
		component: ChatTools,
		tags: ['!autodocs']
	});

	const now = Date.now();
	const at = (seconds: number) => now - seconds * 1000;

	const working: ToolCallView[] = [
		{
			id: '1',
			verb: 'Searched for',
			target: 'loadMembers',
			status: 'done',
			startedAt: at(40),
			finishedAt: at(40)
		},
		{
			id: '2',
			verb: 'Read',
			target: 'src/lib/members.ts',
			status: 'done',
			startedAt: at(39),
			finishedAt: at(39)
		},
		{
			id: '3',
			verb: 'Edited',
			target: 'src/routes/settings/+page.server.ts',
			status: 'done',
			startedAt: at(30),
			finishedAt: at(30)
		},
		{ id: '4', verb: 'Running', target: 'bun run check', status: 'running', startedAt: at(27) }
	];

	const failed: ToolCallView[] = [
		{
			id: '1',
			verb: 'Ran',
			target: 'bun test src/lib/members.test.ts',
			status: 'failed',
			startedAt: at(12),
			finishedAt: at(4),
			output:
				'src/lib/members.test.ts:\n✗ loads the first page of members [3.1ms]\n  expected 50, received 5000\n\n0 pass\n1 fail'
		}
	];
</script>

<Story name="Working" args={{ calls: working }} />

<Story
	name="Folded"
	args={{ calls: working.slice(0, 3), summary: 'Searched once, read 1 file, edited 1 file' }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Searched once, read 1 file, edited 1 file'));
		await expect(canvas.getByText('src/lib/members.ts')).toBeVisible();
	}}
/>

<Story
	name="Failed command"
	args={{ calls: failed }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('bun test src/lib/members.test.ts'));
		await expect(canvas.getByText(/expected 50, received 5000/)).toBeVisible();
	}}
/>

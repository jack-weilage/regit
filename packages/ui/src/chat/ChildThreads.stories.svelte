<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor, within } from 'storybook/test';
	import ChatGroup from './ChatGroup.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import ChildThreads from './ChildThreads.svelte';
	import { childThreads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Child threads',
		component: ChildThreads,
		tags: ['!autodocs'],
		args: { threads: childThreads }
	});

	const many = Array.from({ length: 14 }, (_, index) => ({
		...childThreads[index % childThreads.length]!,
		id: `many-${index}`,
		number: 30 + index,
		href: `/regit/${30 + index}`,
		headline: `${childThreads[index % childThreads.length]!.headline || 'chore: tidy'} (${index + 1})`
	}));
</script>

<Story
	name="Mixed states"
	play={async ({ canvas }) => {
		const board = canvas.getByRole('region', { name: 'Spun-off threads 6' });
		const rows = within(board).getAllByRole('listitem');
		await expect(rows).toHaveLength(6);

		const working = within(rows[0]!);
		await expect(
			working.getByRole('link', { name: '#12 feat(ui): board of child threads' })
		).toHaveAttribute('href', '/regit/12');
		await expect(rows[0]).toHaveTextContent('Working');
		await expect(rows[0]).toHaveTextContent('1/4 met');
		await expect(rows[0]).toHaveTextContent('Not shipped');
		await expect(
			working.getByRole('link', { name: 'storybook preview of feat(ui): board of child threads' })
		).toHaveAttribute('href', 'https://c1-storybook.regit.run');

		await expect(rows[1]).toHaveTextContent('Needs you');
		await expect(within(rows[1]!).getAllByRole('link')).toHaveLength(3);
		await expect(rows[2]).toHaveTextContent('Shipping');
		await expect(rows[2]).not.toHaveTextContent('Not shipped');
		await expect(rows[3]).toHaveTextContent('4b02e7a Deployed');
		await expect(rows[4]).toHaveTextContent('9f1c2d3 Broke main');
		await expect(within(rows[5]!).getByRole('link', { name: '#17 New thread' })).toBeVisible();
		await expect(rows[5]).not.toHaveTextContent('met');
	}}
/>

<Story
	name="Empty"
	args={{ threads: [] }}
	play={async ({ canvas }) => {
		const board = canvas.getByRole('region', { name: 'Spun-off threads 0' });
		await expect(board).toHaveTextContent('No threads launched from this one yet.');
		await expect(canvas.queryByRole('list')).toBeNull();
	}}
/>

<Story
	name="Many children"
	args={{ threads: many }}
	play={async ({ canvas, userEvent }) => {
		const rows = () => canvas.getAllByRole('listitem');
		await expect(rows()).toHaveLength(6);
		await userEvent.click(canvas.getByRole('button', { name: 'Show 8 more' }));
		await waitFor(() => expect(rows()).toHaveLength(14));
		await userEvent.click(canvas.getByRole('button', { name: 'Show fewer' }));
		await waitFor(() => expect(rows()).toHaveLength(6));
	}}
/>

<Story name="In thread" asChild>
	<div style="max-inline-size: 46rem; display: grid">
		<ChatLog label="Thread messages">
			<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}>
				<ChatMessage>I split the demo prep into four threads.</ChatMessage>
			</ChatGroup>
			<ChildThreads threads={childThreads} />
		</ChatLog>
	</div>
</Story>

<Story name="Narrow" asChild>
	<div style="max-inline-size: 20rem; display: grid">
		<ChildThreads threads={childThreads} />
	</div>
</Story>

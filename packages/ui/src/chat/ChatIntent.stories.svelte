<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChatGroup from './ChatGroup.svelte';
	import ChatIntent from './ChatIntent.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import { similarThreads } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Intent',
		component: ChatIntent,
		args: {
			headline: 'perf(settings): render org settings without loading every member',
			purpose: 'Large orgs wait several seconds before the settings page shows anything.',
			doneWhen: ['Settings loads in under a second for an org with 5,000 members.']
		}
	});

	const progress = {
		headline: 'perf(settings): load members lazily',
		purpose: 'The settings page loads every member before rendering, which takes seconds.',
		doneWhen: [
			'Settings render in under a second for 10k members',
			'Members load as you scroll',
			'Existing member tests still pass'
		]
	};
</script>

<Story
	name="Suggested"
	args={{
		similar: similarThreads.slice(2)
	}}
	play={async ({ args, canvas, userEvent }) => {
		await expect(
			canvas.getByText('Settings loads in under a second for an org with 5,000 members.')
		).toBeVisible();
		await userEvent.click(canvas.getByText('Related · 2'));
		await expect(canvas.getByRole('link', { name: /Cache org settings/ })).toBeVisible();
	}}
/>

<Story name="Started" />

<Story
	name="Superseded"
	args={{ superseded: true }}
	play={async ({ args, canvas }) => {
		await expect(canvas.getByText(args.headline).tagName).toBe('S');
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Several checks"
	args={{
		headline: 'feat(threads): suggest a reviewer from recent landings',
		purpose: 'Threads sit unclaimed until someone notices them.',
		doneWhen: [
			'New threads show a suggested reviewer within a minute.',
			'The suggestion comes from people who landed changes in the same area.',
			'Dismissing a suggestion never assigns anyone.'
		]
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem">
		<ChatIntent
			headline="refactor(auth): move session checks into hooks"
			purpose="Every route repeats the same session lookup."
			doneWhen={['No route handler reads the session cookie directly.', 'All existing tests pass.']}
		/>
	</div>
</Story>

<Story
	name="Separate work"
	args={{
		handoff: true,
		headline: 'perf(settings): stop loading the full audit log',
		purpose: 'It changes the audit log query, not member loading.',
		doneWhen: ['Settings makes one audit log query that returns a single row.'],
		onstart: fn(),
		ondismiss: fn()
	}}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Spin off' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Dismiss' }));
		await expect(args.onstart).toHaveBeenCalledOnce();
		await expect(args.ondismiss).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Working"
	args={{
		...progress,
		status: 'working',
		note: 'The agent is working'
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('region', { name: 'Intent' })).toBeVisible();
	}}
/>

<Story
	name="Needs you"
	args={{
		...progress,
		status: 'needs-you'
	}}
/>

<Story
	name="Ready"
	args={{
		...progress,
		status: 'ready',
		note: 'Exact candidate awaits owner approval',
		changes: { files: 4, additions: 23, deletions: 8 },
		onchanges: fn()
	}}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /View changes: 4 files/ }));
		await expect(args.onchanges).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Shipping"
	args={{
		...progress,
		status: 'shipping',
		note: 'Preparing candidate or publishing approved SHA',
		changes: { files: 4, additions: 23, deletions: 8 }
	}}
/>

<Story
	name="Shipped"
	args={{
		...progress,
		status: 'shipped',
		note: 'Shipped to main in a1b2c3d',
		changes: { files: 4, additions: 23, deletions: 8 }
	}}
/>

<Story
	name="Sticky"
	asChild
	play={async ({ canvas, canvasElement, userEvent }) => {
		const log = canvasElement.querySelector<HTMLElement>('[role=log]')!;
		const card = () => canvas.getByRole('region', { name: 'Intent' });
		const toggle = await canvas.findByRole('button', { name: /load members lazily/ });
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(card()).toHaveClass('minimized');

		await userEvent.click(toggle);
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await waitFor(() => expect(canvas.getByText('Members load as you scroll')).toBeVisible());

		log.scrollTop = -log.scrollHeight;
		await waitFor(() => expect(card()).not.toHaveClass('stuck'));
		await expect(canvas.queryByRole('button', { name: /load members lazily/ })).toBeNull();
	}}
>
	<div style="display: grid; block-size: 28rem; inline-size: 36rem">
		<ChatLog label="Thread messages">
			<ChatGroup author={{ name: 'Sam Rivera', kind: 'person' }}>
				<ChatMessage>The settings page takes forever to load for big orgs.</ChatMessage>
			</ChatGroup>
			<ChatIntent {...progress} sticky status="working" note="The agent is working" />
			{#each Array.from({ length: 12 }, (_, index) => index) as index (index)}
				<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}>
					<ChatMessage
						>Paging the member query with a cursor and rendering the first page immediately.</ChatMessage
					>
				</ChatGroup>
			{/each}
		</ChatLog>
	</div>
</Story>

<Story
	name="Duplicate"
	args={{ similar: similarThreads, onmessage: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('note')).toHaveTextContent(
			'Same goal as perf(settings): load org members in pages Running'
		);
		await userEvent.click(canvas.getByRole('button', { name: /Message perf\(settings\)/ }));
		await expect(args.onmessage).toHaveBeenCalledWith(similarThreads[0]);
	}}
/>

<Story
	name="Already shipped"
	args={{
		similar: [
			{ ...similarThreads[0]!, status: 'shipped', detail: 'Shipped in 4f2a91c' },
			similarThreads[3]!
		],
		onmessage: fn()
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('note')).toHaveTextContent('Shipped in 4f2a91c');
		await expect(canvas.queryByRole('button', { name: /Message/ })).toBeNull();
	}}
/>

<Story
	name="Overlaps"
	args={{ similar: [similarThreads[1]!], onmessage: fn() }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /Message feat\(api\)/ }));
		await expect(args.onmessage).toHaveBeenCalledWith(similarThreads[1]);
	}}
/>

<Story
	name="Awaiting approval"
	args={{ ...progress, status: 'ready', note: 'Exact candidate awaits owner approval' }}
/>

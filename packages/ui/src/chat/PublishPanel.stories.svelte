<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import PublishPanel from './PublishPanel.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatIntent from './ChatIntent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import { intent, readyPromotion } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Publish',
		component: PublishPanel,
		tags: ['!autodocs'],
		args: {
			promotions: [],
			intent,
			status: 'needs-you',
			hasChanges: true,
			onprepare: fn().mockResolvedValue(undefined),
			onapprove: fn().mockResolvedValue(undefined)
		}
	});
</script>

<Story
	name="Prepare candidate"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Prepare candidate' }));
		await expect(canvas.getByRole('textbox', { name: 'Commit title' })).toHaveValue(
			intent.headline
		);
		await userEvent.clear(canvas.getByRole('textbox', { name: 'Commit title' }));
		await userEvent.type(
			canvas.getByRole('textbox', { name: 'Commit title' }),
			'perf: paginate members'
		);
		await userEvent.clear(canvas.getByRole('textbox', { name: 'Commit body' }));
		await userEvent.type(
			canvas.getByRole('textbox', { name: 'Commit body' }),
			'Avoid blocking settings.'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Prepare candidate' }));
		await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Commit title' })).toBeNull());
		await expect(args.onprepare).toHaveBeenCalledWith({
			title: 'perf: paginate members',
			body: 'Avoid blocking settings.'
		});
		await expect(args.onapprove).not.toHaveBeenCalled();
	}}
/>

<Story
	name="Working"
	args={{ status: 'running' }}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Preparation form"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Prepare candidate' }));
	}}
/>

<Story
	name="Queued"
	args={{
		status: 'shipping',
		promotions: [{ ...readyPromotion, status: 'queued', candidate: null }]
	}}
/>
<Story
	name="Preparing"
	args={{
		status: 'shipping',
		promotions: [{ ...readyPromotion, status: 'preparing', candidate: null }]
	}}
/>

<Story
	name="Ready"
	args={{ promotions: [readyPromotion] }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Candidate history'));
		await expect(canvas.getByText(readyPromotion.candidate!.expectedHead)).toBeVisible();
		await expect(canvas.queryByRole('button', { name: 'Prepare candidate' })).toBeNull();
		await userEvent.click(canvas.getByRole('button', { name: /^Approve and publish/ }));
		await expect(args.onapprove).toHaveBeenCalledWith('promotion-1');
		await expect(args.onprepare).not.toHaveBeenCalled();
	}}
/>

<Story
	name="Publication failed"
	args={{
		promotions: [
			{
				...readyPromotion,
				status: 'failed',
				error: 'Main moved after preparation. Prepare a new candidate before publishing.'
			}
		]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('alert')).toHaveTextContent('Main moved after preparation');
		await expect(canvas.queryByRole('button', { name: /^Approve and publish/ })).toBeNull();
		await expect(canvas.getByRole('button', { name: 'Prepare candidate' })).toBeEnabled();
	}}
/>
<Story
	name="Cancelled"
	args={{ promotions: [{ ...readyPromotion, status: 'cancelled', candidate: null }] }}
/>

<Story
	name="Candidate history"
	args={{
		promotions: [
			{
				...readyPromotion,
				id: 'promotion-old',
				status: 'failed',
				error: 'Main moved before publication.',
				candidate: { ...readyPromotion.candidate!, sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }
			},
			readyPromotion
		]
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Candidate history'));
		await expect(canvas.getByText('Candidate promotion-old · failed')).toBeVisible();
		await expect(canvas.getByText('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeVisible();
		await expect(canvas.getByText('Main moved before publication.')).toBeVisible();
		await expect(
			canvas.getByRole('button', { name: 'Approve and publish a1b2c3d4e5f6' })
		).toBeVisible();
	}}
/>

<Story
	name="Publishing"
	args={{ status: 'shipping', promotions: [{ ...readyPromotion, status: 'publishing' }] }}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Published"
	args={{
		status: 'shipped',
		hasChanges: false,
		promotions: [{ ...readyPromotion, status: 'shipped', notesPublished: true }]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Approval error"
	args={{
		promotions: [readyPromotion],
		onapprove: fn(async () => {
			throw new Error('Repository owner permission is required');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /^Approve and publish/ }));
		await waitFor(() =>
			expect(canvas.getByRole('alert')).toHaveTextContent('Repository owner permission is required')
		);
		await expect(canvas.getByRole('button', { name: /^Approve and publish/ })).toBeEnabled();
	}}
/>

<Story
	name="Busy"
	args={{ promotions: [readyPromotion], onapprove: fn(() => new Promise(() => {})) }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /^Approve and publish/ }));
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: /^Approve and publish/ })).toBeDisabled()
		);
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem; max-inline-size: 100%">
		<PublishPanel
			promotions={[readyPromotion]}
			{intent}
			status="needs-you"
			hasChanges
			onprepare={fn().mockResolvedValue(undefined)}
			onapprove={fn().mockResolvedValue(undefined)}
		/>
	</div>
</Story>

<Story name="In thread" asChild>
	<div style="max-inline-size: 46rem; block-size: 42rem; display: grid">
		<ChatLog label="Thread messages">
			<ChatGroup author={{ name: 'Sam Rivera', kind: 'person' }}
				><ChatMessage>Settings takes too long to open. Load members separately.</ChatMessage
				></ChatGroup
			>
			<ChatIntent {...intent} status="ready" note="Exact candidate awaits owner approval" />
			<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}
				><ChatMessage>Members now load as you scroll; the checks pass.</ChatMessage></ChatGroup
			>
			<PublishPanel
				promotions={[readyPromotion]}
				{intent}
				status="needs-you"
				hasChanges
				onprepare={fn().mockResolvedValue(undefined)}
				onapprove={fn().mockResolvedValue(undefined)}
			/>
		</ChatLog>
	</div>
</Story>

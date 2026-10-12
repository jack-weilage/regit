<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import AcceptancePanel from './AcceptancePanel.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatIntent from './ChatIntent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import { acceptance, readyPromotion, prerequisite, waitingDependency } from './fixtures.ts';

	const { Story } = defineMeta({
		title: 'Chat/Acceptance',
		component: AcceptancePanel,
		tags: ['!autodocs'],
		args: {
			control: acceptance,
			intent: acceptance.acceptedIntent!.intent,
			status: 'needs-you',
			hasChanges: true,
			onaccept: fn().mockResolvedValue(undefined),
			onstart: fn().mockResolvedValue(undefined),
			onprepare: fn().mockResolvedValue(undefined),
			onapprove: fn().mockResolvedValue(undefined)
		}
	});
	const ready = { ...acceptance, promotions: [readyPromotion] };
	const dependencyActions = {
		proposals: [prerequisite],
		onpin: fn().mockResolvedValue(undefined),
		onunpin: fn().mockResolvedValue(undefined)
	};
</script>

<Story
	name="Add dependency"
	args={dependencyActions}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('button', { name: 'Pin current revision' })).toBeDisabled();
		await userEvent.selectOptions(
			canvas.getByRole('combobox', { name: 'Prerequisite proposal' }),
			prerequisite.id
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Pin current revision' }));
		await expect(args.onpin).toHaveBeenCalledWith(prerequisite.id);
	}}
/>
<Story
	name="Waiting dependency"
	args={{ ...dependencyActions, control: { ...acceptance, dependencies: [waitingDependency] } }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('button', { name: 'Start new run' })).toBeDisabled();
		await expect(canvas.getByRole('button', { name: 'Prepare candidate' })).toBeDisabled();
		await userEvent.click(canvas.getByRole('button', { name: 'Update pin' }));
		await expect(args.onpin).toHaveBeenCalledWith(prerequisite.id);
		await userEvent.click(canvas.getByRole('button', { name: 'Remove dependency' }));
		await expect(args.onunpin).toHaveBeenCalledWith(prerequisite.id);
	}}
/>
<Story
	name="Ready dependency"
	args={{
		...dependencyActions,
		control: {
			...acceptance,
			dependencies: [
				{
					...waitingDependency,
					status: 'ready',
					reason: 'Pinned revision published.',
					published: 'a'.repeat(40)
				}
			]
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Start new run' })).toBeEnabled();
		await expect(canvas.getByRole('button', { name: 'Prepare candidate' })).toBeEnabled();
	}}
/>
<Story
	name="Stale dependency"
	args={{
		...dependencyActions,
		control: {
			...ready,
			dependencies: [
				{
					...waitingDependency,
					status: 'stale',
					reason: 'Accepted intent changed; repin and start a new run.'
				}
			]
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: /^Approve and publish/ })).toBeDisabled();
		await expect(canvas.getByRole('button', { name: 'Start new run' })).toBeDisabled();
	}}
/>
<Story
	name="Changed pins"
	args={{
		...dependencyActions,
		control: { ...acceptance, acceptedIntent: { ...acceptance.acceptedIntent!, id: 'repinned' } }
	}}
	play={async ({ canvas }) => {
		await expect(
			canvas.getByText(
				'Intent or dependency pins changed. Start a new run before preparing a candidate.'
			)
		).toBeVisible();
		await expect(canvas.getByRole('button', { name: 'Prepare candidate' })).toBeDisabled();
		await expect(canvas.getByRole('button', { name: 'Start new run' })).toBeEnabled();
	}}
/>

<Story
	name="Queued"
	args={{
		status: 'shipping',
		control: {
			...acceptance,
			promotions: [{ ...readyPromotion, status: 'queued', candidate: null }]
		}
	}}
/>
<Story
	name="Preparing"
	args={{
		status: 'shipping',
		control: {
			...acceptance,
			promotions: [{ ...readyPromotion, status: 'preparing', candidate: null }]
		}
	}}
/>
<Story
	name="Publication failed"
	args={{
		control: {
			...acceptance,
			promotions: [
				{
					...readyPromotion,
					status: 'failed',
					error: 'Main moved after preparation. Prepare a new candidate before publishing.'
				}
			]
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('alert')).toHaveTextContent('Main moved after preparation');
		await expect(canvas.queryByRole('button', { name: /^Approve and publish/ })).toBeNull();
		await expect(canvas.getByRole('button', { name: 'Prepare candidate' })).toBeEnabled();
	}}
/>
<Story
	name="Cancelled"
	args={{
		control: {
			...acceptance,
			promotions: [{ ...readyPromotion, status: 'cancelled', candidate: null }]
		}
	}}
/>
<Story
	name="Candidate history"
	args={{
		control: {
			...acceptance,
			promotions: [
				{
					...readyPromotion,
					id: 'promotion-old',
					status: 'failed',
					error: 'Main moved before publication.',
					candidate: {
						...readyPromotion.candidate!,
						sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
					}
				},
				readyPromotion
			]
		}
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Provenance and history'));
		await userEvent.click(canvas.getByText('Candidate promotion-old · failed'));
		await expect(canvas.getByText('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeVisible();
		await expect(
			canvas.getByRole('button', { name: 'Approve and publish a1b2c3d4e5f6' })
		).toBeVisible();
	}}
/>

<Story
	name="Empty"
	args={{ control: undefined, intent: undefined, status: 'draft', hasChanges: false }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('No intent has been accepted yet.')).toBeVisible();
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Draft"
	args={{ control: undefined, status: 'draft', hasChanges: false }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByText('No intent has been accepted yet.')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Accept proposed intent' }));
		await expect(args.onaccept).toHaveBeenCalledOnce();
		await userEvent.click(canvas.getByRole('button', { name: 'Accept intent and start new run' }));
		await expect(args.onstart).toHaveBeenCalledOnce();
		await expect(args.onprepare).not.toHaveBeenCalled();
	}}
/>

<Story
	name="Accepted"
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.queryByRole('button', { name: 'Accept proposed intent' })).toBeNull();
		await userEvent.click(canvas.getByText('Provenance and history'));
		await userEvent.click(canvas.getByText('Run history and retained revisions'));
		await expect(canvas.getByText(acceptance.revisions[0]!.sha)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Start new run' }));
		await expect(args.onstart).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Changed intent"
	args={{
		intent: { ...acceptance.acceptedIntent!.intent, headline: 'perf(settings): cache member pages' }
	}}
/>

<Story
	name="Prepare candidate"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Prepare candidate' }));
		await expect(canvas.getByRole('textbox', { name: 'Commit title' })).toHaveValue(
			acceptance.acceptedIntent!.intent.headline
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
	name="Preparation form"
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Prepare candidate' }));
	}}
/>

<Story
	name="Ready"
	args={{ control: ready }}
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByText('Provenance and history'));
		await expect(canvas.getByText(readyPromotion.candidate!.expectedHead)).toBeVisible();
		await expect(canvas.queryByRole('button', { name: 'Prepare candidate' })).toBeNull();
		await userEvent.click(canvas.getByText('Provenance and history'));
		await userEvent.click(canvas.getByRole('button', { name: /^Approve and publish/ }));
		await expect(args.onapprove).toHaveBeenCalledWith('promotion-1');
		await expect(args.onprepare).not.toHaveBeenCalled();
	}}
/>

<Story
	name="Publishing"
	args={{
		status: 'shipping',
		control: { ...acceptance, promotions: [{ ...readyPromotion, status: 'publishing' }] }
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Published"
	args={{
		status: 'shipped',
		control: {
			...acceptance,
			promotions: [{ ...readyPromotion, status: 'shipped', notesPublished: true }]
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.queryByRole('button')).toBeNull();
	}}
/>

<Story
	name="Approval error"
	args={{
		control: ready,
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
	args={{ control: ready, onapprove: fn(() => new Promise(() => {})) }}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /^Approve and publish/ }));
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: /^Approve and publish/ })).toBeDisabled()
		);
		await expect(canvas.getByRole('button', { name: 'Start new run' })).toBeDisabled();
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem; max-inline-size: 100%">
		<AcceptancePanel
			control={ready}
			intent={acceptance.acceptedIntent!.intent}
			status="needs-you"
			hasChanges
			onaccept={fn().mockResolvedValue(undefined)}
			onstart={fn().mockResolvedValue(undefined)}
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
			<ChatIntent {...acceptance.acceptedIntent!.intent} status="working" note="Accepted intent" />
			<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}
				><ChatMessage>The candidate is prepared. Review it before publishing.</ChatMessage
				></ChatGroup
			>
			<AcceptancePanel
				control={ready}
				intent={acceptance.acceptedIntent!.intent}
				status="needs-you"
				hasChanges
				onaccept={fn().mockResolvedValue(undefined)}
				onstart={fn().mockResolvedValue(undefined)}
				onprepare={fn().mockResolvedValue(undefined)}
				onapprove={fn().mockResolvedValue(undefined)}
			/>
		</ChatLog>
	</div>
</Story>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor, within } from 'storybook/test';
	import ChangesPanel from './ChangesPanel.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatHeader from './ChatHeader.svelte';
	import ChatIntent, { type IntentStatus } from './ChatIntent.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import ChatReview from './ChatReview.svelte';
	import ShipDialog from './ShipDialog.svelte';
	import { diffFiles } from './fixtures.ts';
	import type { Author, ThreadStatus } from './types.ts';

	const sam: Author = { name: 'Sam Rivera', kind: 'person' };
	const agent: Author = { name: 'ReGit', kind: 'agent' };

	const intent = {
		headline: 'perf(settings): load members lazily',
		purpose:
			'The settings page loaded every member before rendering, which took seconds for large orgs.',
		doneWhen: [
			'Settings render in under a second for 10k members',
			'Members load as you scroll',
			'Existing member tests still pass'
		]
	};

	const changes = {
		files: diffFiles.length,
		additions: diffFiles.reduce((sum, file) => sum + file.additions, 0),
		deletions: diffFiles.reduce((sum, file) => sum + file.deletions, 0)
	};

	type Phase = 'ready' | 'shipping' | 'shipped' | 'resolving';

	const { Story } = defineMeta({
		title: 'Chat/Ship flow',
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	let phase = $state<Phase>('ready');
	let panel = $state(false);
	let dialog = $state(false);
	let rounds = $state(1);
	let events = $state<string[]>([]);

	const intentStatus: Record<Phase, IntentStatus> = {
		ready: 'ready',
		shipping: 'shipping',
		shipped: 'shipped',
		resolving: 'working'
	};

	const threadStatus: Record<Phase, ThreadStatus> = {
		ready: 'needs-you',
		shipping: 'shipping',
		shipped: 'shipped',
		resolving: 'running'
	};

	const notes: Record<Phase, string> = {
		ready: 'Reviewed · ready to ship',
		shipping: 'Shipping to main',
		shipped: 'Shipped to main in a1b2c3d',
		resolving: 'Resolving conflicts'
	};

	function ship(conflict: boolean) {
		panel = false;
		phase = 'shipping';
		setTimeout(() => {
			if (conflict && rounds === 1) {
				events = [...events, 'Conflicts with main in 1 file'];
				phase = 'resolving';
				setTimeout(() => {
					rounds = 2;
					events = [...events, 'Rebased onto main'];
					phase = 'ready';
				}, 1500);
				return;
			}
			events = [...events, 'Shipped to main in a1b2c3d by Sam Rivera'];
			phase = 'shipped';
		}, 1200);
	}
</script>

{#snippet flow(conflict: boolean)}
	<div class={['frame', { split: panel }]}>
		<div class="thread">
			<ChatHeader
				headline={intent.headline}
				status={threadStatus[phase]}
				people={[sam]}
				actions={[{ label: 'Copy link', onselect: () => {} }]}
			/>
			<ChatLog label="Thread messages">
				<ChatGroup author={sam} own>
					<ChatMessage><p>The settings page takes forever to load for big orgs.</p></ChatMessage>
				</ChatGroup>
				<ChatIntent
					{...intent}
					sticky
					status={intentStatus[phase]}
					checks={['met', 'met', 'met']}
					note={notes[phase]}
					{changes}
					onchanges={() => (panel = true)}
					onship={phase === 'ready' ? () => (dialog = true) : undefined}
				/>
				<ChatEvent>Started the attempt</ChatEvent>
				<ChatGroup author={agent}>
					<ChatMessage>
						<p>
							Members now load in pages of 50 and the settings page renders in 180ms for 10k
							members. Tests pass.
						</p>
					</ChatMessage>
				</ChatGroup>
				<ChatReview
					verdict="passed"
					round={1}
					doneWhen={intent.doneWhen}
					checks={['met', 'met', 'met']}
				/>
				{#each events as event (event)}
					<ChatEvent>{event}</ChatEvent>
				{/each}
			</ChatLog>
			<div class="bottom">
				<ChatComposer
					placeholder="Reply to ReGit"
					working={phase === 'shipping' || phase === 'resolving'}
					onsend={() => {}}
					onstop={() => {}}
				/>
			</div>
		</div>
		{#if panel}
			<div class="panel">
				<ChangesPanel
					files={diffFiles}
					onship={phase === 'ready' ? () => (dialog = true) : undefined}
					onclose={() => (panel = false)}
				/>
			</div>
		{/if}
	</div>
	<ShipDialog
		bind:open={dialog}
		repo="regit/web"
		headline={intent.headline}
		body={intent.purpose}
		{...changes}
		review={{ verdict: 'pass', met: 3, total: 3 }}
		behind={conflict ? 2 : 0}
		onship={() => ship(conflict)}
	/>
{/snippet}

<Story
	name="Ready to ship"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: /View changes/ }));
		const changes = await canvas.findByRole('region', { name: 'Changes' });
		await expect(changes).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Close changes' }));
		await waitFor(() => expect(canvas.queryByRole('region', { name: 'Changes' })).toBeNull());
	}}
>
	{@render flow(false)}
</Story>

<Story
	name="Ship"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		const dialog = await canvas.findByRole('dialog', { name: 'Ship to main?' });
		await userEvent.click(within(dialog).getByRole('button', { name: 'Ship' }));
		await waitFor(() => expect(canvas.getByText('Shipping to main')).toBeVisible());
		await waitFor(() => expect(canvas.getByText('Shipped to main in a1b2c3d')).toBeVisible(), {
			timeout: 3000
		});
		await waitFor(() =>
			expect(canvas.getByText('Shipped to main in a1b2c3d by Sam Rivera')).toBeVisible()
		);
	}}
>
	{@render flow(false)}
</Story>

<Story
	name="Conflict"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		const dialog = await canvas.findByRole('dialog', { name: 'Ship to main?' });
		await userEvent.click(within(dialog).getByRole('button', { name: 'Ship' }));
		await waitFor(() => expect(canvas.getByText('Resolving conflicts')).toBeVisible(), {
			timeout: 3000
		});
		await waitFor(() => expect(canvas.getByText('Rebased onto main')).toBeVisible(), {
			timeout: 3000
		});
		await expect(canvas.getByRole('button', { name: 'Ship' })).toBeVisible();
	}}
>
	{@render flow(true)}
</Story>

<style>
	.frame {
		container: flow / inline-size;
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		block-size: 100dvh;
		overflow: hidden;

		&.split {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
		}
	}

	.thread {
		display: flex;
		flex-direction: column;
		min-inline-size: 0;
		min-block-size: 0;

		> :global([role='log']) {
			flex: 1;
			min-block-size: 0;
		}
	}

	.bottom {
		display: grid;
		padding: 0 var(--space-6) var(--space-4);
	}

	.panel {
		min-inline-size: 0;
		min-block-size: 0;
		border-inline-start: 1px solid var(--color-border);
	}

	@container flow (width < 60rem) {
		.split .thread {
			grid-column: 1 / -1;
			grid-row: 1;
		}

		.panel {
			grid-column: 1 / -1;
			grid-row: 1;
			z-index: 2;
			border-inline-start: 0;
		}
	}
</style>

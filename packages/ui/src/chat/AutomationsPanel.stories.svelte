<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import AutomationsPanel from './AutomationsPanel.svelte';
	import ChatAutomation from './ChatAutomation.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatHeader from './ChatHeader.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import { automations, automationsNow, endedAutomations } from './fixtures.ts';
	import type { Author } from './types.ts';

	const sam: Author = { name: 'Sam Rivera', kind: 'person' };
	const agent: Author = { name: 'ReGit', kind: 'agent' };

	const { Story } = defineMeta({
		title: 'Chat/Automations panel',
		component: AutomationsPanel,
		tags: ['!autodocs'],
		args: { oncancel: fn() }
	});
</script>

<Story
	name="Active"
	args={{ automations: [...automations, ...endedAutomations], now: automationsNow }}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByRole('region', { name: 'Automations' })).toBeVisible();
		await expect(canvas.getByText('Next in 21 hours · 2 of 5 runs · ends Oct 26')).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel flaky-e2e' }));
		await expect(args.oncancel).toHaveBeenCalledWith('e5f6a7b8');
		await userEvent.click(canvas.getByText('2 ended'));
		await waitFor(() => expect(canvas.getByText('Cancelled by Sam Rivera')).toBeVisible());
	}}
/>

<Story
	name="Compact"
	args={{ automations, now: automationsNow, compact: true }}
	play={async ({ canvas, userEvent }) => {
		const summary = canvas.getByText('3 automations · next in 21 hours');
		await expect(canvas.getByRole('button', { name: 'Cancel flaky-e2e' })).not.toBeVisible();
		await userEvent.click(summary);
		await waitFor(() =>
			expect(canvas.getByRole('button', { name: 'Cancel flaky-e2e' })).toBeVisible()
		);
	}}
/>

<Story name="Waiting for an event" args={{ automations: [automations[0]!], now: automationsNow }} />

<Story name="Cancelling" args={{ automations, now: automationsNow, busy: 'e5f6a7b8' }} />

<Story name="Only ended" args={{ automations: endedAutomations, now: automationsNow }} />

<Story name="In a thread" parameters={{ layout: 'fullscreen' }}>
	{#snippet template(args)}
		<div class="frame">
			<ChatHeader headline="perf(settings): load members lazily" number={12} status="shipped" />
			<ChatLog label="Thread">
				<ChatGroup author={sam}>
					<ChatMessage>Ship it, and check on these changes after they deploy.</ChatMessage>
				</ChatGroup>
				<ChatGroup author={agent}>
					<ChatMessage
						>I'll check error rates and the settings page 15 minutes after it deploys.</ChatMessage
					>
				</ChatGroup>
				<ChatEvent
					time={new Date(automationsNow - 40 * 60_000)}
					text="Shipped `4f2a9c1` to `main`"
				/>
				<ChatAutomation
					name="post-deploy-check"
					trigger="15m after what this thread shipped deploys"
					run={1}
					limit={1}
					time={new Date(automationsNow)}
				>
					<ChatMessage
						>Check error rates and how long the settings page takes to load against the deploy.</ChatMessage
					>
				</ChatAutomation>
				<ChatGroup author={agent}>
					<ChatMessage
						>4f2a9c1 has been live for 15 minutes: no new errors, and settings render in 0.4s, down
						from 3.1s.</ChatMessage
					>
				</ChatGroup>
			</ChatLog>
			<div class="composer">
				<AutomationsPanel
					{...args}
					automations={automations.slice(1)}
					now={automationsNow}
					compact
				/>
				<ChatComposer onsend={() => {}} />
			</div>
		</div>
	{/snippet}
</Story>

<style>
	.frame {
		display: flex;
		flex-direction: column;
		inline-size: 44rem;
		max-inline-size: 100%;
		block-size: 100dvh;
		margin-inline: auto;
		overflow: hidden;
		border-inline: 1px solid var(--color-border);
	}

	.composer {
		display: grid;
		gap: var(--space-3);
		padding: 0 var(--space-6) var(--space-5);
	}
</style>

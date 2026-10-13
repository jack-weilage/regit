<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ChatActivity from './ChatActivity.svelte';
	import ChatComposer from './ChatComposer.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatFooter from './ChatFooter.svelte';
	import ChatHeader from './ChatHeader.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatIntent from './ChatIntent.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMention from './ChatMention.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import ShipPanel from './ShipPanel.svelte';
	import { intent as members, mentionables, similarThreads } from './fixtures.ts';
	import type { ThreadStatus } from '@regit/core';
	import type { Author, Mentionable, SimilarThread } from './types.ts';

	interface Intent {
		headline: string;
		purpose: string;
		doneWhen: string[];
		similar?: SimilarThread[];
	}

	type Entry =
		| { type: 'message'; id: string; author: Author; text: string }
		| { type: 'intent'; id: string; intent: Intent }
		| { type: 'handoff'; id: string; intent: Intent; outcome?: 'dismissed' | Mentionable }
		| { type: 'event'; id: string; text: string };

	type Block =
		| { type: 'group'; id: string; author: Author; messages: { id: string; text: string }[] }
		| Exclude<Entry, { type: 'message' }>;

	const sam: Author = { name: 'Sam Rivera', kind: 'person' };
	const lin: Author = { name: 'Lin Wei', kind: 'person' };
	const agent: Author = { name: 'ReGit', kind: 'agent' };

	const revisions: Intent[] = [
		{
			...members,
			similar: [similarThreads[3]!]
		},
		{
			headline: 'perf(settings): stop loading the full audit log on the settings page',
			purpose: 'The settings page fetches every audit log entry to show the last change.',
			doneWhen: [
				'Settings makes one audit log query that returns a single row.',
				'The last change is still shown with its author and time.'
			]
		}
	];

	const separateWork: Intent = {
		headline: 'perf(settings): stop loading the full audit log',
		purpose: 'It changes the audit log query, not member loading.',
		doneWhen: ['Settings makes one audit log query that returns a single row.']
	};

	const id = () => crypto.randomUUID();

	function parts(text: string): (string | Mentionable)[] {
		return text.split(/(@[\w-]+)/).map((part) => {
			const mention = mentionables.find((item) => `@${item.handle}` === part);
			return mention ?? part;
		});
	}

	const { Story } = defineMeta({
		title: 'Chat/Thread',
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	let entries: Entry[] = $state.raw([
		{ type: 'message', id: id(), author: sam, text: 'The settings page takes forever to load.' },
		{
			type: 'message',
			id: id(),
			author: sam,
			text: 'Especially for orgs with thousands of members.'
		},
		{ type: 'message', id: id(), author: lin, text: 'I see this on the Acme org too, @sam.' },
		{
			type: 'message',
			id: id(),
			author: lin,
			text: 'Might be the same cause as @paginate-member-list.'
		},
		{ type: 'intent', id: id(), intent: revisions[0]! }
	]);
	let started = $state(false);
	let status = $state<ThreadStatus>('needs-you');
	let intent = $derived(entries.findLast((entry) => entry.type === 'intent')!.intent);

	let latestIntent = $derived(entries.findLast((entry) => entry.type === 'intent')?.id);
	let latestHeadline = $derived(
		entries.findLast((entry) => entry.type === 'intent')?.intent.headline ?? ''
	);

	let blocks = $derived(
		entries.reduce<Block[]>((blocks, entry) => {
			const last = blocks.at(-1);
			if (entry.type !== 'message') blocks.push(entry);
			else if (last?.type === 'group' && last.author === entry.author) last.messages.push(entry);
			else blocks.push({ type: 'group', id: entry.id, author: entry.author, messages: [entry] });
			return blocks;
		}, [])
	);

	function add(...added: Entry[]) {
		entries = [...entries, ...added];
	}

	function send(text: string) {
		add({ type: 'message', id: id(), author: sam, text });
		status = 'running';
		setTimeout(() => {
			if (started) {
				const count = entries.filter((entry) => entry.type === 'intent').length;
				add({ type: 'intent', id: id(), intent: revisions[count % revisions.length]! });
			} else {
				add(
					{
						type: 'message',
						id: id(),
						author: agent,
						text: 'Members now load as you scroll, and the checks pass.'
					},
					{ type: 'handoff', id: id(), intent: separateWork }
				);
			}
			started = true;
			status = 'needs-you';
		}, 600);
	}

	function resolve(entryId: string, outcome: 'dismissed' | Mentionable) {
		entries = entries.map((entry) =>
			entry.id === entryId && entry.type === 'handoff' ? { ...entry, outcome } : entry
		);
	}
</script>

{#snippet thread()}
	<div class="frame">
		<ChatHeader
			headline={latestHeadline}
			{status}
			people={[sam, lin]}
			onpreview={started ? () => {} : undefined}
			actions={[
				{ label: 'Copy link', onselect: () => {} },
				{ label: 'Discard', onselect: () => {} }
			]}
		/>
		<ChatLog label="Thread messages">
			{#each blocks as block (block.id)}
				{#if block.type === 'group'}
					<ChatGroup author={block.author} own={block.author === sam}>
						{#each block.messages as message (message.id)}
							<ChatMessage>
								<p style="white-space: pre-line">
									{#each parts(message.text) as part, index (index)}{#if typeof part === 'string'}{part}{:else}<ChatMention
												mention={part}
											/>{/if}{/each}
								</p>
							</ChatMessage>
						{/each}
					</ChatGroup>
				{:else if block.type === 'intent'}
					<ChatIntent
						{...block.intent}
						superseded={block.id !== latestIntent}
						status={status === 'shipped'
							? 'shipped'
							: status === 'running'
								? 'working'
								: 'needs-you'}
						note={status === 'shipped' ? 'Shipped in a1b2c3d' : undefined}
					/>
				{:else if block.type === 'handoff'}
					{#if block.outcome === 'dismissed'}
						<ChatEvent>Dismissed separate work: <code>{block.intent.headline}</code></ChatEvent>
					{:else if block.outcome}
						<ChatEvent>Spun off <ChatMention mention={block.outcome} />&nbsp;· running</ChatEvent>
					{:else}
						<ChatIntent
							{...block.intent}
							handoff
							onstart={() =>
								resolve(block.id, {
									kind: 'thread',
									handle: 'audit-log-query',
									label: 'Stop loading the full audit log',
									href: '#'
								})}
							ondismiss={() => resolve(block.id, 'dismissed')}
						/>
					{/if}
				{:else}
					<ChatEvent>{block.text}</ChatEvent>
				{/if}
			{/each}
			{#if started && status !== 'shipped'}
				<ShipPanel
					{intent}
					branch="main"
					{status}
					onship={async () => {
						status = 'shipped';
					}}
				/>
			{/if}
			{#if status === 'running'}
				<ChatActivity>ReGit is working</ChatActivity>
			{/if}
		</ChatLog>
		<div class="composer">
			<ChatComposer mentions={mentionables} onsend={send} />
			<ChatFooter
				mode="Medium"
				context={{
					used: 48_000,
					limit: 200_000,
					parts: [
						{ label: 'Instructions', tokens: 6_000 },
						{ label: 'Lessons', tokens: 2_000 },
						{ label: 'Thread', tokens: 9_000 },
						{ label: 'Code', tokens: 31_000 }
					]
				}}
				usage={[
					{ task: 'Coding', model: 'kimi-k2.7-code', tokens: 980_000, cost: 0.71 },
					{ task: 'Search', model: 'qwen3-embedding', tokens: 160_000, cost: 0.02 }
				]}
			/>
		</div>
	</div>
{/snippet}

<Story name="Thread" asChild>{@render thread()}</Story>

<Story
	name="Start and spin off"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.type(canvas.getByRole('textbox', { name: 'Message' }), 'Go ahead.{Enter}');
		await userEvent.click(await canvas.findByRole('button', { name: 'Spin off' }));
		await waitFor(() => expect(canvas.getByText(/Spun off/)).toBeVisible());
		await expect(
			canvas.getByRole('link', { name: 'Stop loading the full audit log' })
		).toBeVisible();
	}}
>
	{@render thread()}
</Story>

<Story
	name="Ship"
	asChild
	play={async ({ canvas, userEvent }) => {
		await userEvent.type(canvas.getByRole('textbox', { name: 'Message' }), 'Go ahead.{Enter}');
		await userEvent.click(await canvas.findByRole('button', { name: 'Ship' }));
		await expect(canvas.getByRole('textbox', { name: 'Commit title' })).toHaveValue(
			revisions[0]!.headline
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Ship commit' }));
		await waitFor(() => expect(canvas.getByText('Shipped in a1b2c3d')).toBeVisible());
		await expect(canvas.queryByRole('region', { name: 'Ship' })).toBeNull();
	}}>{@render thread()}</Story
>

<style>
	.frame {
		display: flex;
		flex-direction: column;
		inline-size: 44rem;
		min-inline-size: 16rem;
		max-inline-size: 100%;
		block-size: 100dvh;
		margin-inline: auto;
		overflow: hidden;
		border-inline: 1px solid var(--color-border);
		resize: horizontal;
	}

	.composer {
		display: grid;
		gap: 0.375rem;
		padding: 0 1rem 0.75rem;
	}
</style>

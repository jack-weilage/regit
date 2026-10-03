<script lang="ts">
	import {
		ChatActivity,
		ChatComposer,
		ChatEvent,
		ChatFooter,
		ChatGroup,
		ChatHeader,
		ChatIntent,
		ChatLog,
		ChatMessage,
		ThreadView
	} from '@regit/ui';
	import type { Author, Entry } from '@regit/core';
	import { getThread, getUser, reply, startThread } from '#lib/data.remote.ts';

	type Block =
		| {
				type: 'group';
				id: string;
				at: number;
				author: Author;
				messages: { id: string; text: string }[];
		  }
		| Exclude<Entry, { type: 'message' }>;

	const modes = { small: 'Small', medium: 'Medium', large: 'Large' };

	let { params } = $props();

	let detail = $derived(await getThread({ repo: params.repo, id: params.thread }));
	let user = $derived(await getUser());

	let latestIntent = $derived(detail?.entries.findLast((entry) => entry.type === 'intent')?.id);
	let blocks = $derived(
		(detail?.entries ?? []).reduce<Block[]>((blocks, entry) => {
			const last = blocks.at(-1);
			if (entry.type !== 'message') blocks.push(entry);
			else if (last?.type === 'group' && last.author.name === entry.author.name)
				last.messages.push(entry);
			else
				blocks.push({
					type: 'group',
					id: entry.id,
					at: entry.at,
					author: entry.author,
					messages: [entry]
				});
			return blocks;
		}, [])
	);
</script>

<svelte:head>
	<title>{detail?.summary.headline || 'Thread'} · ReGit</title>
</svelte:head>

{#if detail}
	{@const { summary } = detail}
	<ThreadView>
		{#snippet header()}
			<ChatHeader headline={summary.headline || 'Drafting an intent…'} status={summary.status} />
		{/snippet}
		<ChatLog label="Thread messages">
			{#each blocks as block (block.id)}
				{#if block.type === 'group'}
					<ChatGroup
						author={block.author}
						time={new Date(block.at)}
						own={block.author.kind === 'person' && block.author.name === user.name}
					>
						{#each block.messages as message (message.id)}
							<ChatMessage>{message.text}</ChatMessage>
						{/each}
					</ChatGroup>
				{:else if block.type === 'intent'}
					<ChatIntent
						{...block.intent}
						superseded={block.id !== latestIntent}
						onstart={block.id === latestIntent && summary.status === 'draft'
							? () => startThread({ repo: params.repo, id: params.thread })
							: undefined}
					/>
				{:else}
					<ChatEvent time={new Date(block.at)}>{block.text}</ChatEvent>
				{/if}
			{/each}
			{#if summary.status === 'running'}
				<ChatActivity>ReGit is working</ChatActivity>
			{/if}
		</ChatLog>
		{#snippet bottom()}
			<ChatComposer
				placeholder={summary.status === 'draft' ? 'Refine the intent' : 'Reply to ReGit'}
				onsend={(text) => reply({ repo: params.repo, id: params.thread, text })}
			/>
			<!-- TODO: show real context and usage once the coordinator keeps a usage ledger -->
			<ChatFooter mode={modes[summary.mode]} context={{ used: 0, limit: 272_000 }} usage={[]} />
		{/snippet}
	</ThreadView>
{:else}
	<p class="missing">This thread doesn't exist.</p>
{/if}

<style>
	.missing {
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--color-muted);
	}
</style>

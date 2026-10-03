<script lang="ts">
	import {
		ChatActivity,
		ChatBanner,
		ChatComposer,
		ChatEvent,
		ChatFooter,
		ChatGroup,
		ChatHeader,
		ChatIntent,
		ChatLog,
		ChatMessage,
		DeletedThread,
		Markdown,
		DeleteThreadDialog,
		ThreadView,
		Button,
		type ThreadAction
	} from '@regit/ui';
	import { threadPurgeDelayMs, type Author, type Entry } from '@regit/core';
	import {
		deleteThread,
		discardThread,
		getThread,
		getUser,
		reopenThread,
		reply,
		restoreThread,
		startThread
	} from '#lib/data.remote.ts';

	type Block =
		| {
				type: 'group';
				id: string;
				at: number;
				author: Author;
				messages: { id: string; text: string; steering?: { read: boolean } }[];
		  }
		| Exclude<Entry, { type: 'message' }>;

	const modes = { small: 'Small', medium: 'Medium', large: 'Large' };
	const tasks = { intent: 'Drafting intents', conversation: 'Conversation', attempt: 'Agent' };

	let { params } = $props();

	let deleting = $state(false);

	let detail = $derived(await getThread({ repo: params.repo, id: params.thread }));
	let user = $derived(await getUser());

	let latestIntent = $derived(detail?.entries.findLast((entry) => entry.type === 'intent')?.id);
	let thinking = $derived.by(() => {
		const last = detail?.entries.at(-1);
		return (
			detail?.summary.status === 'draft' &&
			last?.type === 'message' &&
			last.author.kind === 'person'
		);
	});
	let ref = $derived({ repo: params.repo, id: params.thread });
	let actions = $derived.by<ThreadAction[]>(() => {
		const status = detail?.summary.status;
		return [
			{ label: 'Copy link', onselect: () => navigator.clipboard.writeText(location.href) },
			status === 'discarded'
				? { label: 'Reopen thread', detail: 'Pick up where it left off', onselect: reopen }
				: {
						label: 'Discard thread',
						detail: 'Stops the attempt, keeps the conversation',
						onselect: () => discardThread(ref)
					},
			{ label: 'Delete thread…', separated: true, danger: true, onselect: () => (deleting = true) }
		];
	});

	function reopen() {
		reopenThread(ref);
	}

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

{#if detail?.summary.deleted}
	{@const { deleted } = detail.summary}
	<DeletedThread
		deletedBy={deleted.by}
		deletedAt={deleted.at}
		purgeAt={deleted.at + threadPurgeDelayMs}
		back="/{params.repo}"
		onrestore={() => restoreThread(ref)}
	/>
{:else if detail}
	{@const { summary } = detail}
	<ThreadView>
		{#snippet header()}
			<ChatHeader headline={summary.headline || 'New thread'} status={summary.status} {actions} />
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
							<ChatMessage steering={!!message.steering} pending={message.steering?.read === false}
								><Markdown source={message.text} /></ChatMessage
							>
						{/each}
					</ChatGroup>
				{:else if block.type === 'intent'}
					<ChatIntent
						{...block.intent}
						superseded={block.id !== latestIntent}
						sticky={block.id === latestIntent}
						status={block.id === latestIntent && summary.status === 'running'
							? 'working'
							: undefined}
						onstart={block.id === latestIntent && summary.status === 'draft' && !thinking
							? () => startThread({ repo: params.repo, id: params.thread })
							: undefined}
					/>
				{:else}
					<ChatEvent time={new Date(block.at)}>{block.text}</ChatEvent>
				{/if}
			{/each}
			{#if thinking}
				<ChatActivity>ReGit is thinking</ChatActivity>
			{:else if summary.status === 'running'}
				<ChatActivity>ReGit is working</ChatActivity>
			{/if}
		</ChatLog>
		{#snippet bottom()}
			{#if summary.status === 'discarded'}
				<ChatBanner>
					This thread was discarded. The conversation is read-only.
					{#snippet actions()}
						<Button size="sm" onclick={reopen}>Reopen</Button>
					{/snippet}
				</ChatBanner>
			{:else}
				<ChatComposer
					placeholder={summary.status === 'draft' ? 'Refine the intent' : 'Reply to ReGit'}
					onsend={(text) => reply({ repo: params.repo, id: params.thread, text })}
				/>
			{/if}
			<ChatFooter
				mode={modes[summary.mode]}
				context={detail.usage.context}
				usage={detail.usage.rows.map((row) => ({
					task: tasks[row.task],
					model: row.model,
					tokens: row.tokens,
					cost: row.cost ?? 0
				}))}
			/>
		{/snippet}
	</ThreadView>
	<DeleteThreadDialog
		bind:open={deleting}
		headline={summary.headline || 'This thread'}
		messages={detail.entries.filter((entry) => entry.type === 'message').length}
		checkpoints={detail.entries.filter(
			(entry) => entry.type === 'event' && entry.text.startsWith('Checkpoint')
		).length}
		running={summary.status === 'running'}
		restoreDays={threadPurgeDelayMs / 86_400_000}
		onconfirm={() => deleteThread(ref)}
	/>
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

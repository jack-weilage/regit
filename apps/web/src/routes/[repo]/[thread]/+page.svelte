<script lang="ts">
	import {
		ChangesPanel,
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
		ChatReview,
		DeletedThread,
		Markdown,
		DeleteThreadDialog,
		ShipDialog,
		ThreadView,
		Button,
		type CheckState,
		type IntentStatus,
		type ThreadAction
	} from '@regit/ui';
	import { maxReviewRounds, threadPurgeDelayMs, type Author, type Entry } from '@regit/core';
	import {
		deleteThread,
		discardThread,
		getChanges,
		getThread,
		getUser,
		reopenThread,
		reply,
		restoreThread,
		shipThread,
		startThread,
		stopThread
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
	const tasks = {
		intent: 'Drafting intents',
		conversation: 'Conversation',
		attempt: 'Agent',
		review: 'Review'
	};

	let { params } = $props();

	let deleting = $state(false);
	let viewing = $state(false);
	let confirming = $state(false);

	let detail = $derived(await getThread({ repo: params.repo, id: params.thread }));
	let user = $derived(await getUser());

	let latestIntent = $derived(detail?.entries.findLast((entry) => entry.type === 'intent')?.id);
	let latestReview = $derived(
		detail?.entries.findLast(
			(entry): entry is Extract<Entry, { type: 'review' }> => entry.type === 'review'
		)
	);
	let progress = $derived.by(
		(): { status?: IntentStatus; checks?: CheckState[]; note?: string } => {
			const status = detail?.summary.status;
			const intent = detail?.entries.findLast((entry) => entry.type === 'intent');
			const review = latestReview;
			const count = intent?.type === 'intent' ? intent.intent.doneWhen.length : 0;
			const checks = review?.checks;
			if (status === 'shipping') return { status: 'shipping', checks, note: 'Shipping' };
			if (status === 'shipped') {
				const sha = detail!.summary.shipped?.sha.slice(0, 7);
				return { status: 'shipped', checks, note: sha ? `Shipped in ${sha}` : 'Shipped' };
			}
			if (status === 'reviewing') {
				return {
					status: 'reviewing',
					checks: Array(count).fill('checking'),
					note: 'Reviewing against the intent'
				};
			}
			if (status === 'running') {
				const resumed = detail!.entries
					.slice(review ? detail!.entries.indexOf(review) : 0)
					.some((entry) => entry.type === 'message' && entry.author.kind === 'person');
				const conflict = detail!.entries.findLast((entry) => entry.type === 'event');
				if (conflict?.type === 'event' && conflict.text.startsWith('Conflicts with')) {
					return { status: 'working', note: 'Resolving conflicts' };
				}
				if (!review || review.verdict !== 'fail' || resumed) {
					return { status: 'working', note: 'The agent is working' };
				}
				const gaps = review.checks.filter((check) => check !== 'met').length;
				return {
					status: 'working',
					checks: review.checks,
					note: `Round ${review.round + 1} of ${maxReviewRounds} · fixing ${gaps} ${gaps === 1 ? 'gap' : 'gaps'}`
				};
			}
			if (status !== 'needs-you') return {};
			if (!review) return { status: 'needs-you' };
			if (review.verdict === 'pass') {
				return { status: 'ready', checks: review.checks, note: 'Reviewed · ready to ship' };
			}
			const unchecked = review.checks.filter((check) => check === 'unverified').length;
			return {
				status: 'needs-you',
				checks: review.checks,
				note:
					review.verdict === 'needs-human' && unchecked
						? `${unchecked} ${unchecked === 1 ? "item couldn't" : "items couldn't"} be checked`
						: review.verdict === 'needs-human'
							? 'The reviewer needs you to decide'
							: `Still has gaps after ${maxReviewRounds} rounds`
			};
		}
	);
	let thinking = $derived.by(() => {
		const last = detail?.entries.at(-1);
		return (
			detail?.summary.status === 'draft' &&
			last?.type === 'message' &&
			last.author.kind === 'person'
		);
	});
	let ref = $derived({ repo: params.repo, id: params.thread });
	let intent = $derived(
		detail?.entries.findLast(
			(entry): entry is Extract<Entry, { type: 'intent' }> => entry.type === 'intent'
		)?.intent
	);
	let shippable = $derived(
		detail?.summary.status === 'needs-you' && !!detail.summary.changes?.files
	);

	function view() {
		viewing = true;
		getChanges(ref).refresh();
	}
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
	<div class={['page', { viewing }]}>
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
								<ChatMessage
									steering={!!message.steering}
									pending={message.steering?.read === false}
									><Markdown source={message.text} /></ChatMessage
								>
							{/each}
						</ChatGroup>
					{:else if block.type === 'intent'}
						<ChatIntent
							{...block.intent}
							superseded={block.id !== latestIntent}
							sticky={block.id === latestIntent}
							{...block.id === latestIntent ? progress : {}}
							changes={block.id === latestIntent ? (summary.changes ?? undefined) : undefined}
							onchanges={view}
							onship={block.id === latestIntent && shippable
								? () => (confirming = true)
								: undefined}
							onstart={block.id === latestIntent && summary.status === 'draft' && !thinking
								? () => startThread({ repo: params.repo, id: params.thread })
								: undefined}
						/>
					{:else if block.type === 'review'}
						<ChatReview
							verdict={block.verdict === 'pass'
								? 'passed'
								: block.verdict === 'fail' && block.round < maxReviewRounds
									? 'sent-back'
									: 'needs-you'}
							round={block.round}
							doneWhen={detail.entries.findLast((entry) => entry.type === 'intent')?.intent
								.doneWhen ?? []}
							checks={block.checks}
						/>
					{:else}
						<ChatEvent time={new Date(block.at)}>{block.text}</ChatEvent>
					{/if}
				{/each}
				{#if thinking}
					<ChatActivity>ReGit is thinking</ChatActivity>
				{:else if summary.status === 'running'}
					<ChatActivity>ReGit is working</ChatActivity>
				{:else if summary.status === 'reviewing'}
					<ChatActivity>ReGit is reviewing the work</ChatActivity>
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
						working={thinking || ['running', 'reviewing', 'shipping'].includes(summary.status)}
						onstop={() => stopThread(ref)}
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
		{#if viewing}
			<div class="panel">
				{#await getChanges(ref) then files}
					<ChangesPanel
						files={files ?? []}
						onship={shippable ? () => (confirming = true) : undefined}
						onclose={() => (viewing = false)}
					/>
				{/await}
			</div>
		{/if}
	</div>
	{#if intent && summary.changes}
		<ShipDialog
			bind:open={confirming}
			repo={params.repo}
			base={summary.base ?? undefined}
			headline={intent.headline}
			body={intent.purpose}
			{...summary.changes}
			review={latestReview
				? {
						verdict: latestReview.verdict,
						met: latestReview.checks.filter((check) => check === 'met').length,
						total: latestReview.checks.length
					}
				: null}
			onship={({ title, body }) => {
				viewing = false;
				shipThread({ ...ref, title, body });
			}}
		/>
	{/if}
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
	.page {
		container: page / inline-size;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr);
		block-size: 100%;
		min-block-size: 0;

		&.viewing {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
		}
	}

	.panel {
		min-inline-size: 0;
		min-block-size: 0;
		border-inline-start: 1px solid var(--color-border);
	}

	@container page (width < 60rem) {
		.viewing > :global(*) {
			grid-area: 1 / 1 / 2 / -1;
		}

		.panel {
			z-index: 2;
			border-inline-start: 0;
		}
	}

	.missing {
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--color-muted);
	}
</style>

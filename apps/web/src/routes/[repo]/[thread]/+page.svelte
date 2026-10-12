<script lang="ts">
	import {
		AcceptancePanel,
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
		ChatMention,
		ChatMessage,
		ChatReview,
		ChatStartup,
		ChatThreadMessage,
		ChatTools,
		DeletedThread,
		Markdown,
		DeleteThreadDialog,
		statuses,
		ServicesPanel,
		ThreadSidebar,
		type SidebarTab,
		ThreadView,
		Button,
		type CheckState,
		type IntentStatus,
		type ThreadAction
	} from '@regit/ui';
	import {
		maxReviewRounds,
		threadPurgeDelayMs,
		type Author,
		type Entry,
		type ToolCallRecord
	} from '@regit/core';
	import { getLiveActivity, summarizeTools, toolView } from '#lib/activity.ts';
	import { similarThreads } from '#lib/similar.ts';
	import {
		acceptThreadIntent,
		approveThreadPromotion,
		pinThreadDependency,
		unpinThreadDependency,
		shipThread,
		startThread,
		deleteThread,
		discardThread,
		dismissSuggestion,
		forwardIntent,
		getChanges,
		readServiceLogs,
		serviceAction,
		getThread,
		getThreads,
		getUser,
		reopenThread,
		reply,
		restoreThread,
		spinOff,
		stopThread
	} from '#lib/data.remote.ts';

	type Block =
		| {
				type: 'group';
				id: string;
				at: number;
				author: Author;
				messages: {
					id: string;
					text?: string;
					steering?: { read: boolean };
					calls?: ToolCallRecord[];
				}[];
		  }
		| Exclude<Entry, { type: 'message' | 'tools' }>;

	const agent: Author = { name: 'ReGit', kind: 'agent' };

	const modes = { small: 'Small', medium: 'Medium', large: 'Large' };
	const tasks = {
		intent: 'Drafting intents',
		conversation: 'Conversation',
		attempt: 'Agent',
		review: 'Review',
		search: 'Thread search'
	};

	let { params } = $props();

	let deleting = $state(false);
	let open = $state(false);
	let tab = $state<SidebarTab>('changes');
	let restored = false;

	$effect(() => {
		if (!restored) {
			restored = true;
			try {
				const saved = JSON.parse(localStorage.getItem('regit:sidebar') ?? 'null');
				open = saved?.open ?? false;
				tab = saved?.tab === 'services' ? 'services' : 'changes';
			} catch {
				// Storage is unavailable; start closed.
			}
			return;
		}
		try {
			localStorage.setItem('regit:sidebar', JSON.stringify({ open, tab }));
		} catch {
			// Storage is unavailable; the panel just won't be remembered.
		}
	});

	$effect(() => {
		JSON.stringify(detail?.summary.changes);
		if (open && tab === 'changes') getChanges(ref).refresh();
	});
	let service = $state<string | null>(null);
	let logs = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let failure = $state<string | null>(null);

	const live = getLiveActivity();

	let detail = $derived(await getThread({ repo: params.repo, id: params.thread }));
	let activity = $derived(params.thread in live ? live[params.thread] : (detail?.activity ?? null));
	let user = $derived(await getUser());
	let threads = $derived(await getThreads(params.repo));

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
			if (detail?.control?.promotions.some((promotion) => promotion.status === 'ready'))
				return { status: 'ready', note: 'Exact candidate awaits owner approval' };
			if (status === 'shipping')
				return {
					status: 'shipping',
					checks,
					note: 'Preparing candidate or publishing approved SHA'
				};
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
				return {
					status: 'ready',
					checks: review.checks,
					note: 'Model reviewed · ready to prepare candidate'
				};
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
	let firstStartup = $derived(
		detail?.entries.find(
			(entry): entry is Extract<Entry, { type: 'startup' }> => entry.type === 'startup'
		)
	);
	let startup = $derived(
		firstStartup
			? { stages: firstStartup.stages, finished: true }
			: activity?.startup && { stages: activity.startup.stages, finished: false }
	);

	async function act(action: 'start' | 'stop' | 'restart', name: string) {
		busy = name;
		failure = null;
		try {
			await serviceAction({ ...ref, action, name });
		} catch (error) {
			failure = error instanceof Error ? error.message : String(error);
		} finally {
			busy = null;
		}
	}

	async function showLogs(name: string) {
		logs = await readServiceLogs({ ...ref, name }).catch(() => null);
	}

	function view() {
		tab = 'changes';
		open = true;
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
			if (entry === firstStartup) return blocks;
			const last = blocks.at(-1);
			const batch = last?.type === 'group' ? last.messages.at(-1)?.calls : undefined;
			if (entry.type === 'tools' && batch) {
				batch.push(...entry.calls);
				return blocks;
			}
			const item = entry.type === 'tools' ? { id: entry.id, calls: [...entry.calls] } : entry;
			const author = entry.type === 'message' ? entry.author : agent;
			if (entry.type !== 'message' && entry.type !== 'tools') blocks.push(entry);
			else if (last?.type === 'group' && last.author.name === author.name) last.messages.push(item);
			else blocks.push({ type: 'group', id: entry.id, at: entry.at, author, messages: [item] });
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
	<div class="page">
		<ThreadView>
			{#snippet header()}
				<ChatHeader
					headline={summary.headline || 'New thread'}
					status={summary.status}
					parent={summary.parent
						? {
								kind: 'thread',
								handle: summary.parent.id,
								label: summary.parent.headline || 'New thread',
								href: `/${params.repo}/${summary.parent.id}`
							}
						: undefined}
					{actions}
				/>
			{/snippet}
			<ChatLog label="Thread messages">
				{#if startup}
					<ChatStartup {...startup} />
				{/if}
				{#each blocks as block (block.id)}
					{#if block.type === 'group'}
						<ChatGroup
							author={block.author}
							time={new Date(block.at)}
							own={block.author.kind === 'person' && block.author.name === user.name}
						>
							{#each block.messages as message (message.id)}
								{#if message.calls}
									<ChatTools
										calls={message.calls.map(toolView)}
										summary={summarizeTools(message.calls)}
									/>
								{:else}
									<ChatMessage
										steering={!!message.steering}
										pending={message.steering?.read === false}
										><Markdown source={message.text ?? ''} /></ChatMessage
									>
								{/if}
							{/each}
						</ChatGroup>
					{:else if block.type === 'intent'}
						<ChatIntent
							{...block.intent}
							superseded={block.id !== latestIntent}
							sticky={block.id === latestIntent}
							{...block.id === latestIntent ? progress : {}}
							changes={block.id === latestIntent ? (summary.changes ?? undefined) : undefined}
							similar={block.id === latestIntent
								? similarThreads(params.repo, block.similar ?? [], threads)
								: []}
							onmessage={(other) => forwardIntent({ ...ref, to: other.handle })}
							onchanges={view}
						/>
					{:else if block.type === 'suggestion'}
						{#if block.outcome?.kind === 'spun-off'}
							{@const spun = block.outcome}
							{@const child = threads.find((thread) => thread.id === spun.thread)}
							<ChatEvent time={new Date(block.at)}
								>Spun off <ChatMention
									mention={{
										kind: 'thread',
										handle: spun.thread,
										label: child?.headline || block.intent.headline,
										href: `/${params.repo}/${spun.thread}`
									}}
								/>{#if child}&nbsp;· {statuses[child.status].label.toLowerCase()}{/if}</ChatEvent
							>
						{:else if block.outcome?.kind === 'dismissed'}
							<ChatEvent time={new Date(block.at)}
								>Dismissed separate work: <code>{block.intent.headline}</code></ChatEvent
							>
						{:else}
							<ChatIntent
								{...block.intent}
								handoff
								onstart={() => spinOff({ ...ref, entry: block.id })}
								ondismiss={() => dismissSuggestion({ ...ref, entry: block.id })}
							/>
						{/if}
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
					{:else if block.type === 'startup'}
						<ChatStartup stages={block.stages} finished />
					{:else if block.type === 'thread-message'}
						{@const other = threads.find((thread) => thread.id === block.thread)}
						<ChatThreadMessage
							direction={block.direction}
							thread={{
								kind: 'thread',
								handle: block.thread,
								label: other?.headline || block.headline || 'New thread',
								href: `/${params.repo}/${block.thread}`,
								deleted: !other
							}}
							pending={block.steering?.read === false}
						>
							<ChatMessage><Markdown source={block.text} /></ChatMessage>
						</ChatThreadMessage>
					{:else}
						<ChatEvent time={new Date(block.at)}>{block.text}</ChatEvent>
					{/if}
				{/each}
				{#if summary.status !== 'discarded' && (intent || detail.control?.acceptedIntent || detail.control?.promotions.length)}
					<AcceptancePanel
						control={detail.control}
						{intent}
						status={summary.status}
						hasChanges={!!summary.changes?.files}
						onaccept={() => acceptThreadIntent(ref)}
						onstart={() => startThread(ref)}
						onprepare={(commit) => shipThread({ ...ref, ...commit })}
						onapprove={(promotion) => approveThreadPromotion({ ...ref, promotion })}
						proposals={threads.filter(
							(thread) =>
								thread.id !== summary.id && !thread.deleted && thread.status !== 'discarded'
						)}
						onpin={(dependency) => pinThreadDependency({ ...ref, dependency })}
						onunpin={(dependency) => unpinThreadDependency({ ...ref, dependency })}
					/>
				{/if}
				{#if activity?.startup && firstStartup}
					<ChatStartup stages={activity.startup.stages} />
				{/if}
				{#if activity && (activity.text || activity.calls.length)}
					<ChatGroup author={agent}>
						{#if activity.text}
							<ChatMessage><Markdown source={activity.text} /></ChatMessage>
						{/if}
						{#if activity.calls.length}
							<ChatTools calls={activity.calls.map(toolView)} />
						{/if}
					</ChatGroup>
				{/if}
				{#if activity?.status && !activity.startup}
					<ChatActivity since={activity.status.since}>{activity.status.label}</ChatActivity>
				{:else if !activity && thinking}
					<ChatActivity>ReGit is thinking</ChatActivity>
				{:else if !activity && summary.status === 'running'}
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
					mode={summary.auto ? `Auto · ${modes[summary.mode]}` : modes[summary.mode]}
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
		<ThreadSidebar
			bind:open
			bind:tab
			changes={summary.changes}
			live={detail.services.some((service) => service.status === 'running')}
		>
			{#snippet changesTab()}
				{#await getChanges(ref) then files}
					<ChangesPanel files={files ?? []} embedded />
				{/await}
			{/snippet}
			{#snippet servicesTab()}
				<ServicesPanel
					services={detail.services}
					bind:selected={service}
					{logs}
					{busy}
					error={failure}
					embedded
					onaction={act}
					onlogs={showLogs}
				/>
			{/snippet}
		</ThreadSidebar>
	</div>
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
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		grid-template-rows: minmax(0, 1fr);
		block-size: 100%;
		min-block-size: 0;
	}

	.missing {
		display: grid;
		place-items: center;
		margin: 0;
		color: var(--color-muted);
	}
</style>

<script lang="ts">
	import {
		AutomationsPanel,
		ChangesPanel,
		ChatActivity,
		ChatAutomation,
		ChatBanner,
		ChatBehindMain,
		ChatComposer,
		ChatEvent,
		ChatFailure,
		ChatFooter,
		ChatGroup,
		ChatHeader,
		ChatIntent,
		ChatLog,
		ChatMention,
		ChatMessage,
		ChatRecovered,
		ChatRetry,
		ChatStartup,
		ChatThreadMessage,
		ChatTools,
		ChildThreads,
		DeletedThread,
		ShipPanel,
		Markdown,
		DeleteThreadDialog,
		ErrorBoundary,
		ErrorNotice,
		statuses,
		ServicesPanel,
		ThreadSidebar,
		type SidebarTab,
		ThreadView,
		Button,
		type IntentStatus,
		type ThreadAction
	} from '@regit/ui';
	import {
		countCheckpoints,
		idlePhase,
		threadPurgeDelayMs,
		type Author,
		type Entry,
		type ToolCallRecord,
		type Verdict
	} from '@regit/core';
	import { getLiveActivity, summarizeTools, toolView } from '#lib/activity.ts';
	import { similarThreads } from '#lib/similar.ts';
	import { threadStates } from '#lib/thread-state.svelte.ts';
	import {
		bringThreadUpToDate,
		cancelAutomation,
		shipThread,
		deleteThread,
		archiveThread,
		dismissSuggestion,
		forwardIntent,
		getChanges,
		getChildren,
		readServiceLogs,
		serviceAction,
		getThread,
		getThreads,
		getUser,
		reopenThread,
		reply,
		restoreThread,
		resumeThread,
		retryThreadNow,
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
	const verdicts: Record<Verdict, string> = {
		landed: 'checking main',
		passed: 'checks passed',
		failed: 'broke main',
		deployed: 'deployed',
		reverted: 'reverted'
	};
	const tasks = { agent: 'Agent', search: 'Thread search' };

	let { params, data } = $props();

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
	const live = getLiveActivity();
	const stateFor = threadStates();

	let ref = $derived({ repo: params.repo, id: data.threadRef.id });
	let local = $derived(stateFor(ref.id));
	let detail = $derived(await getThread(ref));
	let activity = $derived(ref.id in live ? live[ref.id] : (detail?.activity ?? null));
	let phase = $derived(activity?.agent ?? idlePhase);
	let retry = $derived(activity?.retry ?? null);
	let user = $derived(await getUser());
	let threads = $derived(await getThreads(params.repo));
	let children = $derived(await getChildren(ref));

	let latestFailure = $derived(detail?.entries.findLast((entry) => entry.type === 'failure')?.id);
	let progress = $derived.by((): { status?: IntentStatus; note?: string } => {
		const status = detail?.summary.status;
		if (status === 'shipping') return { status: 'shipping', note: `Shipping to ${detail!.branch}` };
		if (status === 'shipped') {
			const shipped = detail!.summary.shipped;
			const note = shipped
				? `Shipped in ${shipped.sha.slice(0, 7)} · ${verdicts[shipped.verdict]}`
				: 'Shipped';
			return { status: 'shipped', note };
		}
		if (status === 'working') return { status: 'working', note: 'The agent is working' };
		if (status === 'idle') return { status: detail!.summary.needsYou ? 'needs-you' : 'idle' };
		return {};
	});
	let intentEntry = $derived(
		detail?.entries.findLast(
			(entry): entry is Extract<Entry, { type: 'intent' }> => entry.type === 'intent'
		)
	);
	let latestIntent = $derived(intentEntry?.id);

	async function act(action: 'start' | 'stop' | 'restart', name: string) {
		const thread = local;
		thread.busy = name;
		thread.failure = null;
		try {
			await serviceAction({ ...ref, action, name });
		} catch (error) {
			thread.failure = error instanceof Error ? error.message : String(error);
		} finally {
			thread.busy = null;
		}
	}

	async function cancel(automation: string) {
		const thread = local;
		thread.cancelling = automation;
		try {
			await cancelAutomation({ ...ref, automation });
		} finally {
			thread.cancelling = null;
		}
	}

	async function showLogs(name: string) {
		const thread = local;
		thread.logs = await readServiceLogs({ ...ref, name }).catch(() => null);
	}

	function view() {
		tab = 'changes';
		open = true;
	}
	let actions = $derived.by<ThreadAction[]>(() => {
		const status = detail?.summary.status;
		return [
			{ label: 'Copy link', onselect: () => navigator.clipboard.writeText(location.href) },
			status === 'archived'
				? { label: 'Reopen thread', detail: 'Pick up where it left off', onselect: reopen }
				: {
						label: 'Archive thread',
						detail: 'Stops the attempt, keeps the conversation',
						onselect: () => archiveThread(ref)
					},
			{ label: 'Delete thread…', separated: true, danger: true, onselect: () => (deleting = true) }
		];
	});

	function reopen() {
		reopenThread(ref);
	}

	async function bringUpToDate(sha: string) {
		const thread = local;
		thread.updating = { sha, calling: true };
		try {
			await bringThreadUpToDate(ref);
			thread.updating = { sha, calling: false };
		} catch {
			thread.updating = null;
		}
	}

	let blocks = $derived(
		(detail?.entries ?? []).reduce<Block[]>((blocks, entry) => {
			const last = blocks.at(-1);
			const batch = last?.type === 'group' ? last.messages.at(-1)?.calls : undefined;
			if (entry.type === 'tools' && !entry.calls.length) return blocks;
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
					number={summary.number}
					status={summary.status}
					needsYou={summary.needsYou}
					parent={summary.parent
						? {
								kind: 'thread',
								handle: summary.parent.id,
								number: summary.parent.number ?? undefined,
								label: summary.parent.headline || 'New thread',
								href: summary.parent.number ? `/${params.repo}/${summary.parent.number}` : undefined
							}
						: undefined}
					{actions}
				/>
			{/snippet}
			<ChatLog label="Thread messages">
				{#each blocks as block (block.id)}
					<ErrorBoundary title="Couldn't show this entry">
						{#if block.type === 'group'}
							<ChatGroup
								author={block.author}
								time={new Date(block.at)}
								own={block.author.kind === 'person' && block.author.name === user.name}
							>
								{#each block.messages as message (message.id)}
									{#if message.calls}
										<ChatTools
											calls={message.calls.map((call) => toolView(call, threads))}
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
								results={block.results}
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
											number: child?.number ?? spun.number,
											label: child?.headline || block.intent.headline,
											href:
												(child?.number ?? spun.number)
													? `/${params.repo}/${child?.number ?? spun.number}`
													: undefined
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
						{:else if block.type === 'startup'}
							<ChatStartup stages={block.stages} finished />
						{:else if block.type === 'recovered'}
							<ChatRecovered failures={block.failures} />
						{:else if block.type === 'failure'}
							<ChatFailure
								title={block.title}
								error={block.error}
								failures={block.failures}
								time={new Date(block.at)}
								onresume={block.id === latestFailure &&
								block.resumable &&
								summary.failure?.resumable &&
								summary.status === 'idle'
									? () => resumeThread(ref)
									: undefined}
							/>
						{:else if block.type === 'thread-message'}
							{@const other = threads.find((thread) => thread.id === block.thread)}
							<ChatThreadMessage
								direction={block.direction}
								thread={{
									kind: 'thread',
									handle: block.thread,
									number: other?.number ?? block.number,
									label: other?.headline || block.headline || 'New thread',
									href:
										(other?.number ?? block.number)
											? `/${params.repo}/${other?.number ?? block.number}`
											: undefined,
									deleted: !other
								}}
								pending={block.steering?.read === false}
							>
								<ChatMessage><Markdown source={block.text} /></ChatMessage>
							</ChatThreadMessage>
						{:else if block.type === 'automation'}
							<ChatAutomation
								name={block.name}
								trigger={block.trigger}
								run={block.run}
								limit={block.limit}
								time={new Date(block.at)}
								pending={block.steering?.read === false}
							>
								<ChatMessage><Markdown source={block.text} /></ChatMessage>
							</ChatAutomation>
						{:else if block.type === 'event'}
							<ChatEvent time={new Date(block.at)} tone={block.tone}>{block.text}</ChatEvent>
						{/if}
					</ErrorBoundary>
				{/each}
				{#if children.length}
					<ErrorBoundary title="Couldn't show spun-off threads" resetOn={params.thread}>
						<ChildThreads
							threads={children.map(({ summary: child, doneWhen, previews }) => ({
								id: child.id,
								number: child.number,
								headline: child.headline,
								status: child.status,
								needsYou: child.needsYou,
								href: `/${params.repo}/${child.number}`,
								doneWhen: doneWhen ?? undefined,
								previews: previews.map((preview) => ({ name: preview.name, href: preview.url })),
								shipped: child.shipped ?? undefined
							}))}
						/>
					</ErrorBoundary>
				{/if}
				<ErrorBoundary title="Couldn't show this thread's status" resetOn={params.thread}>
					{#if summary.behind && summary.status !== 'archived'}
						{@const behind = summary.behind}
						<ChatBehindMain
							{...behind}
							updating={local.updating?.sha === behind.sha &&
								(local.updating.calling || summary.status !== 'idle')}
							onupdate={() => bringUpToDate(behind.sha)}
						/>
					{/if}
					{#if summary.status === 'shipping' || (summary.status !== 'archived' && summary.changes?.files)}
						<ShipPanel
							intent={intentEntry?.intent}
							results={intentEntry?.results}
							status={summary.status}
							progress={activity?.ship}
							checks={summary.checks}
							branch={detail.branch}
							onship={(commit) => shipThread({ ...ref, ...commit })}
						/>
					{/if}
				</ErrorBoundary>
				<ErrorBoundary title="Couldn't show the agent's progress" resetOn={params.thread}>
					{#if phase.type === 'starting'}
						<ChatStartup stages={phase.stages} />
					{:else if phase.type === 'streaming'}
						<ChatGroup author={agent}>
							{#if phase.text}
								<ChatMessage><Markdown source={phase.text} /></ChatMessage>
							{/if}
							{#if phase.calls.length}
								<ChatTools calls={phase.calls.map((call) => toolView(call, threads))} />
							{/if}
						</ChatGroup>
					{/if}
					{#if retry}
						<ChatRetry {retry} onretrynow={() => retryThreadNow(ref)} />
					{/if}
					{#if phase.type === 'thinking'}
						<ChatActivity since={phase.since}>{phase.label}</ChatActivity>
					{:else if !activity && summary.status === 'working'}
						<ChatActivity>ReGit is working</ChatActivity>
					{/if}
				</ErrorBoundary>
			</ChatLog>
			{#snippet bottom()}
				{#if summary.status === 'archived'}
					<ChatBanner>
						This thread was archived. The conversation is read-only.
						{#snippet actions()}
							<Button size="sm" onclick={reopen}>Reopen</Button>
						{/snippet}
					</ChatBanner>
				{:else}
					{#if detail.automations.some((automation) => !automation.ended)}
						<ErrorBoundary title="Couldn't show automations" resetOn={params.thread}>
							<AutomationsPanel
								automations={detail.automations}
								compact
								busy={local.cancelling}
								oncancel={cancel}
							/>
						</ErrorBoundary>
					{/if}
					<ChatComposer
						bind:value={local.draft}
						working={summary.status === 'working'}
						onstop={() => stopThread(ref)}
						onsend={(text) => reply({ ...ref, text })}
					/>
				{/if}
				<ErrorBoundary title="Couldn't show usage" resetOn={params.thread}>
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
				</ErrorBoundary>
			{/snippet}
		</ThreadView>
		<ThreadSidebar
			bind:open
			bind:tab
			changes={summary.changes}
			live={detail.services.some((service) => service.status === 'running')}
		>
			{#snippet changesTab(close)}
				<ErrorBoundary title="Couldn't show changes" resetOn={params.thread}>
					{#await getChanges(ref) then files}
						<ChangesPanel files={files ?? []} onclose={close} />
					{:catch}
						<ErrorNotice
							title="Couldn't load changes"
							inline
							onretry={() => getChanges(ref).refresh()}
						/>
					{/await}
				</ErrorBoundary>
			{/snippet}
			{#snippet servicesTab(close)}
				<ErrorBoundary title="Couldn't show services" resetOn={params.thread}>
					{#key ref.id}
						<ServicesPanel
							services={detail.services}
							bind:selected={local.service}
							logs={local.logs}
							busy={local.busy}
							error={local.failure}
							onaction={act}
							onlogs={showLogs}
							onclose={close}
						/>
					{/key}
				</ErrorBoundary>
			{/snippet}
		</ThreadSidebar>
	</div>
	<DeleteThreadDialog
		bind:open={deleting}
		headline={summary.headline || 'This thread'}
		messages={detail.entries.filter((entry) => entry.type === 'message').length}
		checkpoints={countCheckpoints(detail.entries)}
		running={summary.status === 'working'}
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

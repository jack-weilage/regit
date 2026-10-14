<script lang="ts">
	import { goto } from '$app/navigation';
	import { page, updated } from '$app/state';
	import {
		AppShell,
		CloneDialog,
		DeployDialog,
		DeleteThreadDialog,
		Toast,
		type Mode,
		type SimilarThread,
		type ThreadListItem
	} from '@regit/ui';
	import type { Attachment } from 'svelte/attachments';
	import {
		countCheckpoints,
		defaultMachine,
		threadPurgeDelayMs,
		type Machine,
		type MainStatus,
		type ThreadActivity,
		type ThreadSummary
	} from '@regit/core';
	import { setLiveActivity } from '#lib/activity.ts';
	import { connectLive, repoLiveHandlers } from '#lib/live.ts';
	import {
		assessRequest,
		createGitAccessToken,
		deleteDeploySecret,
		deleteThread,
		archiveThread,
		reopenThread,
		getDeploySettings,
		getGitAccess,
		getMain,
		getRepos,
		revokeGitAccessToken,
		getThread,
		getThreads,
		getUser,
		openThread,
		setDeployMachine,
		setDeploySecret
	} from '#lib/data.remote.ts';
	import { similarThreads } from '#lib/similar.ts';
	import { createAndOpen } from '#lib/repos.ts';

	let { children, params } = $props();

	let mode = $state<Mode>('auto');
	const activities = $state<Record<string, ThreadActivity | null>>({});
	setLiveActivity(activities);

	let repo = $derived(params.repo);
	let current = $derived(page.params.thread ? page.data.threadRef?.id : undefined);
	let user = $derived(await getUser());
	let known = $derived(await getRepos());
	let repos = $derived(known.map((repo) => repo.name));
	let machine = $derived(
		(known.find((known) => known.name === repo)?.machine as Machine | undefined) ?? defaultMachine
	);
	let owner = $derived(known.find((known) => known.name === repo)?.role === 'owner');
	let summaries = $derived(await getThreads(repo));
	let fetchedMain = $derived(await getMain(repo));
	let liveMain = $state<{ repo: string; main: MainStatus } | null>(null);
	let main = $derived(liveMain?.repo === repo ? liveMain.main : fetchedMain);
	let deleting = $state<string | null>(null);
	let deleteOpen = $state(false);
	let threads = $derived<ThreadListItem[]>(
		summaries.map((thread) => ({
			id: thread.id,
			number: thread.number,
			headline: thread.headline || 'New thread',
			status: thread.status,
			updatedAt: thread.updatedAt,
			href: `/${repo}/${thread.number}`,
			parent: thread.parent ?? undefined,
			actions: [
				{
					label: 'Copy link',
					onselect: () =>
						navigator.clipboard.writeText(
							new URL(`/${repo}/${thread.number}`, location.origin).href
						)
				},
				thread.status === 'archived'
					? {
							label: 'Reopen thread',
							detail: 'Pick up where it left off',
							onselect: () => reopenThread({ repo, id: thread.id })
						}
					: {
							label: 'Archive thread',
							detail: 'Stops the attempt, keeps the conversation',
							onselect: () => archiveThread({ repo, id: thread.id })
						},
				{
					label: 'Delete thread…',
					separated: true,
					danger: true,
					onselect: () => {
						deleting = thread.id;
						deleteOpen = true;
					}
				}
			],
			conflictsWith: thread.behind?.conflicts.length ? thread.behind.branch : undefined,
			failed:
				thread.failure?.title ??
				(thread.shipped?.verdict === 'failed' ? `Broke ${main.branch ?? 'main'}` : undefined)
		}))
	);

	let alert = $state<{ thread: string; text: string } | null>(null);
	const alerted = new Map<string, number>();

	// A thread that fails while someone looks elsewhere gets a toast; the thread list keeps the mark.
	function notice({ id, number, headline, failure }: ThreadSummary) {
		if (!failure || alerted.get(id) === failure.at) return;
		alerted.set(id, failure.at);
		if (id === current || Date.now() - failure.at > 60_000) return;
		alert = {
			thread: String(number),
			text: `${headline || 'New thread'}: ${failure.title.toLowerCase()}`
		};
	}

	const live: Attachment = () =>
		connectLive(
			`/${repo}/live`,
			repoLiveHandlers({
				activities,
				current: () => current,
				main: (main) => (liveMain = main ? { repo, main } : null),
				reloadMain: () => getMain(repo).refresh(),
				reloadThreads: () => getThreads(repo).refresh(),
				reloadThread: (id) => getThread({ repo, id }).refresh(),
				notice
			}),
			{
				open: (url) => new EventSource(url),
				page: window,
				visible: () => document.visibilityState === 'visible'
			}
		);

	let managingDeploys = $state(false);

	let cloning = $state(false);
	let created = $state<{ label: string; secret: string } | null>(null);

	let similar = $state<SimilarThread[]>([]);
	let size = $state<Exclude<Mode, 'auto'>>();
	let searching: ReturnType<typeof setTimeout> | undefined;
	let latest = 0;

	function search(text: string) {
		clearTimeout(searching);
		const run = ++latest;
		searching = setTimeout(async () => {
			const assessment = await assessRequest({ repo, text }).catch(() => null);
			if (run !== latest) return;
			similar = similarThreads(repo, assessment?.similar ?? [], summaries);
			size = assessment?.size;
		}, 300);
	}

	async function start(thread: { text: string; mode: Mode; machine: Machine }) {
		latest++;
		similar = [];
		size = undefined;
		const summary = await openThread({ repo, ...thread });
		await goto(`/${repo}/${summary.number}`);
	}
</script>

<svelte:head>
	<title>{repo} · ReGit</title>
</svelte:head>

<div class="app" {@attach live}>
	<AppShell
		{repo}
		{repos}
		{threads}
		{current}
		account={user}
		bind:mode
		bind:machine
		onswitchrepo={(name) => goto(`/${name}`)}
		oncreaterepo={createAndOpen}
		onstart={start}
		{similar}
		{size}
		{main}
		onupdate={updated.current ? () => window.location.reload() : undefined}
		ondeploys={owner ? () => (managingDeploys = true) : undefined}
		onclone={() => {
			created = null;
			cloning = true;
		}}
		onquery={search}
		onopenthread={(thread) => {
			latest++;
			similar = [];
			size = undefined;
			if (thread.href) goto(thread.href);
		}}
	>
		{@render children()}
	</AppShell>
	{#if deleting && deleteOpen}
		{@const id = deleting}
		<svelte:boundary>
			{@const detail = await getThread({ repo, id })}
			{#if detail}
				<DeleteThreadDialog
					bind:open={deleteOpen}
					headline={detail.summary.headline || 'This thread'}
					messages={detail.entries.filter((entry) => entry.type === 'message').length}
					checkpoints={countCheckpoints(detail.entries)}
					running={detail.summary.status === 'running'}
					restoreDays={threadPurgeDelayMs / 86_400_000}
					onconfirm={() => deleteThread({ repo, id })}
				/>
			{/if}
			{#snippet failed()}
				<Toast ondismiss={() => (deleteOpen = false)}>Couldn't load that thread</Toast>
			{/snippet}
		</svelte:boundary>
	{/if}
	{#if alert}
		{@const { thread } = alert}
		<Toast
			action={{ label: 'Open', onclick: () => goto(`/${repo}/${thread}`) }}
			ondismiss={() => (alert = null)}>{alert.text}</Toast
		>
	{/if}
	{#if managingDeploys}
		<svelte:boundary>
			{@const deploys = await getDeploySettings(repo)}
			<DeployDialog
				bind:open={managingDeploys}
				{repo}
				secrets={deploys.secrets}
				machine={deploys.machine}
				onmachine={(machine) => setDeployMachine({ repo, machine })}
				onsave={(secret) => setDeploySecret({ repo, ...secret })}
				onremove={(name) => deleteDeploySecret({ repo, name })}
			/>
			{#snippet failed()}
				<Toast ondismiss={() => (managingDeploys = false)}>Couldn't load deploy settings</Toast>
			{/snippet}
		</svelte:boundary>
	{/if}
	{#if cloning}
		<svelte:boundary>
			{@const access = await getGitAccess(repo)}
			<CloneDialog
				bind:open={cloning}
				{repo}
				url={access.url}
				tokens={access.tokens}
				{created}
				oncreate={async (token) => (created = await createGitAccessToken({ repo, ...token }))}
				onrevoke={(id) => revokeGitAccessToken({ repo, id })}
			/>
			{#snippet failed()}
				<Toast ondismiss={() => (cloning = false)}>Couldn't load clone access</Toast>
			{/snippet}
		</svelte:boundary>
	{/if}
</div>

<style>
	.app {
		block-size: 100dvh;
	}
</style>

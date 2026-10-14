<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		AppShell,
		CloneDialog,
		DeployDialog,
		Toast,
		type Mode,
		type SimilarThread,
		type ThreadListItem
	} from '@regit/ui';
	import type { Attachment } from 'svelte/attachments';
	import {
		defaultMachine,
		type LiveMessage,
		type Machine,
		type MainStatus,
		type ThreadActivity,
		type ThreadSummary
	} from '@regit/core';
	import { setLiveActivity } from '#lib/activity.ts';
	import { connectLive } from '#lib/live.ts';
	import {
		assessRequest,
		createGitAccessToken,
		deleteDeploySecret,
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
	let threads = $derived<ThreadListItem[]>(
		summaries.map((thread) => ({
			id: thread.id,
			headline: thread.headline || 'New thread',
			status: thread.status,
			updatedAt: thread.updatedAt,
			href: `/${repo}/${thread.id}`,
			conflictsWith: thread.behind?.conflicts.length ? thread.behind.branch : undefined,
			failed:
				thread.failure?.title ??
				(thread.shipped?.verdict === 'failed' ? `Broke ${main.branch ?? 'main'}` : undefined)
		}))
	);

	let alert = $state<{ thread: string; text: string } | null>(null);
	const alerted = new Map<string, number>();

	// A thread that fails while someone looks elsewhere gets a toast; the thread list keeps the mark.
	function notice({ id, headline, failure }: ThreadSummary) {
		if (!failure || alerted.get(id) === failure.at) return;
		alerted.set(id, failure.at);
		if (id === page.params.thread || Date.now() - failure.at > 60_000) return;
		alert = { thread: id, text: `${headline || 'New thread'}: ${failure.title.toLowerCase()}` };
	}

	const live: Attachment = () =>
		connectLive(
			`/${repo}/live`,
			{
				reconnected() {
					for (const thread of Object.keys(activities)) delete activities[thread];
					liveMain = null;
					getMain(repo).refresh();
					getThreads(repo).refresh();
					if (page.params.thread) getThread({ repo, id: page.params.thread }).refresh();
				},
				message(data) {
					const message = JSON.parse(data) as LiveMessage;
					if (message.type === 'main') {
						liveMain = { repo, main: message.main };
						return;
					}
					if (message.type === 'activity') {
						activities[message.thread] = message.activity;
						return;
					}
					const thread = message.type === 'entry' ? message.thread : message.summary.id;
					if (message.type === 'thread') {
						notice(message.summary);
						getThreads(repo).refresh();
					}
					if (thread === page.params.thread) getThread({ repo, id: thread }).refresh();
				}
			},
			{
				open: (url) => new EventSource(url),
				page: window,
				visible: () => document.visibilityState === 'visible'
			}
		);

	let managingDeploys = $state(false);
	let deploys = $derived(managingDeploys ? await getDeploySettings(repo) : null);

	let cloning = $state(false);
	let created = $state<{ label: string; secret: string } | null>(null);
	let access = $derived(cloning ? await getGitAccess(repo) : null);

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
		await goto(`/${repo}/${summary.id}`);
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
		current={page.params.thread}
		account={user}
		bind:mode
		bind:machine
		onswitchrepo={(name) => goto(`/${name}`)}
		oncreaterepo={createAndOpen}
		onstart={start}
		{similar}
		{size}
		{main}
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
	{#if alert}
		{@const { thread } = alert}
		<Toast
			action={{ label: 'Open', onclick: () => goto(`/${repo}/${thread}`) }}
			ondismiss={() => (alert = null)}>{alert.text}</Toast
		>
	{/if}
	{#if deploys}
		<DeployDialog
			bind:open={managingDeploys}
			{repo}
			secrets={deploys.secrets}
			machine={deploys.machine}
			onmachine={(machine) => setDeployMachine({ repo, machine })}
			onsave={(secret) => setDeploySecret({ repo, ...secret })}
			onremove={(name) => deleteDeploySecret({ repo, name })}
		/>
	{/if}
	{#if access}
		<CloneDialog
			bind:open={cloning}
			{repo}
			url={access.url}
			tokens={access.tokens}
			{created}
			oncreate={async (token) => (created = await createGitAccessToken({ repo, ...token }))}
			onrevoke={(id) => revokeGitAccessToken({ repo, id })}
		/>
	{/if}
</div>

<style>
	.app {
		block-size: 100dvh;
	}
</style>

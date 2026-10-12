<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		AppShell,
		CloneDialog,
		type Mode,
		type SimilarThread,
		type ThreadListItem
	} from '@regit/ui';
	import type { Attachment } from 'svelte/attachments';
	import { defaultMachine, type LiveMessage, type Machine, type ThreadActivity } from '@regit/core';
	import { setLiveActivity } from '#lib/activity.ts';
	import {
		assessRequest,
		createGitAccessToken,
		getGitAccess,
		getRepos,
		revokeGitAccessToken,
		getThread,
		getThreads,
		getUser,
		openThread
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
	let summaries = $derived(await getThreads(repo));
	let threads = $derived<ThreadListItem[]>(
		summaries.map((thread) => ({
			id: thread.id,
			headline: thread.headline || 'New thread',
			status: thread.status,
			updatedAt: thread.updatedAt,
			href: `/${repo}/${thread.id}`,
			conflicts: !!thread.behind?.conflicts.length
		}))
	);

	const live: Attachment = () => {
		const source = new EventSource(`/${repo}/live`);
		source.addEventListener('message', (event) => {
			const message = JSON.parse(event.data) as LiveMessage;
			if (message.type === 'activity') {
				activities[message.thread] = message.activity;
				return;
			}
			const thread = message.type === 'entry' ? message.thread : message.summary.id;
			if (message.type === 'thread') getThreads(repo).refresh();
			if (thread === page.params.thread) getThread({ repo, id: thread }).refresh();
		});
		return () => source.close();
	};

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

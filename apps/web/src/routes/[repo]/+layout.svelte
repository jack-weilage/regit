<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { AppShell, type Mode, type ThreadListItem } from '@regit/ui';
	import type { Attachment } from 'svelte/attachments';
	import type { LiveMessage } from '@regit/core';
	import { getRepos, getThread, getThreads, getUser, openThread } from '#lib/data.remote.ts';
	import { createAndOpen } from '#lib/repos.ts';

	let { children, params } = $props();

	let mode = $state<Mode>('medium');

	let repo = $derived(params.repo);
	let user = $derived(await getUser());
	let repos = $derived((await getRepos()).map((repo) => repo.name));
	let threads = $derived<ThreadListItem[]>(
		(await getThreads(repo)).map((thread) => ({
			id: thread.id,
			headline: thread.headline || 'Drafting an intent…',
			status: thread.status,
			updatedAt: thread.updatedAt,
			href: `/${repo}/${thread.id}`
		}))
	);

	const live: Attachment = () => {
		const source = new EventSource(`/${repo}/live`);
		source.addEventListener('message', (event) => {
			const message = JSON.parse(event.data) as LiveMessage;
			const thread = message.type === 'entry' ? message.thread : message.summary.id;
			if (message.type === 'thread') getThreads(repo).refresh();
			if (thread === page.params.thread) getThread({ repo, id: thread }).refresh();
		});
		return () => source.close();
	};

	async function start(thread: { text: string; mode: Mode }) {
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
		onswitchrepo={(name) => goto(`/${name}`)}
		oncreaterepo={createAndOpen}
		onstart={start}
	>
		{@render children()}
	</AppShell>
</div>

<style>
	.app {
		block-size: 100dvh;
	}
</style>

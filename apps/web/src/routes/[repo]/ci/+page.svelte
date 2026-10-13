<script lang="ts">
	import { CiView } from '@regit/ui';
	import type { CiRun } from '@regit/core';
	import {
		cancelCi,
		deleteCiSecret,
		getCiLog,
		getCiRuns,
		rerunCi,
		setCiSecret
	} from '#lib/data.remote.ts';

	let { params } = $props();

	let repo = $derived(params.repo);
	let ci = $derived(await getCiRuns(repo));
	let selected = $state<string | null>(null);
	let step = $state<string | null>(null);

	let run = $derived(ci.runs.find((run) => run.id === selected) ?? ci.runs[0]);
	let shown = $derived(run?.steps.find((candidate) => candidate.name === step) ?? focus(run));
	let log = $derived(run && shown ? await getCiLog({ repo, id: run.id, step: shown.name }) : null);

	// Live updates refresh the runs; a step whose log grew is fetched again.
	let seen = '';
	$effect(() => {
		if (!run || !shown) return;
		const key = `${run.id}/${shown.name}`;
		const size = `${key}:${shown.logSize}`;
		if (seen.startsWith(`${key}:`) && seen !== size)
			getCiLog({ repo, id: run.id, step: shown.name }).refresh();
		seen = size;
	});

	function focus(run: CiRun | undefined) {
		return (
			run?.steps.find((step) => step.status === 'running') ??
			run?.steps.find((step) => step.status === 'failed') ??
			run?.steps.findLast((step) => step.status !== 'pending' && step.status !== 'skipped')
		);
	}
</script>

<svelte:head>
	<title>CI · {repo} · ReGit</title>
</svelte:head>

<CiView
	{repo}
	runs={ci.runs}
	queued={ci.queued}
	bind:selected
	bind:step={() => shown?.name ?? null, (name) => (step = name)}
	{log}
	secrets={ci.secrets}
	onrerun={(id) => rerunCi({ repo, id })}
	oncancel={(id) => cancelCi({ repo, id })}
	onsetsecret={(secret) => setCiSecret({ repo, ...secret })}
	ondeletesecret={(name) => deleteCiSecret({ repo, name })}
/>

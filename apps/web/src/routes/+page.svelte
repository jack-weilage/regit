<script lang="ts">
	import { Button, NewRepoPalette } from '@regit/ui';
	import { getRepos } from '#lib/forge.remote.ts';
	import { createAndOpen } from '#lib/repos.ts';

	let repos = $derived(await getRepos());
</script>

<svelte:head>
	<title>ReGit</title>
</svelte:head>

<!-- TODO: design the home page -->
<main>
	<h1>ReGit</h1>
	{#each repos as repo (repo.name)}
		<a class="repo" href="/{repo.name}">{repo.name}</a>
	{:else}
		<p>No repositories yet.</p>
	{/each}
	<div>
		<Button variant="primary" popovertarget="new-repo">New repository</Button>
	</div>
	<NewRepoPalette id="new-repo" repos={repos.map((repo) => repo.name)} oncreate={createAndOpen} />
</main>

<style>
	main {
		display: grid;
		gap: var(--space-3);
		max-inline-size: 32rem;
		margin: var(--space-7) auto;
		padding-inline: var(--space-6);
		font-size: var(--text-chat);
	}

	h1 {
		margin: 0 0 var(--space-4);
		font-family: var(--font-mono);
	}

	.repo {
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius);
		color: inherit;
		font-family: var(--font-mono);
		text-decoration: none;

		&:hover {
			background: var(--color-surface);
		}
	}

	p {
		margin: 0;
		color: var(--color-muted);
	}
</style>

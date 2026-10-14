<script lang="ts">
	import { updated } from '$app/state';
	import '@regit/ui/theme.css';
	import favicon from '#lib/assets/favicon.svg';
	import UpdatePrompt from '#lib/UpdatePrompt.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
{#if updated.current}
	<UpdatePrompt />
{/if}

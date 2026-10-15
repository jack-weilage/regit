<script lang="ts">
	import { setLiveActivity } from '#lib/activity.ts';
	import Page from '../../src/routes/[repo]/[thread]/+page.svelte';

	type Ref = { id: string; number: number };

	let { thread: initial }: { thread: Ref } = $props();

	// svelte-ignore state_referenced_locally
	let thread = $state.raw(initial);

	setLiveActivity({});

	export function open(next: Ref) {
		thread = next;
	}
</script>

<svelte:boundary>
	<Page params={{ repo: 'demo', thread: String(thread.number) }} data={{ threadRef: thread }} />
	{#snippet pending()}
		<p>Loading</p>
	{/snippet}
</svelte:boundary>

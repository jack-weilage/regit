<script lang="ts">
	import type { Snippet } from 'svelte';
	import { setTimeOptions } from './chat/format.ts';

	interface Props {
		locale?: string;
		timeZone?: string;
		children: Snippet;
	}

	let { locale, timeZone, children }: Props = $props();

	setTimeOptions(() => ({ locale, timeZone }));
</script>

{@render children()}

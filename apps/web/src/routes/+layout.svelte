<script lang="ts">
	import '@regit/ui/theme.css';
	import { browser } from '$app/env';
	import { TimeOptions } from '@regit/ui';
	import { untrack } from 'svelte';
	import favicon from '#lib/assets/favicon.svg';
	import { browserTimeOptions, preferenceCookies, remember } from '#lib/preferences.ts';

	let { data, children } = $props();

	// The server formats times with the options this browser saved last visit, so hydration matches.
	const time = browser ? browserTimeOptions() : untrack(() => data.time);

	$effect(() => {
		if (time.locale && time.locale !== data.time.locale)
			remember(preferenceCookies.locale, time.locale);
		if (time.timeZone && time.timeZone !== data.time.timeZone)
			remember(preferenceCookies.timeZone, time.timeZone);
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<TimeOptions locale={time.locale} timeZone={time.timeZone}>
	{@render children()}
</TimeOptions>

<script lang="ts">
	import { page } from '$app/state';
	import { ErrorNotice } from '@regit/ui';
	import { errorDetail, errorTitle } from '#lib/errors.ts';
</script>

<svelte:head>
	<title>{errorTitle(page.status)} · ReGit</title>
</svelte:head>

<main>
	<ErrorNotice
		title={errorTitle(page.status)}
		detail={errorDetail(page.status, page.error)}
		back={page.url.pathname === '/' ? undefined : { href: '/', label: 'All repositories' }}
		onretry={() => location.reload()}
	/>
</main>

<style>
	main {
		display: grid;
		min-block-size: 100dvh;
	}
</style>

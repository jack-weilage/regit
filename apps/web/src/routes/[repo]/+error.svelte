<script lang="ts">
	import { page } from '$app/state';
	import { ErrorNotice } from '@regit/ui';
	import { errorDetail, errorTitle } from '#lib/errors.ts';
</script>

<ErrorNotice
	title={errorTitle(page.status)}
	detail={errorDetail(page.status, page.error)}
	back={page.params.thread ? { href: `/${page.params.repo}`, label: 'Back to threads' } : undefined}
	onretry={() => location.reload()}
/>

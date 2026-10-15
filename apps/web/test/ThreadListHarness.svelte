<script lang="ts">
	import { ThreadList, TimeOptions, type ThreadListItem } from '@regit/ui';

	interface Props {
		locale?: string;
		timeZone?: string;
		threads: ThreadListItem[];
		current?: string;
		now: number;
		archivedOpen?: boolean;
	}

	let { locale, timeZone, threads, current, now, archivedOpen }: Props = $props();
</script>

<TimeOptions {locale} {timeZone}>
	<ThreadList {threads} {current} {now} {archivedOpen} />
</TimeOptions>

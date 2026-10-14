<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import ErrorBoundary from './ErrorBoundary.svelte';

	const { Story } = defineMeta({
		title: 'Error boundary',
		component: ErrorBoundary,
		tags: ['!autodocs']
	});
</script>

<script lang="ts">
	let renders = 0;

	function flaky() {
		if (++renders === 1) throw new Error('First render failed');
		return 'Rendered on retry';
	}
</script>

<Story
	name="Failed, then retried"
	asChild
	play={async ({ canvas, userEvent }) => {
		await waitFor(() => expect(canvas.getByText("Couldn't show this entry")).toBeVisible());
		await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
		await waitFor(() => expect(canvas.getByText('Rendered on retry')).toBeVisible());
	}}
>
	<ErrorBoundary title="Couldn't show this entry">
		<p>{flaky()}</p>
	</ErrorBoundary>
</Story>

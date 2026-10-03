<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatReview from './ChatReview.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Review',
		component: ChatReview,
		args: {
			round: 1,
			doneWhen: [
				'Settings render in under a second for 10k members',
				'Members load as you scroll',
				'Existing member tests still pass'
			]
		}
	});
</script>

<Story
	name="Sent back"
	args={{ verdict: 'sent-back', checks: ['met', 'unmet', 'met'] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('region', { name: 'Review 1' })).toHaveTextContent(
			'2 of 3 met · sent back to the agent'
		);
	}}
/>

<Story
	name="Needs you"
	args={{ verdict: 'needs-you', round: 2, checks: ['met', 'met', 'unverified'] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText("2 of 3 met · 1 couldn't be checked")).toBeVisible();
	}}
/>

<Story
	name="Passed"
	args={{ verdict: 'passed', round: 2, checks: ['met', 'met', 'met'] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('All 3 met · ready to ship')).toBeVisible();
	}}
/>

<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ShipPanel from './ShipPanel.svelte';
	import { intent } from './fixtures.ts';

	const now = Date.UTC(2026, 9, 12, 18);

	const { Story } = defineMeta({
		title: 'Chat/Ship',
		component: ShipPanel,
		tags: ['!autodocs'],
		args: { intent, branch: 'main', status: 'needs-you', onship: fn().mockResolvedValue(undefined) }
	});
</script>

<Story
	name="Ship"
	play={async ({ args, canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		const title = canvas.getByRole('textbox', { name: 'Commit title' });
		await expect(title).toHaveValue(intent.headline);
		await expect(canvas.getByRole('textbox', { name: 'Commit body' })).toHaveValue(intent.purpose);
		await userEvent.clear(title);
		await userEvent.type(title, 'perf: paginate members');
		await userEvent.click(canvas.getByRole('button', { name: 'Ship commit' }));
		await waitFor(() => expect(canvas.queryByRole('textbox', { name: 'Commit title' })).toBeNull());
		await expect(args.onship).toHaveBeenCalledWith({
			title: 'perf: paginate members',
			body: intent.purpose
		});
	}}
/>

<Story
	name="Done when"
	args={{
		results: {
			[intent.doneWhen[0]!]: {
				status: 'met',
				evidence: 'Rendered settings before the member request resolved',
				at: 0,
				tree: 'a1b2c3d'
			},
			[intent.doneWhen[1]!]: {
				status: 'unverified',
				evidence: 'Needs a browser',
				at: 0,
				tree: 'a1b2c3d'
			}
		}
	}}
	play={async ({ canvas }) => {
		const list = canvas.getByRole('list', { name: '1 of 2 done-when checks not met' });
		await expect(list).toHaveTextContent('Members load as you scroll. Unverified');
		await expect(list).not.toHaveTextContent(intent.doneWhen[0]!);
	}}
/>

<Story
	name="Working"
	args={{ status: 'running' }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Ship' })).toBeDisabled();
	}}
/>

<Story
	name="Starting"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'starting',
			note: null,
			branch: null,
			since: now - 1_000,
			started: now - 1_000
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Shipping to main')).toBeVisible();
		await expect(canvas.queryByRole('button')).toBeNull();
		await expect(canvas.queryByRole('listitem', { current: 'step' })).toBeNull();
	}}
/>

<Story
	name="Pushing"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'pushing',
			note: 'a1b2c3d onto 9f8e7d6',
			branch: 'main',
			since: now - 12_000,
			started: now - 12_000
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('listitem', { current: 'step' })).toHaveTextContent(
			'Pushing to main a1b2c3d onto 9f8e7d6'
		);
		await expect(canvas.getByText('12s')).toBeVisible();
		await expect(canvas.queryByText('Running checks')).toBeNull();
	}}
/>

<Story
	name="Rebuilding"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'building',
			note: 'master moved, so rebuilding on top of it',
			branch: 'master',
			since: now - 3_000,
			started: now - 31_000
		}
	}}
/>

<Story
	name="Retrying"
	args={{
		status: 'shipping',
		now,
		progress: {
			stage: 'pushing',
			note: null,
			branch: null,
			since: now - 4_000,
			started: now - 30_000,
			retry: {
				what: 'ship',
				failures: [
					{
						at: now - 4_000,
						label: 'Push',
						error: 'The requested URL returned error: 503'
					}
				],
				attempt: 2,
				limit: 4,
				next: now + 6_000
			}
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent('Push failed · retrying in 6s');
		await expect(canvas.getByText('Ship attempt 2 of 4')).toBeVisible();
	}}
/>

<Story
	name="Error"
	args={{
		onship: fn(async () => {
			throw new Error('Repository owner permission is required');
		})
	}}
	play={async ({ canvas, userEvent }) => {
		await userEvent.click(canvas.getByRole('button', { name: 'Ship' }));
		await userEvent.click(canvas.getByRole('button', { name: 'Ship commit' }));
		await waitFor(() =>
			expect(canvas.getByRole('alert')).toHaveTextContent('Repository owner permission is required')
		);
		await expect(canvas.getByRole('button', { name: 'Ship commit' })).toBeEnabled();
	}}
/>

<Story
	name="Checks passed"
	args={{
		checks: {
			action: 'handoff',
			at: now,
			results: [
				{ name: 'typecheck', kind: 'run', status: 'passed', reused: false, output: '' },
				{ name: 'tests', kind: 'run', status: 'passed', reused: true, output: '' }
			]
		}
	}}
	play={async ({ canvas }) => {
		const list = canvas.getByRole('list', { name: 'Checks before handoff' });
		await expect(list).toHaveTextContent('typecheck');
		await expect(canvas.getAllByText('unchanged')).toHaveLength(1);
	}}
/>

<Story
	name="Checks failed"
	args={{
		checks: {
			action: 'handoff',
			at: now,
			results: [
				{
					name: 'typecheck',
					kind: 'run',
					status: 'failed',
					reused: false,
					output:
						"src/members.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.\nFound 1 error in src/members.ts:42"
				},
				{
					name: 'Changelog updated',
					kind: 'ask',
					status: 'warned',
					reused: true,
					output: 'CHANGELOG.md has no entry for member pagination.'
				}
			]
		}
	}}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByRole('list', { name: 'Checks before handoff' })).toBeVisible();
		await expect(canvas.queryByText(/error TS2322/)).not.toBeVisible();
		await userEvent.click(canvas.getByText('typecheck'));
		await waitFor(() => expect(canvas.getByText(/error TS2322/)).toBeVisible());
	}}
/>

<Story name="Narrow" asChild>
	<div style="inline-size: 22rem; max-inline-size: 100%">
		<ShipPanel
			{intent}
			branch="main"
			status="needs-you"
			onship={fn().mockResolvedValue(undefined)}
		/>
	</div>
</Story>

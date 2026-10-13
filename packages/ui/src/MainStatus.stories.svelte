<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, waitFor } from 'storybook/test';
	import type { MainStatus as Main } from '@regit/core';
	import MainStatus from './MainStatus.svelte';

	const now = Date.UTC(2026, 9, 13, 18);
	const minute = 60 * 1000;
	const sha = (char: string) => char.repeat(40);

	const base: Main = {
		branch: 'main',
		verifying: null,
		verified: { sha: sha('a'), at: now - 3 * minute, passed: true, results: [], culprit: null },
		green: { sha: sha('a'), at: now - 3 * minute },
		deployed: { sha: sha('a'), at: now - 2 * minute },
		deployFailure: null,
		failure: null
	};

	const { Story } = defineMeta({
		title: 'Main status',
		component: MainStatus,
		tags: ['!autodocs'],
		args: { main: base, now }
	});
</script>

<Story
	name="Deployed"
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Deployed aaaaaaa')).toBeVisible();
		await expect(canvas.getByText('2 minutes ago')).toBeVisible();
	}}
/>

<Story
	name="Checking"
	args={{
		main: {
			...base,
			verifying: {
				sha: sha('b'),
				stage: 'checking',
				note: null,
				since: now - 40_000,
				started: now - 40_000
			}
		}
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Checking bbbbbbb')).toBeVisible();
		await expect(canvas.getByText('40s')).toBeVisible();
	}}
/>

<Story
	name="Failing"
	args={{
		culpritHref: '/regit/3f2a9c1b7d4e',
		main: {
			...base,
			verified: {
				sha: sha('c'),
				at: now - minute,
				passed: false,
				results: [
					{
						name: 'test',
						kind: 'run',
						status: 'failed',
						reused: false,
						output: 'exit code 1\nFAIL test/shipping.test.ts > ships finished work'
					},
					{ name: 'check', kind: 'run', status: 'passed', reused: true, output: '' }
				],
				culprit: { sha: sha('b'), headline: 'fix(ship): squash once', thread: '3f2a9c1b7d4e' }
			},
			verifying: {
				sha: sha('d'),
				stage: 'bisecting',
				note: 'Checking bbbbbbb',
				since: now - 5000,
				started: now - 65_000
			}
		}
	}}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByText('main is failing')).toBeVisible();
		await expect(canvas.getByRole('link', { name: 'fix(ship): squash once' })).toHaveAttribute(
			'href',
			'/regit/3f2a9c1b7d4e'
		);
		await expect(canvas.queryByText('check')).toBeNull();
		await userEvent.click(canvas.getByText('test'));
		await waitFor(() => expect(canvas.getByText(/FAIL test\/shipping/)).toBeVisible());
		await expect(canvas.getByText('Finding what broke ddddddd')).toBeVisible();
	}}
/>

<Story
	name="Deploy failed"
	args={{
		main: {
			...base,
			green: { sha: sha('e'), at: now - minute },
			deployFailure: {
				sha: sha('e'),
				at: now - 30_000,
				output: 'exit code 1\nAuthentication error'
			}
		}
	}}
	play={async ({ canvas, userEvent }) => {
		await expect(canvas.getByText('Deploying eeeeeee failed')).toBeVisible();
		await userEvent.click(canvas.getByText('Deploy output'));
		await waitFor(() => expect(canvas.getByText(/Authentication error/)).toBeVisible());
	}}
/>

<Story
	name="Couldn't check"
	args={{
		main: {
			...base,
			deployed: null,
			failure: { sha: sha('f'), at: now - minute, error: 'The main sandbox did not become healthy' }
		}
	}}
/>

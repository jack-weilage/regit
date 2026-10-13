<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import type { CiRun, CiStep } from '@regit/core';
	import type { ComponentProps } from 'svelte';
	import { expect, fn, waitFor } from 'storybook/test';
	import CiView from './CiView.svelte';

	const now = Date.UTC(2026, 9, 13, 18);
	const ago = (seconds: number) => now - seconds * 1000;

	const step = (
		name: string,
		command: string,
		status: CiStep['status'],
		startedAt: number | null = null,
		finishedAt: number | null = null,
		exitCode: number | null = null
	): CiStep => ({
		name,
		command,
		status,
		startedAt,
		finishedAt,
		exitCode,
		logSize: startedAt === null ? 0 : 2048
	});

	const running: CiRun = {
		id: 'r4',
		sha: '9f2c41ab7d0e5c3f',
		branch: 'main',
		headline: 'feat(billing): export invoices as CSV',
		status: 'running',
		by: null,
		startedAt: ago(95),
		finishedAt: null,
		error: null,
		steps: [
			step('Prepare', '', 'passed', ago(95), ago(60), 0),
			step('check', 'bun run check && bun run test', 'running', ago(60)),
			step('deploy', 'bun run deploy', 'pending')
		]
	};

	const passed: CiRun = {
		id: 'r3',
		sha: '4b81e0c2f9a7d613',
		branch: 'main',
		headline: 'fix(auth): refresh expired sessions',
		status: 'passed',
		by: 'Sam Rivera',
		startedAt: ago(3 * 3600),
		finishedAt: ago(3 * 3600 - 192),
		error: null,
		steps: [
			step('Prepare', '', 'passed', ago(3 * 3600), ago(3 * 3600 - 40), 0),
			step(
				'check',
				'bun run check && bun run test',
				'passed',
				ago(3 * 3600 - 40),
				ago(3 * 3600 - 150),
				0
			),
			step('deploy', 'bun run deploy', 'passed', ago(3 * 3600 - 150), ago(3 * 3600 - 192), 0)
		]
	};

	const failed: CiRun = {
		id: 'r2',
		sha: 'c07d5a19e3b2f480',
		branch: 'main',
		headline: 'refactor(api): split the router',
		status: 'failed',
		by: null,
		startedAt: ago(26 * 3600),
		finishedAt: ago(26 * 3600 - 84),
		error: 'check exited with code 1.',
		steps: [
			step('Prepare', '', 'passed', ago(26 * 3600), ago(26 * 3600 - 38), 0),
			step(
				'check',
				'bun run check && bun run test',
				'failed',
				ago(26 * 3600 - 38),
				ago(26 * 3600 - 84),
				1
			),
			step('deploy', 'bun run deploy', 'skipped')
		]
	};

	const cancelled: CiRun = {
		id: 'r1',
		sha: '17ae33d08c5b9f21',
		branch: 'main',
		headline: '',
		status: 'cancelled',
		by: null,
		startedAt: ago(50 * 3600),
		finishedAt: ago(50 * 3600 - 20),
		error: null,
		steps: [
			step('Prepare', '', 'cancelled', ago(50 * 3600), ago(50 * 3600 - 20)),
			step('check', 'bun run check && bun run test', 'skipped'),
			step('deploy', 'bun run deploy', 'skipped')
		]
	};

	const testLog = Array.from(
		{ length: 60 },
		(_, index) => `✓ src/routes/billing.test.ts > exports invoice ${index + 1} (${index + 3}ms)`
	).join('\n');

	const failedLog = [
		'$ bun run check && bun run test',
		'svelte-check found 1 error',
		'src/routes/api/+server.ts:14:9',
		"Error: Property 'router' does not exist on type 'App'.",
		'error: script "check" exited with code 1'
	].join('\n');

	const { Story } = defineMeta({
		title: 'CI',
		component: CiView,
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' },
		args: {
			repo: 'regit/web',
			now,
			onrerun: fn(),
			oncancel: fn(),
			onsetsecret: fn(),
			ondeletesecret: fn()
		}
	});
</script>

<script lang="ts">
	let bound = $state<{ run: string | null; step: string | null }>({ run: 'r2', step: null });
</script>

{#snippet frame(args: ComponentProps<typeof CiView>)}
	<div style="block-size: 40rem">
		<CiView {...args} />
	</div>
{/snippet}

<Story
	name="Running"
	args={{
		runs: [running, passed, failed],
		queued: {
			sha: 'e5d2a7c3b1f04986',
			branch: 'main',
			headline: 'perf(settings): load members lazily'
		},
		log: testLog,
		secrets: ['CLOUDFLARE_API_TOKEN', 'SENTRY_DSN']
	}}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByText(/Queued ·/)).toHaveTextContent('e5d2a7c');
		await expect(canvas.getByRole('button', { name: /Running check/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		const log = canvas.getByRole('log', { name: 'Log of check' });
		await waitFor(() =>
			expect(log.scrollTop + log.clientHeight).toBeGreaterThanOrEqual(log.scrollHeight - 1)
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Cancel' }));
		await expect(args.oncancel).toHaveBeenCalledWith('r4');

		const name = canvas.getByRole('textbox', { name: 'Secret name' });
		const value = canvas.getByLabelText('Secret value');
		await userEvent.type(name, 'api-token');
		await userEvent.type(value, 'secret');
		await expect(canvas.getByText(/Use uppercase letters/)).toBeVisible();
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
		await expect(args.onsetsecret).not.toHaveBeenCalled();

		await userEvent.clear(name);
		await userEvent.type(name, 'STRIPE_KEY');
		await expect(canvas.queryByText(/Use uppercase letters/)).toBeNull();
		await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
		await expect(args.onsetsecret).toHaveBeenCalledWith({ name: 'STRIPE_KEY', value: 'secret' });
		await expect(name).toHaveValue('');
		await expect(value).toHaveValue('');

		await userEvent.click(canvas.getByRole('button', { name: 'Remove SENTRY_DSN' }));
		await expect(args.ondeletesecret).toHaveBeenCalledWith('SENTRY_DSN');
	}}
	template={frame}
/>

<Story
	name="History"
	args={{
		runs: [passed, failed, cancelled],
		log: failedLog,
		secrets: ['CLOUDFLARE_API_TOKEN']
	}}
	play={async ({ args, canvas, userEvent }) => {
		await expect(canvas.getByText('check exited with code 1.')).toBeVisible();
		await expect(canvas.getByRole('button', { name: /Failed check exit 1/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		await userEvent.click(canvas.getByRole('button', { name: 'Run again' }));
		await expect(args.onrerun).toHaveBeenCalledWith('r2');

		await userEvent.click(canvas.getByRole('button', { name: /Passed Prepare/ }));
		await waitFor(() => expect(canvas.getByRole('log', { name: 'Log of Prepare' })).toBeVisible());
		await expect(canvas.getByRole('status', { name: 'Bound' })).toHaveTextContent('r2 Prepare');

		const latest = canvas.getByRole('button', { name: /fix\(auth\): refresh expired sessions/ });
		await userEvent.click(latest);
		await expect(latest).toHaveAttribute('aria-pressed', 'true');
		await expect(canvas.getByRole('status', { name: 'Bound' })).toHaveTextContent('r3');
		await expect(canvas.getByText(/run again by Sam Rivera/)).toBeVisible();
		await expect(canvas.getByRole('heading', { name: /refresh expired sessions/ })).toBeVisible();
		await expect(canvas.getByRole('button', { name: /Passed deploy/ })).toHaveAttribute(
			'aria-pressed',
			'true'
		);
	}}
>
	{#snippet template(args)}
		<div style="block-size: 40rem">
			<CiView {...args} bind:selected={bound.run} bind:step={bound.step} />
		</div>
		<output aria-label="Bound">{bound.run} {bound.step}</output>
	{/snippet}
</Story>

<Story
	name="Viewer"
	args={{ runs: [failed, passed], log: failedLog, secrets: null }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('heading', { name: /split the router/ })).toBeVisible();
		await expect(canvas.queryByRole('button', { name: 'Run again' })).toBeNull();
		await expect(canvas.queryByRole('button', { name: 'Cancel' })).toBeNull();
		await expect(canvas.queryByRole('heading', { name: 'Secrets' })).toBeNull();
	}}
	template={frame}
/>

<Story
	name="Narrow"
	args={{ runs: [failed, passed], log: failedLog, secrets: ['CLOUDFLARE_API_TOKEN'] }}
>
	{#snippet template(args)}
		<div style="block-size: 40rem; inline-size: 22rem">
			<CiView {...args} />
		</div>
	{/snippet}
</Story>

<Story
	name="Empty"
	args={{ runs: [], secrets: [] }}
	play={async ({ canvas }) => {
		await expect(canvas.getByText(/No runs yet/)).toBeVisible();
		await expect(canvas.getByRole('heading', { name: 'Secrets' })).toBeVisible();
	}}
	template={frame}
/>

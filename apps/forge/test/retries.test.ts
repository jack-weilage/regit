import { expect, test } from 'vitest';
import { setup } from './support.ts';

const { worker, script, modelRequests, seed } = await setup();

const sam = { name: 'Sam', kind: 'person' } as const;
const outage = [{ status: 503 }];
const done = [{ type: 'response.output_text.delta', delta: 'Done.' }];

async function open(repo: string) {
	const env = await worker.getEnv();
	const coordinator = env.REPOS.getByName(repo);
	const { id } = await coordinator.openThread({
		repo,
		author: sam,
		text: 'Read the README.',
		mode: 'small',
		machine: 'standard-1'
	});
	return { coordinator, id };
}

test('retries a model outage and records that the thread recovered', async () => {
	await seed('flaky', { 'README.md': '# Flaky\n' });
	await script('flaky', [outage, outage, done]);
	const { coordinator, id } = await open('flaky');

	await expect
		.poll(async () => (await coordinator.thread(id))!.summary.status, { timeout: 60_000 })
		.toBe('idle');
	const { entries, summary } = (await coordinator.thread(id))!;
	expect(summary.failure).toBeNull();
	expect(entries.find((entry) => entry.type === 'recovered')).toMatchObject({
		failures: [
			{ label: 'Model request', error: 'The model is overloaded' },
			{ label: 'Model request', error: 'The model is overloaded' }
		]
	});
	expect(entries.at(-1)).toMatchObject({ type: 'message', text: 'Done.' });
	expect(await modelRequests('flaky')).toHaveLength(3);
});

test('stops after retrying a turn, then picks it back up when a person asks', async () => {
	await seed('outage', { 'README.md': '# Outage\n' });
	await script(
		'outage',
		Array.from({ length: 25 }, () => outage)
	);
	const { coordinator, id } = await open('outage');

	await expect
		.poll(async () => (await coordinator.thread(id))!.summary.failure, { timeout: 60_000 })
		.toMatchObject({ title: 'The agent stopped', resumable: true });
	const failed = (await coordinator.thread(id))!;
	expect(failed.summary.status).toBe('idle');
	expect(failed.summary.needsYou).toBe(true);
	const failure = failed.entries.at(-1);
	expect(failure).toMatchObject({ type: 'failure', error: 'The model is overloaded' });
	expect(failure?.type === 'failure' && failure.failures).toHaveLength(25);

	await script('outage', [done]);
	await coordinator.resume(id, sam);
	await expect
		.poll(async () => (await coordinator.thread(id))!.entries.at(-1), { timeout: 60_000 })
		.toMatchObject({ type: 'message', text: 'Done.' });
	const resumed = (await coordinator.thread(id))!;
	expect(resumed.summary.failure).toBeNull();
	const [request] = await modelRequests('outage');
	expect(JSON.stringify(request!.query)).toContain(
		'Your last turn failed: The model is overloaded'
	);
});

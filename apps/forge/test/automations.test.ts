import { expect, test } from 'vitest';
import type { Automation, LiveMessage } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { modelRequests, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const call = (id: string, name: string, args: object) => [
	{
		type: 'response.output_item.done',
		item: { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) }
	}
];
const create = (id: string, args: object) => call(id, 'create_automation', args);

async function requestsMentioning(repo: string, text: string) {
	return (await modelRequests(repo)).filter((request) =>
		JSON.stringify(request.query).includes(text)
	);
}

test('delivers a timed message the agent scheduled to its own thread, then ends it', async () => {
	const { repo, id } = await startedThread('reminding', [
		create('timed', {
			name: 'nudge',
			on: { after: '3s' },
			message: 'Look at the notes again.'
		}),
		create('invalid', {
			name: 'confused',
			on: { after: '1h', event: 'deployed' },
			message: 'Two triggers'
		}),
		say('Set up.'),
		say('Looked again.')
	]);
	const detail = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'automation')
	);
	expect(detail.entries.find((entry) => entry.type === 'automation')).toMatchObject({
		name: 'nudge',
		trigger: '3s after it was set up',
		text: 'Look at the notes again.',
		run: 1,
		limit: 1
	});
	await expect
		.poll(
			async () => (await requestsMentioning('reminding', 'Look at the notes again.')).length > 1
		)
		.toBe(true);
	const delivered = await requestsMentioning(
		'reminding',
		'Automation \\"nudge\\": (3s after it was set up; run 1 of 1; you set this automation up in this thread) Look at the notes again.'
	);
	expect(delivered.length).toBeGreaterThan(0);
	expect(
		await requestsMentioning('reminding', 'Give on exactly one of event, at, after or schedule')
	).not.toEqual([]);

	const [nudge, ...others] = (await repo.automations(id)) as Automation[];
	expect(others).toEqual([]);
	expect(nudge).toMatchObject({
		name: 'nudge',
		runs: { done: 1, limit: 1 },
		nextAt: null,
		ended: { reason: 'runs' }
	});
});

test("runs when what the thread shipped deploys and keeps waiting for events that don't happen", async () => {
	const { repo, sam, id } = await startedThread(
		'watching',
		[
			writeNotes('# Notes\\n'),
			create('deployed', {
				name: 'post-deploy-check',
				on: { event: 'deployed' },
				message: 'Check the deployed notes render.'
			}),
			create('reverted', {
				name: 'revert-check',
				on: { event: 'reverted' },
				message: 'Find out why it was reverted.'
			}),
			say('Done.'),
			say('The deploy looks fine.')
		],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
`,
			'.agents/deploy': 'echo deployed\n'
		}
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(
		((await repo.automations(id)) as Automation[]).map(({ name, nextAt, ended }) => ({
			name,
			nextAt,
			ended
		}))
	).toEqual([
		{ name: 'post-deploy-check', nextAt: null, ended: null },
		{ name: 'revert-check', nextAt: null, ended: null }
	]);

	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	const deployed = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.shipped?.verdict === 'deployed' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'The deploy looks fine.'
			)
	);
	const sha = deployed.summary.shipped!.sha.slice(0, 7);
	expect(deployed.entries.filter((entry) => entry.type === 'automation')).toMatchObject([
		{
			name: 'post-deploy-check',
			trigger: 'When what this thread shipped deploys',
			text: 'Check the deployed notes render.'
		}
	]);
	expect(
		await requestsMentioning('watching', `When what this thread shipped deploys: ${sha} deployed`)
	).not.toEqual([]);
	const [revert, check] = (await repo.automations(id)) as Automation[];
	expect(revert).toMatchObject({ name: 'revert-check', nextAt: null, ended: null });
	expect(check).toMatchObject({ name: 'post-deploy-check', ended: { reason: 'runs' } });
});

test('a person can cancel an automation, and discarding the thread ends the rest', async () => {
	const { repo, sam, id } = await startedThread('cancelling', [
		create('first', { name: 'first', on: { after: '1h' }, message: 'First.' }),
		create('second', {
			name: 'second',
			on: { schedule: '0 9 * * 1-5', timezone: 'Europe/Berlin' },
			message: 'Second.',
			expires: { runs: 3 }
		}),
		say('Both set up.')
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const [first, second] = (await repo.automations(id)) as Automation[];
	expect(second).toMatchObject({ runs: { done: 0, limit: 3 }, ended: null });
	expect(second!.nextAt).toBeGreaterThan(Date.now());

	expect((await repo.thread(id))!.automations.map(({ name }) => name)).toEqual(['first', 'second']);

	const live: LiveMessage[] = [];
	const { webSocket: socket } = await repo.fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	socket!.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));
	await expect(repo.cancelAutomation(id, 'nope', sam)).rejects.toThrow();
	expect(await repo.cancelAutomation(id, first!.id, sam)).toMatchObject({
		ended: { reason: 'cancelled', by: 'Sam' }
	});
	await new Promise((resolve) => setTimeout(resolve, 100));
	socket!.close();
	expect(live).toContainEqual(
		expect.objectContaining({ type: 'thread', summary: expect.objectContaining({ id }) })
	);
	const detail = await repo.thread(id);
	expect(detail!.automations.find(({ name }) => name === 'first')).toMatchObject({
		ended: { reason: 'cancelled' }
	});
	expect(detail!.entries.at(-1)).toMatchObject({
		type: 'event',
		text: 'Sam cancelled the automation "first"'
	});

	await repo.discard(id, sam);
	expect(
		((await repo.automations(id)) as Automation[]).map(({ name, ended }) => [name, ended?.reason])
	).toEqual([
		['second', 'thread'],
		['first', 'cancelled']
	]);
});

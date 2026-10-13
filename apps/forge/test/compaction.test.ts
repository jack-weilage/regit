import { expect, test } from 'vitest';
import { setup } from './support.ts';

const { worker, script, modelRequests, seed } = await setup();

const sam = { name: 'Sam', kind: 'person' } as const;
const say = (delta: string) => ({ type: 'response.output_text.delta', delta });

test('compacts a long thread and replays only what follows the compaction', async () => {
	const item = { type: 'compaction', id: 'cmp_1', encrypted_content: 'sealed' };
	await seed('compact', { 'README.md': '# Compact\n' });
	await script('compact', [
		[say('First.')],
		[
			{ type: 'response.compaction.compacting', item_id: 'cmp_1', output_index: 0 },
			{ type: 'response.output_item.done', item },
			say('Second.')
		],
		[say('Third.')]
	]);
	const env = await worker.getEnv();
	const coordinator = env.REPOS.getByName('compact');
	const { id } = await coordinator.openThread({
		repo: 'compact',
		author: sam,
		text: 'Start.',
		mode: 'small',
		machine: 'standard-1'
	});
	const replied = (text: string) =>
		expect
			.poll(async () => (await coordinator.thread(id))!.entries.at(-1), { timeout: 60_000 })
			.toMatchObject({ type: 'message', text });

	await replied('First.');
	await coordinator.reply(id, { author: sam, text: 'Again.' });
	await replied('Second.');
	await coordinator.reply(id, { author: sam, text: 'Once more.' });
	await replied('Third.');

	const requests = await modelRequests('compact');
	expect(requests[0]!.query).toMatchObject({
		context_management: [{ type: 'compaction', compact_threshold: expect.any(Number) }]
	});
	const last = JSON.stringify((requests[2]!.query as { input: unknown[] }).input);
	expect(last).toContain('sealed');
	expect(last).toContain('Once more.');
	expect(last).not.toContain('Start.');
	expect(last).not.toContain('First.');
	const { entries } = (await coordinator.thread(id))!;
	expect(entries).toContainEqual(
		expect.objectContaining({ type: 'event', text: 'Context compacted' })
	);
});

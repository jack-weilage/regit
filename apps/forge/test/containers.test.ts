import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup } from './support.ts';

const { dir, git, worker, script, modelRequests, sh, seed, commit, start, submitReview, settled } =
	await setup({ containers: true });

test('snapshots the toolchain, restores it, and refreshes it when the tools change', async () => {
	const work = await seed('toolchain', { 'README.md': '# Toolchain\n' });
	await script([
		[{ type: 'response.output_text.delta', delta: 'Nothing to do.' }],
		[{ type: 'response.output_text.delta', delta: 'Still nothing.' }],
		[{ type: 'response.output_text.delta', delta: 'Nothing here either.' }],
		[{ type: 'response.output_text.delta', delta: 'All set.' }]
	]);
	const env = await worker.getEnv();
	const recorded = () =>
		env.DB.prepare('SELECT snapshot_id AS id, key, size FROM toolchain_snapshots WHERE repo = ?')
			.bind('toolchain')
			.first<{ id: string; key: string; size: number }>();

	await start('thread-3', { task: 'Look around', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-3')).toMatchObject({
		status: 'finished',
		toolchain: { tools: { jq: [expect.any(String)] }, restored: false }
	});
	const first = await recorded();
	expect(first).toMatchObject({
		id: expect.any(String),
		key: expect.any(String),
		size: expect.any(Number)
	});

	await start('thread-4', { task: 'Look again', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-4')).toMatchObject({
		status: 'finished',
		toolchain: { restored: true }
	});
	expect(await recorded()).toEqual(first);

	await env.DB.prepare('UPDATE toolchain_snapshots SET size = ? WHERE repo = ?')
		.bind(7e9, 'toolchain')
		.run();
	await start('thread-4b', { task: 'Look on a small disk', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-4b')).toMatchObject({
		status: 'finished',
		machine: 'standard-1',
		toolchain: { restored: false }
	});
	const resized = await recorded();
	expect(resized!.key).toBe(first!.key);
	expect(resized!.id).not.toBe(first!.id);
	expect(resized!.size).toBeLessThan(7e9);

	const pinned = 'path:/opt/mise/installs/jq/1.8.2';
	await commit(work, { '.tool-versions': `jq ${pinned}\n` }, 'Pin jq');
	sh(work, 'push', '--quiet', join(dir, 'toolchain.git'), 'main');

	await start('thread-5', { task: 'Look once more', mode: 'small', repo: 'toolchain' });
	const third = await settled('thread-5');
	expect(third.error).toBeNull();
	expect(third).toMatchObject({
		status: 'finished',
		toolchain: { tools: { jq: [pinned] }, restored: true }
	});
	const refreshed = await recorded();
	expect(refreshed!.key).not.toBe(first!.key);
	expect(refreshed!.id).not.toBe(resized!.id);
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup, untilThread } from './support.ts';

const { dir, worker, script, modelRequests, sh, seed, commit } = await setup();

test('replays image pixels after the source is removed and keeps durable references in chat', async () => {
	const png =
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=';
	await seed('images', { '.agents/setup': `echo '${png}' | base64 -d > .git/capture.png\n` });
	const call = (id: string, name: string, args: object) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: id,
				name,
				arguments: JSON.stringify(args)
			}
		}
	];
	await script('images', [
		call('pixels', 'view_image', { path: '.git/capture.png' }),
		call('remove', 'run', { command: 'rm .git/capture.png' }),
		[{ type: 'response.output_text.delta', delta: 'Image inspected.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('images');
	const { id } = await repo.openThread({
		repo: 'images',
		author: { name: 'Sam', kind: 'person' },
		text: 'Inspect the capture',
		mode: 'small',
		machine: 'standard-1'
	});
	await expect
		.poll(async () => JSON.stringify((await repo.thread(id))!.entries), { timeout: 30_000 })
		.toContain('Image inspected.');
	const requests = await modelRequests('images');
	const input = JSON.stringify(requests.at(-1)!.query);
	expect(input).toContain(`data:image/png;base64,${png}`);
	expect(JSON.stringify((await repo.thread(id))!.entries)).not.toContain(png);
	const imageId = /\/images\/([0-9a-f-]{36})/.exec(input)![1]!;
	const image = await repo.image(imageId);
	expect(image!.mime).toBe('image/png');
	expect(Buffer.from(image!.data).toString('base64')).toBe(png);
	expect(await env.REPOS.getByName('other-images').image(imageId)).toBeNull();
	await script('images', [
		[
			{
				type: 'response.output_text.delta',
				delta: `![Inspected capture](/images/images/${imageId})`
			}
		]
	]);
	await repo.reply(id, { author: { name: 'Sam', kind: 'person' }, text: 'Show it' });
	await expect
		.poll(async () => JSON.stringify((await repo.thread(id))!.entries), { timeout: 30_000 })
		.toContain(`![Inspected capture](/images/images/${imageId})`);
});

test('runs saved services and serves them on preview hosts', async () => {
	const port = 40_000 + Math.floor(Math.random() * 10_000);
	const command = `node -e "console.log('booting'); require('http').createServer((q, s) => { const body = 'hi from ' + q.url; if (/gzip/.test(q.headers['accept-encoding'] || '')) { s.setHeader('content-encoding', 'gzip'); s.end(require('zlib').gzipSync(body)); } else s.end(body); }).listen(process.env.PORT)"`;
	const work = await seed('serving', { 'README.md': '# Serving\n' });
	mkdirSync(join(work, '.agents'));
	await commit(
		work,
		{ '.agents/services.yml': `services:\n  hello:\n    command: ${command}\n    port: ${port}\n` },
		'Save a service'
	);
	sh(work, 'push', '--quiet', join(dir, 'serving.git'), 'main');
	await script('serving', [[{ type: 'response.output_text.delta', delta: 'Ready.' }]]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('serving');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'serving',
		author: sam,
		text: 'Show me the app.',
		mode: 'small',
		machine: 'standard-1'
	});

	const listed = await untilThread(repo, id, (detail) => detail.services.length > 0);
	expect(listed.services).toMatchObject([{ name: 'hello', port, saved: true, status: 'stopped' }]);
	const preview = new URL(listed.services[0]!.preview);
	expect(preview.hostname).toMatch(/^[0-9a-f]{20}-hello\.regit\.run$/);
	expect((await worker.fetch(preview.toString().replace('.regit.run', '.regit.dev'))).status).toBe(
		404
	);

	await repo.serviceAction(id, 'start', 'hello');
	expect((await repo.thread(id))!.services[0]).toMatchObject({ status: 'running' });
	const response = await worker.fetch(new URL('/page?x=1', preview).toString(), {
		headers: { 'Accept-Encoding': 'gzip' }
	});
	expect(await response.text()).toBe('hi from /page?x=1');
	expect(await repo.serviceLogs(id, 'hello')).toBe('booting');

	await repo.serviceAction(id, 'stop', 'hello');
	expect((await repo.thread(id))!.services[0]).toMatchObject({ status: 'stopped' });
	const woken = await worker.fetch(preview.toString());
	expect(await woken.text()).toBe('hi from /');
	expect((await repo.thread(id))!.services[0]).toMatchObject({ status: 'running' });
	await repo.serviceAction(id, 'stop', 'hello');

	expect((await worker.fetch('https://0000-hello.regit.run/')).status).toBe(404);
});

test('offers built-in and repository skills, and loads one on request', async () => {
	await seed('skilled', {
		'notes.md': 'Some notes\n',
		'.agents/skills/release/SKILL.md':
			'---\nname: release\ndescription: Cut a release. Use when asked to publish a version.\n---\n# Release\n\nRun scripts/release.sh, then tag the commit.\n',
		'.agents/skills/release/scripts/release.sh': 'echo release\n'
	});
	await script('skilled', [
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'skill',
					name: 'load_skill',
					arguments: JSON.stringify({ name: 'release' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Loaded it.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('skilled');
	const { id } = await repo.openThread({
		repo: 'skilled',
		author: { name: 'Sam', kind: 'person' },
		text: 'How do we cut a release?',
		mode: 'small',
		machine: 'standard-1'
	});
	await expect
		.poll(
			async () =>
				(await repo.thread(id))!.entries.some(
					(entry) => entry.type === 'message' && entry.author.kind === 'agent'
				),
			{ timeout: 20_000 }
		)
		.toBe(true);

	const requests = (await modelRequests('skilled')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	const first = JSON.stringify(requests[0]!.query);
	expect(first).toContain('- release: Cut a release. Use when asked to publish a version.');
	expect(first).toContain('- threads: Work alongside other threads');
	expect(first).toContain('- services: Run long-running processes');
	expect(first).toContain('- toolchains:');
	const loaded = JSON.stringify(requests[1]!.query);
	expect(loaded).toContain('Run scripts/release.sh, then tag the commit.');
	expect(loaded).toContain('Skill directory: .agents/skills/release');
	expect(loaded).toContain('<file>scripts/release.sh</file>');
});

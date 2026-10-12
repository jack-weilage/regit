import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, expect, test } from 'vitest';
import type { LiveMessage, ThreadDetail } from '@regit/core';
import { setup } from './support.ts';

const {
	dir,
	git,
	worker,
	script,
	modelRequests,
	scriptDecisions,
	decisionRequests,
	idle,
	sh,
	seed,
	commit,
	start,
	settled
} = await setup();

beforeEach(() => idle());

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
	await script([
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
	const requests = await modelRequests();
	const input = JSON.stringify(requests.at(-1)!.query);
	expect(input).toContain(`data:image/png;base64,${png}`);
	expect(JSON.stringify((await repo.thread(id))!.entries)).not.toContain(png);
	const imageId = /\/images\/([0-9a-f-]{36})/.exec(input)![1]!;
	const image = await repo.image(imageId);
	expect(image!.mime).toBe('image/png');
	expect(Buffer.from(image!.data).toString('base64')).toBe(png);
	expect(await env.REPOS.getByName('other-images').image(imageId)).toBeNull();
	await script([
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

test('prepares the workspace before the agent and blocks it on hook failure', async () => {
	await seed('hooks', {
		'.agents/setup': 'echo setup >> .git/hooks-ran\n',
		'.agents/resume': 'test "$(cat .git/hooks-ran)" = setup\necho resume >> .git/hooks-ran\n'
	});
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'hooks',
					name: 'run',
					arguments: JSON.stringify({ command: 'cat .git/hooks-ran' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Ready.' }]
	]);
	await start('hooks-ok', { task: 'Check setup', mode: 'small', repo: 'hooks' });
	expect(await settled('hooks-ok')).toMatchObject({ status: 'finished', error: null });
	const requests = await modelRequests();
	expect(JSON.stringify(requests.at(-1)!.query)).toContain('exit code 0\\nsetup\\nresume');

	await seed('hooks-fail', {
		'.agents/setup': 'echo missing-dependency >&2\nexit 7\n',
		'.agents/resume': 'echo should-not-run >&2\nexit 8\n'
	});
	await start('hooks-failed', { task: 'Must not run', mode: 'small', repo: 'hooks-fail' });
	expect(await settled('hooks-failed')).toMatchObject({
		status: 'failed',
		error: '.agents/setup failed (exit code 7)\nmissing-dependency',
		steps: []
	});
	expect(await modelRequests()).toHaveLength(requests.length);
	const env = await worker.getEnv();
	await env.ATTEMPTS.getByName('hooks-failed').converse({
		repo: 'hooks-fail',
		mode: 'small',
		author: 'Sam',
		text: 'Retry',
		entry: 'retry-hooks'
	});
	expect(await settled('hooks-failed')).toMatchObject({
		status: 'failed',
		error: '.agents/setup failed (exit code 7)\nmissing-dependency',
		steps: []
	});
	expect(await modelRequests()).toHaveLength(requests.length);
});

test('runs the agent on a fork of the repository, checkpointing its work', async () => {
	await seed('greeting', {
		'greeting.ts': "export const greeting = 'hello';\n",
		'AGENTS.md': 'Greeting project convention: use single quotes.'
	});
	await script([
		[
			{ type: 'response.output_text.delta', delta: 'Say hi instead' },
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'call_1',
					name: 'edit_file',
					arguments: JSON.stringify({ path: 'greeting.ts', old_string: 'hello', new_string: 'hi' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Changed the greeting to hi.' }]
	]);
	await start('thread-1', {
		task: 'Make the greeting say hi',
		mode: 'small',
		repo: 'greeting'
	});

	const snapshot = await settled('thread-1');
	expect(snapshot).toMatchObject({ status: 'finished', error: null });
	expect(snapshot.steps).toHaveLength(2);

	const fork = join(dir, 'greeting--thread-1.git');
	const sha = snapshot.steps[0]!.checkpoint;
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(sh(fork, 'rev-parse', 'main')).toBe(sha);
	expect(sh(fork, 'show', 'main:greeting.ts')).toBe("export const greeting = 'hi';");
	expect(sh(fork, 'log', '-1', '--format=%an %s', 'main')).toBe('ReGit Say hi instead');
	expect(sh(join(dir, 'greeting.git'), 'show', 'main:greeting.ts')).toBe(
		"export const greeting = 'hello';"
	);
	expect((await git.requests()).some((headers) => headers.authorization)).toBe(false);

	const [first, second] = await modelRequests();
	expect(JSON.stringify(first!.query)).toContain('Greeting project convention: use single quotes.');
	expect(JSON.stringify(first!.query)).toContain('verifying-changes');
	expect(JSON.stringify(first!.query)).not.toContain('Derive expected results from the contract');
	expect(first).toMatchObject({
		provider: 'openai',
		endpoint: 'responses',
		headers: { 'cf-aig-metadata': { thread: 'thread-1', mode: 'small', task: 'code' } },
		query: { model: 'gpt-6-luna' }
	});
	expect((second!.query as { input: unknown[] }).input.at(-1)).toMatchObject({
		type: 'function_call_output',
		call_id: 'call_1',
		output: [{ type: 'input_text', text: 'Edited greeting.ts' }]
	});
});

test('fails the attempt when the model fails', async () => {
	await seed('failing', { 'README.md': '# Failing\n' });
	await script([
		[
			{
				type: 'response.failed',
				response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
			}
		]
	]);
	await start('thread-2', { task: 'Anything', mode: 'medium', repo: 'failing' });

	expect(await settled('thread-2')).toMatchObject({
		status: 'failed',
		error: 'No credits',
		steps: []
	});
});

test('records a failed reply in the thread', async () => {
	await seed('drafts', { 'README.md': '# Drafts\n' });
	await script([
		[
			{
				type: 'response.failed',
				response: { error: { code: 'credit_balance_exhausted', message: 'No credits' } }
			}
		]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('drafts');
	const opened = await repo.openThread({
		repo: 'drafts',
		author: { name: 'Sam', kind: 'person' },
		text: 'Tidy things up.',
		mode: 'small',
		machine: 'standard-1'
	});

	let entries = (await repo.thread(opened.id))!.entries;
	for (let i = 0; i < 100 && entries.length < 2; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		entries = (await repo.thread(opened.id))!.entries;
	}
	expect(entries.at(-1)).toMatchObject({ type: 'event', text: "Couldn't reply: No credits" });
});

test('discards, reopens, deletes, restores and purges a thread', async () => {
	const offline = [{ type: 'response.failed', response: { error: { message: 'Offline' } } }];
	await script([offline, offline]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('lifecycle');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Try something.',
		mode: 'small',
		machine: 'standard-1'
	});
	const pixels = Buffer.alloc(600_000);
	for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
	const imageId = await repo.saveImage(id, `data:image/png;base64,${pixels.toString('base64')}`);
	expect(Buffer.from((await repo.image(imageId))!.data)).toEqual(pixels);

	await repo.discard(id, sam);
	expect((await repo.thread(id))!.summary.status).toBe('discarded');
	await repo.reopen(id, sam);
	const reopened = await repo.thread(id);
	expect(reopened!.summary.status).toBe('draft');
	expect(reopened!.entries.map((entry) => entry.type === 'event' && entry.text)).toEqual(
		expect.arrayContaining(['Discarded by Sam', 'Reopened by Sam'])
	);

	await repo.delete(id, sam);
	expect(await repo.image(imageId)).toBeNull();
	expect(await repo.threads()).toEqual([]);
	expect(await repo.thread(id)).toMatchObject({
		summary: { deleted: { by: 'Sam' } },
		entries: []
	});
	await expect(
		Promise.resolve().then(() => repo.reply(id, { author: sam, text: 'Hello?' }))
	).rejects.toThrow();

	await repo.restore(id);
	expect(Buffer.from((await repo.image(imageId))!.data)).toEqual(pixels);
	expect(await repo.threads()).toMatchObject([{ id, deleted: null }]);

	await repo.delete(id, sam);
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'lifecycle' });
	await sql.exec('UPDATE threads SET deleted_at = deleted_at - ? WHERE id = ?', 8 * 86_400_000, id);
	const later = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Another try.',
		mode: 'small',
		machine: 'standard-1'
	});
	await repo.delete(later.id, sam);

	for (let i = 0; i < 50 && (await repo.thread(id)); i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await repo.thread(id)).toBeNull();
	expect(await repo.image(imageId)).toBeNull();
	expect(await repo.thread(later.id)).toMatchObject({ summary: { deleted: { by: 'Sam' } } });
});

test('coordinates a thread from conversation to a finished attempt, live', async () => {
	await seed('notes', { 'notes.md': 'Some notes\n' });
	const propose = (name: string, headline: string) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: name,
				name,
				arguments: JSON.stringify({
					headline,
					purpose: 'Readers need a title.',
					doneWhen: ['notes.md starts with a title']
				})
			}
		}
	];
	await script([
		propose('propose_intent', 'docs: tidy the notes'),
		[{ type: 'response.output_text.delta', delta: 'Proposed a tidy-up.' }],
		propose('update_intent', 'docs(notes): add a title'),
		[{ type: 'response.output_text.delta', delta: 'Updated it.' }],
		[
			{ type: 'response.output_text.delta', delta: 'Adding the title' },
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'call_1',
					name: 'write_file',
					arguments: JSON.stringify({ path: 'notes.md', content: '# Notes\n\nSome notes\n' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);

	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('notes');
	const live: LiveMessage[] = [];
	const { webSocket: socket } = await repo.fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	socket!.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));

	const sam = { name: 'Sam', kind: 'person' as const };
	const opened = await repo.openThread({
		repo: 'notes',
		author: sam,
		text: 'The notes need a title.',
		mode: 'small',
		machine: 'standard-3'
	});
	expect(opened).toMatchObject({
		status: 'draft',
		headline: 'The notes need a title.',
		machine: 'standard-3'
	});
	const drafted = async (count: number) => {
		for (let i = 0; i < 100; i++) {
			const detail = await repo.thread(opened.id);
			const intents = detail!.entries.filter((entry) => entry.type === 'intent');
			if (intents.length === count) return detail!;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`The thread never had ${count} intents`);
	};
	const said = async (text: string) => {
		for (let i = 0; i < 100; i++) {
			const last = (await repo.thread(opened.id))!.entries.at(-1);
			if (last?.type === 'message' && last.text === text) return;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	};
	expect((await drafted(1)).summary.headline).toBe('docs: tidy the notes');
	await said('Proposed a tidy-up.');

	await repo.reply(opened.id, { author: sam, text: 'Call it Notes.' });
	await drafted(2);
	await said('Updated it.');
	await repo.start(opened.id);

	let detail = await repo.thread(opened.id);
	for (let i = 0; i < 300 && detail?.summary.status === 'running'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(opened.id);
	}
	socket!.close();

	expect(detail!.summary).toMatchObject({
		status: 'needs-you',
		headline: 'docs(notes): add a title'
	});
	expect(await env.ATTEMPTS.getByName(detail!.control!.runs.at(-1)!.id).snapshot()).toMatchObject({
		machine: 'standard-3'
	});
	expect(
		detail!.entries.map((entry) =>
			entry.type === 'message'
				? `${entry.author.name}: ${entry.text}`
				: entry.type === 'event'
					? entry.text.replace(/\b[0-9a-f]{7}$/, 'sha')
					: entry.type === 'tools'
						? `tools ${entry.calls.map((call) => `${call.tool} ${call.status}`).join(', ')}`
						: entry.type === 'intent'
							? `intent ${entry.intent.headline}`
							: entry.type
		)
	).toEqual([
		'Sam: The notes need a title.',
		'intent docs: tidy the notes',
		'tools propose_intent done',
		'ReGit: Proposed a tidy-up.',
		'Sam: Call it Notes.',
		'intent docs(notes): add a title',
		'tools update_intent done',
		'ReGit: Updated it.',
		'Repository member accepted the intent',
		`Started run ${detail!.control!.runs.at(-1)!.id.slice(0, 8)}`,
		'ReGit: Adding the title',
		'tools write_file done',
		'Checkpoint sha',
		'ReGit: Added the title.',
		'The attempt finished'
	]);
	expect(live.filter((message) => message.type === 'entry')).toHaveLength(detail!.entries.length);
	const activity = live.flatMap((message) =>
		message.type === 'activity' && message.thread === opened.id ? [message.activity] : []
	);
	expect(activity.some((update) => update?.status?.label === 'Thinking')).toBe(true);
	expect(
		activity.some((update) =>
			update?.calls.some((call) => call.tool === 'write_file' && call.status === 'running')
		)
	).toBe(true);
	expect(activity.at(-1)).toBeNull();
	expect(detail!.activity).toBeNull();
	const requests = await modelRequests();
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual(['conversation', 'conversation', 'conversation', 'conversation', 'code', 'code']);
	const tools = (request: (typeof requests)[number]) =>
		(request.query as { tools: { name: string }[] }).tools.map((tool) => tool.name);
	expect(tools(requests[0]!)).toEqual([
		'load_skill',
		'view_image',
		'read_file',
		'find_files',
		'search',
		'run',
		'read_guidance',
		'propose_intent',
		'update_intent',
		'suggest_thread',
		'list_threads',
		'message_thread',
		'ask_threads'
	]);
	expect(tools(requests[4]!)).toContain('write_file');
	expect(tools(requests[4]!)).toContain('suggest_thread');
	expect(tools(requests[4]!)).toContain('message_thread');
	const call = (50 * 0.1 + 10 * 0.5) / 1_000_000;
	expect(detail!.usage).toEqual({
		rows: [
			{
				task: 'conversation',
				model: 'gpt-6-luna',
				tokens: 240,
				cost: expect.closeTo(4 * call, 10)
			},
			{ task: 'attempt', model: 'gpt-6-luna', tokens: 120, cost: expect.closeTo(2 * call, 10) }
		],
		context: { used: 60, limit: 1_050_000 }
	});
	expect(await repo.threads()).toMatchObject([{ id: opened.id, status: 'needs-you' }]);
	expect(
		sh(join(dir, `notes--${detail!.control!.runs.at(-1)!.id}.git`), 'show', 'main:notes.md')
	).toBe('# Notes\n\nSome notes');
});

test('steers a running attempt with messages read after the current step', async () => {
	await seed('steer', { 'notes.md': 'Some notes\n' });
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'propose',
					name: 'propose_intent',
					arguments: JSON.stringify({
						headline: 'docs: add a title',
						purpose: 'Readers need a title.',
						doneWhen: ['notes.md starts with a title']
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }],
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'call_1',
					name: 'write_file',
					arguments: JSON.stringify({ path: 'notes.md', content: '# Notes\n\nSome notes\n' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Kept it short.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('steer');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'steer',
		author: sam,
		text: 'Add a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Proposed.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	await repo.start(id);
	await repo.reply(id, { author: sam, text: 'Keep the title short.' });
	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && detail?.summary.status === 'running'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(id);
	}

	expect(detail!.summary.status).toBe('needs-you');
	expect(detail!.entries.find((entry) => entry.type === 'message' && entry.steering)).toMatchObject(
		{ text: 'Keep the title short.', steering: { read: true } }
	);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding.at(-1)!.query)).toContain('Sam: Keep the title short.');
});

const sleepCall = [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'sleep',
			name: 'run',
			arguments: JSON.stringify({ command: 'sleep 30' })
		}
	}
];

async function untilRequests(task: string, count: number) {
	for (let i = 0; i < 300; i++) {
		const requests = await modelRequests();
		const matching = requests.filter(
			(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === task
		);
		if (matching.length >= count) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Never saw ${count} ${task} requests`);
}

test('stops a running attempt mid tool call', async () => {
	await seed('stopping', { 'notes.md': 'Some notes\n' });
	await script([[{ type: 'response.output_text.delta', delta: 'Sure.' }], sleepCall]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('stopping');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'stopping',
		author: sam,
		text: 'Go.',
		mode: 'small',
		machine: 'standard-1'
	});
	await untilRequests('conversation', 1);
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Sure.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await repo.intentProposed(id, {
		headline: 'chore: wait',
		purpose: 'Testing.',
		doneWhen: ['It waited']
	});
	await repo.start(id);
	await untilRequests('code', 1);
	await new Promise((resolve) => setTimeout(resolve, 500));

	const stoppedAt = Date.now();
	await repo.stop(id, sam);
	const detail = await repo.thread(id);
	expect(Date.now() - stoppedAt).toBeLessThan(20_000);
	expect(detail!.summary.status).toBe('needs-you');
	expect(detail!.entries.at(-1)).toMatchObject({ type: 'event', text: 'Stopped by Sam' });
	expect((await env.ATTEMPTS.getByName(detail!.control!.runs.at(-1)!.id).snapshot())!.status).toBe(
		'interrupted'
	);
});

test('reports a sandbox that fails before asking the model', async () => {
	await script([]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('missing');
	const { id } = await repo.openThread({
		repo: 'missing',
		author: { name: 'Sam', kind: 'person' },
		text: 'Read the README.',
		mode: 'small',
		machine: 'standard-1'
	});

	await expect
		.poll(async () => (await repo.thread(id))!.entries.at(-1), { timeout: 20_000 })
		.toMatchObject({
			type: 'event',
			text: expect.stringMatching(/^Couldn't reply: git clone failed/)
		});
	const requests = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	expect(requests).toHaveLength(0);
});

test('stops a conversation turn mid tool call', async () => {
	await seed('quiet', { 'notes.md': 'Some notes\n' });
	await script([sleepCall]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('quiet');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'quiet',
		author: sam,
		text: 'Look around.',
		mode: 'small',
		machine: 'standard-1'
	});
	await untilRequests('conversation', 1);
	await new Promise((resolve) => setTimeout(resolve, 500));

	await repo.stop(id, sam);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const entries = (await repo.thread(id))!.entries;
	expect(entries.at(-1)).toMatchObject({ type: 'event', text: 'Stopped by Sam' });
	expect(
		entries.some((entry) => entry.type === 'event' && entry.text.startsWith("Couldn't reply"))
	).toBe(false);
});

test('resumes a finished run without letting the coding agent replace its accepted intent', async () => {
	await seed('resume', {
		'notes.md': 'Some notes\n',
		'.agents/setup': 'test ! -e .git/setup-ran\ntouch .git/setup-ran\n',
		'.agents/resume': 'test ! -e .git/resume-ran\ntouch .git/resume-ran\n'
	});
	await idle();
	await script([
		[{ type: 'response.output_text.delta', delta: 'Sure.' }],
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'intent',
					name: 'update_intent',
					arguments: JSON.stringify({
						headline: 'docs: add a footer',
						purpose: 'Readers need a footer.',
						doneWhen: ['notes.md ends with a footer']
					})
				}
			}
		],
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'footer',
					name: 'write_file',
					arguments: JSON.stringify({ path: 'notes.md', content: '# Notes\n\nA footer\n' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Added the footer too.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('resume');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'resume',
		author: sam,
		text: 'Add a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	const waitFor = async (
		check: (detail: NonNullable<Awaited<ReturnType<typeof repo.thread>>>) => boolean
	) => {
		for (let i = 0; i < 600; i++) {
			const detail = (await repo.thread(id))!;
			if (check(detail)) return detail;
			await new Promise((resolve) => setTimeout(resolve, 200));
		}
		throw new Error('The thread never got there');
	};
	await waitFor((detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.author.kind === 'agent')
	);
	await repo.intentProposed(id, {
		headline: 'docs: add a title',
		purpose: 'Readers need a title.',
		doneWhen: ['notes.md starts with a title']
	});
	await repo.start(id);
	const finished = await waitFor((detail) => detail.summary.status === 'needs-you');
	const accepted = finished.control!.acceptedIntent;

	await repo.reply(id, { author: sam, text: 'Also add a footer.' });
	const detail = await waitFor(
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Added the footer too.'
			)
	);

	expect(detail.control!.acceptedIntent).toEqual(accepted);
	expect(detail.summary.headline).toBe('docs: add a footer');
	expect(detail.control!.runs).toEqual(finished.control!.runs);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding[1]!.query)).toContain('Added the title.');
	expect(JSON.stringify(coding[1]!.query)).toContain('Sam: Also add a footer.');
});

async function untilThread(
	repo: ReturnType<Env['REPOS']['getByName']>,
	id: string,
	check: (detail: ThreadDetail) => boolean
) {
	for (let i = 0; i < 300; i++) {
		const detail = (await repo.thread(id)) as ThreadDetail;
		if (check(detail)) return detail;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	const detail = (await repo.thread(id)) as ThreadDetail;
	throw new Error(
		`The thread never got there: ${detail.summary.status} ${JSON.stringify(detail.entries.slice(-4))}`
	);
}

async function startedThread(name: string, steps: object[][], branch?: string) {
	await seed(name, { 'notes.md': 'Some notes\n' }, branch);
	await idle();
	await script([[{ type: 'response.output_text.delta', delta: 'Sure.' }], ...steps]);
	const env = await worker.getEnv();
	await env.DB.prepare('INSERT INTO repos (name, created_at) VALUES (?, ?)')
		.bind(name, Date.now())
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, 'owner', 'owner')
		.run();
	const repo = env.REPOS.getByName(name);
	const sam = { id: 'owner', name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: name,
		author: sam,
		text: 'Add a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	await untilThread(repo, id, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.author.kind === 'agent')
	);
	await repo.intentProposed(id, {
		headline: 'docs: add a title',
		purpose: 'Readers need a title.',
		doneWhen: ['notes.md starts with a title']
	});
	await repo.start(id);
	return { env, repo, sam, id };
}

test('resumes a discarded attempt once the thread is reopened', async () => {
	const { env, repo, sam, id } = await startedThread('reopened', [
		sleepCall,
		[{ type: 'response.output_text.delta', delta: 'Carried on.' }]
	]);
	await untilRequests('code', 1);
	await new Promise((resolve) => setTimeout(resolve, 500));
	await repo.discard(id, sam);
	expect(
		(await env.ATTEMPTS.getByName((await repo.thread(id))!.control!.runs.at(-1)!.id).snapshot())!
			.status
	).toBe('cancelled');

	repo.reopen(id, sam);
	await repo.reply(id, { author: sam, text: 'Carry on.' });
	const detail = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Carried on.')
	);

	const requests = await modelRequests();
	const tasks = requests.map(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task
	);
	expect(tasks).toEqual(['conversation', 'code', 'code']);
	expect(JSON.stringify(requests[2]!.query)).toContain('Sam: Carry on.');
});

test('finishes again when a reply to a finished run leads to no changes', async () => {
	const { repo, sam, id } = await startedThread('unchanged', [
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		[{ type: 'response.output_text.delta', delta: 'Because readers asked for one.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');

	await repo.reply(id, { author: sam, text: 'Why a title?' });
	const detail = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Because readers asked for one.'
			)
	);

	expect(detail.entries.at(-1)).toMatchObject({ type: 'event', text: 'The attempt finished' });
	const tasks = (await modelRequests()).map(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task
	);
	expect(tasks).toEqual(['conversation', 'code', 'code']);
});

const writeNotes = (content: string) => [
	{
		type: 'response.output_item.done',
		item: {
			type: 'function_call',
			call_id: 'write',
			name: 'run',
			arguments: JSON.stringify({ command: `printf '${content}' > notes.md` })
		}
	}
];

async function approveCandidate(
	repo: ReturnType<Env['REPOS']['getByName']>,
	id: string,
	sam: { id: string; name: string; kind: 'person' }
) {
	const ready = await untilThread(
		repo,
		id,
		(detail) => detail.control!.promotions.at(-1)?.status === 'ready'
	);
	await repo.approvePromotion(id, ready.control!.promotions.at(-1)!.id, sam);
}

test('ships finished work as one commit on main', async () => {
	const { repo, sam, id } = await startedThread('shipping', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		[{ type: 'response.output_text.delta', delta: 'It is the first line.' }]
	]);
	const ready = await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect(ready.summary.changes).toEqual({ files: 1, additions: 1, deletions: 1 });
	expect(await repo.changes(id)).toMatchObject([
		{ path: 'notes.md', change: 'modified', additions: 1, deletions: 1 }
	]);

	await repo.ship(id, {
		by: sam,
		email: 'sam@example.com',
		title: 'docs: add a title',
		body: 'Readers need a title.'
	});
	await approveCandidate(repo, id, sam);
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');

	const main = sh(join(dir, 'shipping.git'), 'rev-parse', 'main');
	expect(shipped.summary.shipped).toMatchObject({ sha: main, by: 'Sam' });
	expect(shipped.entries.at(-1)).toMatchObject({
		type: 'event',
		text: expect.stringContaining(`Promoted ${main.slice(0, 7)} to main`)
	});
	expect(sh(join(dir, 'shipping.git'), 'log', '--format=%an|%s', 'main')).toBe(
		'Sam|docs: add a title\nSam|init'
	);
	expect(sh(join(dir, 'shipping.git'), 'log', '-1', '--format=%b', 'main')).toBe(
		'Readers need a title.\n\nCo-authored-by: ReGit <agent@regit.dev>'
	);
	expect(sh(join(dir, 'shipping.git'), 'show', 'main:notes.md')).toBe('# Notes');
	expect((await git.requests()).some((headers) => headers.authorization)).toBe(false);

	await repo.reply(id, { author: sam, text: 'Where is the title?' });
	const answered = await untilThread(repo, id, (detail) =>
		detail.entries.some(
			(entry) => entry.type === 'message' && entry.text === 'It is the first line.'
		)
	);
	expect(answered.summary.status).toBe('shipped');
});

test('rejects integration conflicts without rebasing the run or writing main', async () => {
	const { repo, sam, id } = await startedThread('conflicting', [
		writeNotes('# Notes\\n'),
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const work = join(dir, 'conflicting-work');
	await commit(work, { 'notes.md': 'Some better notes\n' }, 'Better notes');
	sh(work, 'push', '--quiet', join(dir, 'conflicting.git'), 'main');

	const ship = { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' };
	const before = (await repo.thread(id))!;
	const runFork = join(dir, `conflicting--${before.control!.runs.at(-1)!.id}.git`);
	const runHead = sh(runFork, 'rev-parse', 'main');
	await repo.ship(id, ship);
	const resolved = await untilThread(
		repo,
		id,
		(detail) => detail.control!.promotions.at(-1)?.status === 'failed'
	);
	expect(resolved.control!.promotions.at(-1)!.error).toMatch(/conflict/i);
	expect(sh(runFork, 'rev-parse', 'main')).toBe(runHead);
	expect(sh(join(dir, 'conflicting.git'), 'log', '--format=%s', 'main')).toBe('Better notes\ninit');
});

test("ships to the branch the repository's HEAD points to, not its recorded default", async () => {
	const { repo, sam, id } = await startedThread(
		'imported',
		[writeNotes('# Notes\\n'), [{ type: 'response.output_text.delta', delta: 'Added the title.' }]],
		'master'
	);
	const ready = await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');

	await repo.ship(id, { by: sam, email: 'sam@example.com', title: 'docs: add a title', body: '' });
	await approveCandidate(repo, id, sam);
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');

	expect(shipped.entries.at(-1)).toMatchObject({
		text: expect.stringContaining('to master')
	});
	expect(sh(join(dir, 'imported.git'), 'log', '--format=%s', 'master')).toBe(
		'docs: add a title\ninit'
	);
	expect(() => sh(join(dir, 'imported.git'), 'rev-parse', '--verify', 'main')).toThrow();
});

test('suggests separate work and spins it off into a linked thread', async () => {
	await seed('suggesting', { 'notes.md': 'Some notes\n' });
	const suggestion = {
		headline: 'fix(audit): query only the last entry',
		purpose: 'Settings fetch the whole audit log.',
		doneWhen: ['One query returns one row'],
		context: 'notes.md:1 mentions the audit log query.'
	};
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'suggest',
					name: 'suggest_thread',
					arguments: JSON.stringify(suggestion)
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Noted that separately.' }],
		[{ type: 'response.output_text.delta', delta: 'Got it.' }]
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('suggesting');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'suggesting',
		author: sam,
		text: 'Tidy the notes.',
		mode: 'small',
		machine: 'standard-1'
	});
	const parent = await untilThread(repo, id, (detail) =>
		detail.entries.some(
			(entry) => entry.type === 'message' && entry.text === 'Noted that separately.'
		)
	);
	const card = parent.entries.find((entry) => entry.type === 'suggestion')!;
	expect(card).toMatchObject({
		intent: { headline: suggestion.headline, doneWhen: suggestion.doneWhen },
		context: suggestion.context,
		outcome: null
	});

	const child = await repo.spinOff(id, card.id, sam);
	expect(child).toMatchObject({
		headline: suggestion.headline,
		status: 'draft',
		mode: 'small',
		parent: { id, headline: 'Tidy the notes.' }
	});
	expect((await repo.thread(id))!.entries.find((entry) => entry.id === card.id)).toMatchObject({
		outcome: { kind: 'spun-off', thread: child.id, by: 'Sam' }
	});
	expect((await repo.thread(child.id))!.entries).toMatchObject([
		{ type: 'message', author: { name: 'ReGit' }, text: suggestion.context },
		{ type: 'intent', intent: { headline: suggestion.headline } }
	]);
	await expect(repo.spinOff(id, card.id, sam)).rejects.toThrow();

	await repo.reply(child.id, { author: sam, text: 'Go ahead.' });
	await untilThread(repo, child.id, (detail) =>
		detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Got it.')
	);
	const requests = await modelRequests();
	expect(JSON.stringify(requests.at(-1)!.query)).toContain('spun off from another one');
	expect(JSON.stringify(requests.at(-1)!.query)).toContain(suggestion.context);

	await repo.suggestThread(id, { ...suggestion, headline: 'docs: explain the audit log' });
	const second = (await repo.thread(id))!.entries.findLast((entry) => entry.type === 'suggestion')!;
	repo.dismissSuggestion(id, second.id, sam);
	await untilThread(repo, id, (detail) =>
		detail.entries.some(
			(entry) =>
				entry.id === second.id && entry.type === 'suggestion' && entry.outcome?.kind === 'dismissed'
		)
	);
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
	await script([[{ type: 'response.output_text.delta', delta: 'Ready.' }]]);
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

test("delivers a thread's message to another thread's agent", async () => {
	await seed('pair', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('pair');
	const sam = { name: 'Sam', kind: 'person' as const };
	const replied = async (thread: string, count: number) => {
		await expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.filter(
						(entry) => entry.type === 'message' && entry.author.kind === 'agent'
					).length,
				{ timeout: 20_000 }
			)
			.toBe(count);
	};

	await script([[{ type: 'response.output_text.delta', delta: 'Listening.' }]]);
	const ui = await repo.openThread({
		repo: 'pair',
		author: sam,
		text: 'Rework the settings page.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(ui.id, 1);

	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'tell',
					name: 'message_thread',
					arguments: JSON.stringify({ thread: ui.id, text: 'User.id is now User.accountId.' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Noted.' }],
		[{ type: 'response.output_text.delta', delta: 'Noted.' }]
	]);
	const api = await repo.openThread({
		repo: 'pair',
		author: sam,
		text: 'Rename the user id and tell the settings thread.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(api.id, 1);
	await replied(ui.id, 2);

	expect((await repo.thread(api.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'out',
			thread: ui.id,
			text: 'User.id is now User.accountId.'
		})
	);
	expect((await repo.thread(ui.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'in',
			thread: api.id,
			headline: 'Rename the user id and tell the settings thread.',
			text: 'User.id is now User.accountId.'
		})
	);
	const delivered = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === ui.id
	);
	expect(JSON.stringify(delivered)).toContain(`Thread ${api.id} (`);
});

test('refuses thread messages to itself, unknown or idle threads, and past the limit', async () => {
	await seed('guarded', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('guarded');
	const sam = { name: 'Sam', kind: 'person' as const };
	await script(
		Array.from({ length: 8 }, () => [{ type: 'response.output_text.delta', delta: 'Ok.' }])
	);
	const open = (text: string) =>
		repo.openThread({ repo: 'guarded', author: sam, text, mode: 'small', machine: 'standard-1' });
	const [from, to, idle] = [await open('One.'), await open('Two.'), await open('Three.')];
	// Miniflare's test bridge drops the message of a rejected RPC call, so only the rejection is checked.
	const send = async (a: string, b: string, text: string) => repo.messageThread(a, b, text);

	await expect(send(from.id, from.id, 'Hi')).rejects.toThrow();
	await expect(send(from.id, 'nope', 'Hi')).rejects.toThrow();
	await repo.discard(idle.id, sam);
	await expect(send(from.id, idle.id, 'Hi')).rejects.toThrow();
	for (let i = 0; i < 5; i++) await send(from.id, to.id, `Message ${i}`);
	await expect(send(from.id, to.id, 'One more')).rejects.toThrow();
	await repo.reply(to.id, { author: sam, text: 'Carry on.' });
	await expect(send(from.id, to.id, 'After the person')).resolves.toContain('Delivered');
});

test('flags a proposed intent that duplicates another thread, and forwards it there', async () => {
	await seed('dupes', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('dupes');
	const sam = { name: 'Sam', kind: 'person' as const };
	const propose = (headline: string) => [
		{
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: 'intent',
				name: 'propose_intent',
				arguments: JSON.stringify({
					headline,
					purpose: 'Big orgs wait for every member to load.',
					doneWhen: ['Settings loads in under a second']
				})
			}
		}
	];
	const intent = async (thread: string) => {
		await expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.findLast((entry) => entry.type === 'intent'),
				{
					timeout: 20_000
				}
			)
			.toBeDefined();
		return (await repo.thread(thread))!.entries.findLast((entry) => entry.type === 'intent')!;
	};

	await script([
		propose('perf(settings): load org members in pages'),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const first = await repo.openThread({
		repo: 'dupes',
		author: sam,
		text: 'Settings are slow.',
		mode: 'small',
		machine: 'standard-1'
	});
	expect(await intent(first.id)).not.toHaveProperty('similar');

	await scriptDecisions([
		{
			answers: { t1: { probabilities: { same: 0.93, overlap: 0.05, related: 0.02, unrelated: 0 } } }
		}
	]);
	await script([
		propose('fix(settings): page the member list'),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const second = await repo.openThread({
		repo: 'dupes',
		author: sam,
		text: 'Members take ages.',
		mode: 'small',
		machine: 'standard-1'
	});
	await expect
		.poll(
			async () =>
				(await intent(second.id)).type === 'intent' &&
				((await intent(second.id)) as { similar?: unknown }).similar,
			{
				timeout: 20_000
			}
		)
		.toEqual([{ thread: first.id, relation: 'same', probability: 0.93 }]);
	const [asked] = await decisionRequests();
	expect(asked!.state).toMatchObject({
		new_intent: expect.stringContaining('fix(settings): page the member list'),
		threads: {
			t1: 'perf(settings): load org members in pages — Big orgs wait for every member to load.'
		}
	});

	await script([[{ type: 'response.output_text.delta', delta: 'Thanks.' }]]);
	await repo.forwardIntent(second.id, first.id, sam);
	expect((await repo.thread(first.id))!.entries).toContainEqual(
		expect.objectContaining({
			type: 'thread-message',
			direction: 'in',
			thread: second.id,
			text: expect.stringContaining(
				'Sam found that this thread has the same goal as yours: fix(settings): page the member list'
			)
		})
	);

	await scriptDecisions([
		{
			answers: {
				t1: { probabilities: { unrelated: 1 } },
				t2: { probabilities: { same: 0.2, overlap: 0.6, related: 0.1, unrelated: 0.1 } }
			}
		}
	]);
	const live = await repo.assess('Show members a page at a time');
	expect(live).toEqual({
		similar: [{ thread: expect.any(String), relation: 'overlap', probability: 0.8 }],
		size: 'medium'
	});
});

test('sizes an auto thread when it opens and again when its intent changes', async () => {
	await seed('sized', { 'notes.md': 'Some notes\n' });
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('sized');
	await scriptDecisions([
		{ answers: { size: { probabilities: { small: 0.1, medium: 0.2, large: 0.7 } } } },
		{ answers: { size: { probabilities: { small: 0.85, medium: 0.1, large: 0.05 } } } }
	]);
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'intent',
					name: 'propose_intent',
					arguments: JSON.stringify({
						headline: 'docs: fix a typo in the notes',
						purpose: 'The notes misspell "receive".',
						doneWhen: ['notes.md spells it correctly']
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const opened = await repo.openThread({
		repo: 'sized',
		author: { name: 'Sam', kind: 'person' },
		text: 'Rework how notes are stored.',
		mode: 'auto',
		machine: 'standard-1'
	});
	expect(opened).toMatchObject({ mode: 'large', auto: true });
	await expect
		.poll(async () => (await repo.thread(opened.id))!.summary.mode, { timeout: 20_000 })
		.toBe('small');
	expect((await repo.thread(opened.id))!.summary.auto).toBe(true);
	const [first] = await decisionRequests();
	expect(first!.state).toMatchObject({ new_intent: 'Rework how notes are stored.' });
});

test('answers questions about another thread without interrupting it', async () => {
	await seed('observed', { 'notes.md': 'Some notes\n' });
	await idle();
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('observed');
	const sam = { name: 'Sam', kind: 'person' as const };
	const callTool = (call_id: string, name: string, args: object) => [
		{
			type: 'response.output_item.done',
			item: { type: 'function_call', call_id, name, arguments: JSON.stringify(args) }
		}
	];
	const replied = async (thread: string) =>
		expect
			.poll(
				async () =>
					(await repo.thread(thread))!.entries.some(
						(entry) => entry.type === 'message' && entry.author.kind === 'agent'
					),
				{ timeout: 20_000 }
			)
			.toBe(true);

	await script([
		callTool('intent', 'propose_intent', {
			headline: 'docs(notes): add a title',
			purpose: 'The notes have no heading.',
			doneWhen: ['notes.md starts with a title']
		}),
		[{ type: 'response.output_text.delta', delta: 'Proposed.' }]
	]);
	const target = await repo.openThread({
		repo: 'observed',
		author: sam,
		text: 'The notes need a title.',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(target.id);

	await script([
		callTool('ask', 'ask_threads', {
			question: 'What is the notes thread doing?',
			thread: target.id
		}),
		callTool('read', 'read_thread', { id: target.id }),
		[{ type: 'response.output_text.delta', delta: 'It is adding a title to notes.md.' }],
		[{ type: 'response.output_text.delta', delta: 'Done.' }]
	]);
	const watcher = await repo.openThread({
		repo: 'observed',
		author: sam,
		text: 'What are the others doing?',
		mode: 'small',
		machine: 'standard-1'
	});
	await replied(watcher.id);

	const detail = (await repo.thread(watcher.id))!;
	expect(detail.entries).toContainEqual(
		expect.objectContaining({
			type: 'tools',
			calls: [
				expect.objectContaining({
					tool: 'ask_threads',
					status: 'done',
					output: 'It is adding a title to notes.md.'
				})
			]
		})
	);
	expect(detail.usage.rows.map((row) => row.task)).toContain('search');
	const searches = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'search'
	);
	expect(searches).toHaveLength(2);
	expect(JSON.stringify(searches[0]!.query)).toContain(
		`What is the notes thread doing? (thread ${target.id})`
	);
	expect(JSON.stringify(searches[1]!.query)).toContain('docs(notes): add a title');
	expect(JSON.stringify(searches[1]!.query)).toContain('notes.md starts with a title');
	expect(
		(await repo.thread(target.id))!.entries.some((entry) => entry.type === 'thread-message')
	).toBe(false);

	expect(await repo.searchThread(target.id, 'title')).toMatch(
		/^\d+ matches in \d+ entries:\n#\d+ of \d+: /
	);
	expect(await repo.threadDiff(target.id)).toBe('No changes.');
});

test('offers built-in and repository skills, and loads one on request', async () => {
	await seed('skilled', {
		'notes.md': 'Some notes\n',
		'.agents/skills/release/SKILL.md':
			'---\nname: release\ndescription: Cut a release. Use when asked to publish a version.\n---\n# Release\n\nRun scripts/release.sh, then tag the commit.\n',
		'.agents/skills/release/scripts/release.sh': 'echo release\n'
	});
	await idle();
	await script([
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

	const requests = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	const first = JSON.stringify(requests[0]!.query);
	expect(first).toContain('- release: Cut a release. Use when asked to publish a version.');
	expect(first).toContain('- threads: Work alongside other threads');
	expect(first).toContain('- services: Run long-running processes');
	expect(first).not.toContain('- toolchains:');
	const loaded = JSON.stringify(requests[1]!.query);
	expect(loaded).toContain('Run scripts/release.sh, then tag the commit.');
	expect(loaded).toContain('Skill directory: .agents/skills/release');
	expect(loaded).toContain('<file>scripts/release.sh</file>');
});

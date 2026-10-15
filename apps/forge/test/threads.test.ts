import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { LiveMessage } from '@regit/core';
import { setup, sleepCall, untilThread } from './support.ts';

const { dir, worker, script, modelRequests, sh, seed, startedThread, untilRequests } =
	await setup();

test('archives, reopens, deletes, restores and purges a thread', async () => {
	const offline = [{ type: 'response.failed', response: { error: { message: 'Offline' } } }];
	await script('lifecycle', [offline, offline]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('lifecycle');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id, number } = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Try something.',
		mode: 'small',
		machine: 'standard-1'
	});
	expect(number).toBe(1);
	expect(await repo.resolveThread('1')).toEqual({ id, number: 1 });
	expect(await repo.resolveThread(id)).toEqual({ id, number: 1 });
	const pixels = Buffer.alloc(600_000);
	for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
	const imageId = await repo.saveImage(id, `data:image/png;base64,${pixels.toString('base64')}`);
	expect(Buffer.from((await repo.image(imageId))!.data).equals(pixels)).toBe(true);

	await repo.archive(id, sam);
	expect((await repo.thread(id))!.summary.status).toBe('archived');
	await repo.reopen(id, sam);
	const reopened = await repo.thread(id);
	expect(reopened!.summary.status).toBe('idle');
	expect(reopened!.entries.map((entry) => entry.type === 'event' && entry.text)).toEqual(
		expect.arrayContaining(['Archived by Sam', 'Reopened by Sam'])
	);

	await repo.delete(id, sam);
	expect(await repo.image(imageId)).toBeNull();
	expect(await repo.threads()).toEqual([]);
	expect(await repo.resolveThread('1')).toEqual({ id, number: 1 });
	expect(await repo.thread(id)).toMatchObject({
		summary: { number: 1, deleted: { by: 'Sam' } },
		entries: []
	});
	await expect(
		Promise.resolve().then(() => repo.reply(id, { author: sam, text: 'Hello?' }))
	).rejects.toThrow();

	await repo.restore(id);
	expect(Buffer.from((await repo.image(imageId))!.data).equals(pixels)).toBe(true);
	expect(await repo.threads()).toMatchObject([{ id, number: 1, deleted: null }]);

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
	expect(later.number).toBe(2);
	await repo.delete(later.id, sam);

	for (let i = 0; i < 50 && (await repo.thread(id)); i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await repo.thread(id)).toBeNull();
	expect(await repo.resolveThread('1')).toBeNull();
	expect(await repo.image(imageId)).toBeNull();
	expect(await repo.thread(later.id)).toMatchObject({ summary: { deleted: { by: 'Sam' } } });
});

test('answers live connection pings', async () => {
	const env = await worker.getEnv();
	const { webSocket: socket } = await env.REPOS.getByName('pinged').fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	const pong = new Promise((resolve) =>
		socket!.addEventListener('message', (event) => resolve(event.data))
	);
	socket!.send('ping');
	expect(await pong).toBe('pong');
	socket!.close();
});

test('tells live clients the agent is idle even when the coordinator forgot its activity', async () => {
	const { repo, id } = await startedThread('forgotten-activity', [
		[{ type: 'response.output_text.delta', delta: 'Done.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');
	const live: LiveMessage[] = [];
	const { webSocket: socket } = await repo.fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	socket!.accept();
	socket!.addEventListener('message', (event) => live.push(JSON.parse(String(event.data))));
	await repo.attemptUpdated(id, { type: 'status', status: 'finished', error: null });
	await new Promise((resolve) => setTimeout(resolve, 100));
	socket!.close();
	expect(live).toContainEqual({ type: 'activity', thread: id, activity: null });
});

test('coordinates a thread from a request to recorded changes, live', async () => {
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
	await script('notes', [
		propose('update_intent', 'docs: tidy the notes'),
		[{ type: 'response.output_text.delta', delta: 'Proposed a tidy-up.' }],
		propose('update_intent', 'docs(notes): add a title'),
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
		number: 1,
		status: 'working',
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

	let detail = await repo.thread(opened.id);
	for (let i = 0; i < 300 && detail?.summary.status === 'working'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(opened.id);
	}
	socket!.close();

	expect(detail!.summary).toMatchObject({
		status: 'idle',
		headline: 'docs(notes): add a title'
	});
	expect(await env.ATTEMPTS.getByName(opened.id).snapshot()).toMatchObject({
		machine: 'standard-3'
	});
	expect(
		detail!.entries.map((entry) =>
			entry.type === 'message'
				? `${entry.author.name}: ${entry.text}`
				: entry.type === 'event'
					? entry.text
					: entry.type === 'tools'
						? `tools ${entry.calls.map((call) => `${call.tool} ${call.status}`).join(', ')}${entry.checkpoint?.match(/^[0-9a-f]{40}$/) ? ' checkpoint' : ''}`
						: entry.type === 'intent'
							? `intent ${entry.intent.headline}`
							: entry.type
		)
	).toEqual([
		'Sam: The notes need a title.',
		'intent docs: tidy the notes',
		'tools update_intent done',
		'ReGit: Proposed a tidy-up.',
		'Sam: Call it Notes.',
		'intent docs(notes): add a title',
		'tools update_intent done',
		'ReGit: Adding the title',
		'tools write_file done checkpoint',
		'ReGit: Added the title.'
	]);
	const liveEntries = live.flatMap((message) =>
		message.type === 'entry' ? [message.entry.id] : []
	);
	expect(new Set(liveEntries).size).toBe(detail!.entries.length);
	const activity = live.flatMap((message) =>
		message.type === 'activity' && message.thread === opened.id ? [message.activity] : []
	);
	const phases = activity.flatMap((update) => (update ? [update.agent] : []));
	expect(phases.some((agent) => agent.type === 'thinking' && agent.label === 'Thinking')).toBe(
		true
	);
	const labels = phases.flatMap((agent) =>
		agent.type === 'thinking'
			? [agent.label]
			: agent.type === 'starting'
				? ['(sandbox stages)']
				: []
	);
	const setups = labels
		.filter((label, i) => label !== labels[i - 1])
		.join('\n')
		.split(/\nThinking(?:\n|$)/)
		.map((run) => run.split('\n'))
		.filter((run) => run[0] === "Opening the thread's branch");
	expect(setups).toEqual([
		[
			"Opening the thread's branch",
			'Connecting to the sandbox',
			'(sandbox stages)',
			'Connecting to the sandbox',
			'Finding the last green commit',
			'Comparing with main',
			'Loading skills and guidance'
		],
		[
			"Opening the thread's branch",
			'Connecting to the sandbox',
			'Comparing with main',
			'Loading skills and guidance'
		]
	]);
	expect(labels).not.toContain('Starting');
	expect(
		phases.some(
			(agent) =>
				agent.type === 'streaming' &&
				agent.calls.some((call) => call.tool === 'write_file' && call.status === 'running')
		)
	).toBe(true);
	expect(activity.at(-1)).toBeNull();
	expect(detail!.activity).toBeNull();
	const requests = await modelRequests('notes');
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual(['agent', 'agent', 'agent', 'agent', 'agent']);
	const tools = (request: (typeof requests)[number]) =>
		(request.query as { tools: { name: string }[] }).tools.map((tool) => tool.name);
	expect(tools(requests[0]!)).toEqual(
		expect.arrayContaining([
			'load_skill',
			'read_file',
			'write_file',
			'edit_file',
			'run',
			'update_intent',
			'launch_thread',
			'list_threads',
			'message_thread',
			'ask_threads'
		])
	);
	expect(tools(requests[0]!)).not.toContain('propose_intent');
	const call = (50 * 0.1 + 10 * 0.5) / 1_000_000;
	expect(detail!.usage).toEqual({
		rows: [{ task: 'agent', model: 'gpt-6-luna', tokens: 300, cost: expect.closeTo(5 * call, 10) }],
		context: { used: 60, limit: 244_800 }
	});
	expect(await repo.threads()).toMatchObject([{ id: opened.id, status: 'idle' }]);
	expect(sh(join(dir, `notes--${opened.id}.git`), 'show', 'main:notes.md')).toBe(
		'# Notes\n\nSome notes'
	);
});

test('resumes a finished thread with its history when someone replies', async () => {
	await seed('resume', {
		'notes.md': 'Some notes\n',
		'.agents/setup': 'test ! -e .git/setup-ran\ntouch .git/setup-ran\n',
		'.agents/resume': 'test ! -e .git/resume-ran\ntouch .git/resume-ran\n'
	});
	await script('resume', [
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
	await waitFor((detail) => detail.summary.status === 'idle');

	await repo.reply(id, { author: sam, text: 'Also add a footer.' });
	const detail = await waitFor(
		(detail) =>
			detail.summary.status === 'idle' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Added the footer too.'
			)
	);

	expect(detail.summary.headline).toBe('docs: add a footer');
	const turns = (await modelRequests('resume')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	expect(JSON.stringify(turns[1]!.query)).toContain('Added the title.');
	expect(JSON.stringify(turns[1]!.query)).toContain('Sam: Also add a footer.');
});

test('resumes an archived thread once it is reopened', async () => {
	const { env, repo, sam, id } = await startedThread('reopened', [
		sleepCall,
		[{ type: 'response.output_text.delta', delta: 'Carried on.' }]
	]);
	await untilRequests('reopened', id, 1);
	await new Promise((resolve) => setTimeout(resolve, 500));
	await repo.archive(id, sam);
	expect((await env.ATTEMPTS.getByName(id).snapshot())!.status).toBe('cancelled');

	repo.reopen(id, sam);
	await repo.reply(id, { author: sam, text: 'Carry on.' });
	const detail = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'idle' &&
			detail.entries.some((entry) => entry.type === 'message' && entry.text === 'Carried on.')
	);

	const requests = await modelRequests('reopened');
	const tasks = requests.map(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task
	);
	expect(tasks.slice(-2)).toEqual(['agent', 'agent']);
	expect(JSON.stringify(requests.at(-1)!.query)).toContain('Sam: Carry on.');
});

test('answers a reply to a finished thread without changes', async () => {
	const { repo, sam, id } = await startedThread('unchanged', [
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		[{ type: 'response.output_text.delta', delta: 'Because readers asked for one.' }]
	]);
	await untilThread(repo, id, (detail) => detail.summary.status === 'idle');

	await repo.reply(id, { author: sam, text: 'Why a title?' });
	const detail = await untilThread(
		repo,
		id,
		(detail) =>
			detail.summary.status === 'idle' &&
			detail.entries.some(
				(entry) => entry.type === 'message' && entry.text === 'Because readers asked for one.'
			)
	);

	expect(detail.entries.at(-1)).toMatchObject({
		type: 'message',
		text: 'Because readers asked for one.'
	});
	expect(detail.summary.changes).toEqual({ files: 0, additions: 0, deletions: 0 });
});

test('allocates repository-scoped numbers concurrently and never reuses purged numbers', async () => {
	const name = 'numbered';
	await seed(name, { 'notes.md': 'Notes\n' });
	await script(
		name,
		Array.from({ length: 4 }, () => [{ type: 'response.output_text.delta', delta: 'Ok.' }])
	);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName(name);
	const author = { name: 'Sam', kind: 'person' as const };
	const open = (text: string) =>
		repo.openThread({
			repo: name,
			author,
			text,
			mode: 'small',
			machine: 'standard-1'
		});
	const opened = await Promise.all([open('First'), open('Second'), open('Third')]);
	expect(opened.map((thread) => thread.number).sort()).toEqual([1, 2, 3]);
	for (const thread of opened) {
		expect(thread.id).toMatch(/^[0-9a-f]{12}$/);
		await untilThread(repo, thread.id, (detail) => detail.summary.status === 'idle');
		expect((await repo.thread(thread.id))!.summary.number).toBe(thread.number);
	}
	const newest = opened.find((thread) => thread.number === 3)!;
	await repo.delete(newest.id, author);
	const sql = await worker.getDurableObjectStorage('REPOS', { name });
	await sql.exec('UPDATE threads SET deleted_at = 1 WHERE id = ?', newest.id);
	await repo.delete(opened[0]!.id === newest.id ? opened[1]!.id : opened[0]!.id, author);
	for (let i = 0; i < 50 && (await repo.thread(newest.id)); i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await repo.thread(newest.id)).toBeNull();
	expect((await open('Fourth')).number).toBe(4);

	const other = env.REPOS.getByName('numbered-other');
	expect(
		(
			await other.openThread({
				repo: 'numbered-other',
				author,
				text: 'Independent',
				mode: 'small',
				machine: 'standard-1'
			})
		).number
	).toBe(1);
});

test('resolves numbered routes without confusing numeric legacy IDs or invalid numbers', async () => {
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('route-numbers');
	await repo.threads();
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'route-numbers' });
	await sql.exec(`INSERT INTO threads (id, number, headline, status, mode, updated_at)
		VALUES ('abcdef012345', 42, 'First', 'idle', 'small', 0),
		('123456789012', 7, 'Numeric hex ID', 'idle', 'small', 0)`);
	expect(await repo.resolveThread('42')).toEqual({ id: 'abcdef012345', number: 42 });
	expect(await repo.resolveThread('00042')).toEqual({ id: 'abcdef012345', number: 42 });
	expect(await repo.resolveThread('abcdef012345')).toEqual({ id: 'abcdef012345', number: 42 });
	expect(await repo.resolveThread('123456789012')).toEqual({ id: '123456789012', number: 7 });
	for (const ref of [
		'0',
		'-42',
		'4.2',
		'4.2e1',
		'+42',
		'',
		' 42',
		'9007199254740993',
		'43',
		'ffffffffffff'
	]) {
		expect(await repo.resolveThread(ref)).toBeNull();
	}
	const other = env.REPOS.getByName('route-numbers-other');
	expect(await other.resolveThread('42')).toBeNull();
	expect(await other.resolveThread('abcdef012345')).toBeNull();
});

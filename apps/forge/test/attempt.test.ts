import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup } from './support.ts';

const { dir, git, worker, script, modelRequests, sh, seed, commit, start, submitReview, settled } =
	await setup();

test('runs the agent on a fork of the repository, checkpointing its work', async () => {
	await seed('greeting', { 'greeting.ts': "export const greeting = 'hello';\n" });
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
		mode: 'small'
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
		mode: 'small'
	});

	await repo.discard(id, sam);
	expect((await repo.thread(id))!.summary.status).toBe('discarded');
	await repo.reopen(id, sam);
	const reopened = await repo.thread(id);
	expect(reopened!.summary.status).toBe('draft');
	expect(reopened!.entries.map((entry) => entry.type === 'event' && entry.text)).toEqual(
		expect.arrayContaining(['Discarded by Sam', 'Reopened by Sam'])
	);

	await repo.delete(id, sam);
	expect(await repo.threads()).toEqual([]);
	expect(await repo.thread(id)).toMatchObject({
		summary: { deleted: { by: 'Sam' } },
		entries: []
	});
	await expect(
		Promise.resolve().then(() => repo.reply(id, { author: sam, text: 'Hello?' }))
	).rejects.toThrow();

	await repo.restore(id);
	expect(await repo.threads()).toMatchObject([{ id, deleted: null }]);

	await repo.delete(id, sam);
	const sql = await worker.getDurableObjectStorage('REPOS', { name: 'lifecycle' });
	await sql.exec('UPDATE threads SET deleted_at = deleted_at - ? WHERE id = ?', 8 * 86_400_000, id);
	const later = await repo.openThread({
		repo: 'lifecycle',
		author: sam,
		text: 'Another try.',
		mode: 'small'
	});
	await repo.delete(later.id, sam);

	for (let i = 0; i < 50 && (await repo.thread(id)); i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(await repo.thread(id)).toBeNull();
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
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		submitReview('pass', ['met'])
	]);

	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('notes');
	const live: { type: string; entry?: { type: string } }[] = [];
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
		mode: 'small'
	});
	expect(opened).toMatchObject({ status: 'draft', headline: 'The notes need a title.' });
	const drafted = async (count: number) => {
		for (let i = 0; i < 100; i++) {
			const detail = await repo.thread(opened.id);
			const intents = detail!.entries.filter((entry) => entry.type === 'intent');
			if (intents.length === count) return detail!;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		throw new Error(`The thread never had ${count} intents`);
	};
	expect((await drafted(1)).summary.headline).toBe('docs: tidy the notes');

	await repo.reply(opened.id, { author: sam, text: 'Call it Notes.' });
	await drafted(2);
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(opened.id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Updated it.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await repo.start(opened.id);

	let detail = await repo.thread(opened.id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(opened.id);
	}
	socket!.close();

	expect(detail!.summary).toMatchObject({
		status: 'needs-you',
		headline: 'docs(notes): add a title'
	});
	expect(
		detail!.entries.map((entry) =>
			entry.type === 'message'
				? `${entry.author.name}: ${entry.text}`
				: entry.type === 'event'
					? entry.text.replace(/[0-9a-f]{7}$/, 'sha')
					: entry.type === 'review'
						? `review ${entry.verdict}`
						: `intent ${entry.intent.headline}`
		)
	).toEqual([
		'Sam: The notes need a title.',
		'intent docs: tidy the notes',
		'ReGit: Proposed a tidy-up.',
		'Sam: Call it Notes.',
		'intent docs(notes): add a title',
		'ReGit: Updated it.',
		'Started the attempt',
		'ReGit: Adding the title',
		'Checkpoint sha',
		'ReGit: Added the title.',
		'review pass',
		'The attempt finished'
	]);
	expect(live.filter((message) => message.type === 'entry')).toHaveLength(detail!.entries.length);
	const requests = await modelRequests();
	expect(
		requests.map((request) => (request.headers['cf-aig-metadata'] as { task: string }).task)
	).toEqual([
		'conversation',
		'conversation',
		'conversation',
		'conversation',
		'code',
		'code',
		'review'
	]);
	const tools = (request: (typeof requests)[number]) =>
		(request.query as { tools: { name: string }[] }).tools.map((tool) => tool.name);
	expect(tools(requests[0]!)).toEqual([
		'read_file',
		'find_files',
		'search',
		'run',
		'propose_intent',
		'update_intent'
	]);
	expect(tools(requests[4]!)).toContain('write_file');
	const call = (50 * 0.1 + 10 * 0.5) / 1_000_000;
	expect(detail!.usage).toEqual({
		rows: [
			{
				task: 'conversation',
				model: 'gpt-6-luna',
				tokens: 240,
				cost: expect.closeTo(4 * call, 10)
			},
			{ task: 'attempt', model: 'gpt-6-luna', tokens: 120, cost: expect.closeTo(2 * call, 10) },
			{
				task: 'review',
				model: 'gpt-6.1-sol',
				tokens: 60,
				cost: expect.closeTo((50 * 2 + 10 * 10) / 1_000_000, 10)
			}
		],
		context: { used: 60, limit: 1_050_000 }
	});
	expect(await repo.threads()).toMatchObject([{ id: opened.id, status: 'needs-you' }]);
	expect(sh(join(dir, `notes--${opened.id}.git`), 'show', 'main:notes.md')).toBe(
		'# Notes\n\nSome notes'
	);
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
		[{ type: 'response.output_text.delta', delta: 'Kept it short.' }],
		submitReview('pass', ['met'])
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('steer');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'steer',
		author: sam,
		text: 'Add a title.',
		mode: 'small'
	});
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Proposed.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	await repo.start(id);
	await repo.reply(id, { author: sam, text: 'Keep the title short.' });
	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
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

test('sends work that fails review back to the agent, then finishes when it passes', async () => {
	await seed('reviewed', { 'notes.md': 'Some notes\n' });
	await script([
		[{ type: 'response.output_text.delta', delta: 'Sure.' }],
		[{ type: 'response.output_text.delta', delta: 'Done, I think.' }],
		submitReview('fail', ['unmet']),
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
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		submitReview('pass', ['met'])
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('reviewed');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'reviewed',
		author: sam,
		text: 'Add a title.',
		mode: 'small'
	});
	for (let i = 0; i < 100; i++) {
		const last = (await repo.thread(id))!.entries.at(-1);
		if (last?.type === 'message' && last.text === 'Sure.') break;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	await repo.intentProposed(id, {
		headline: 'docs: add a title',
		purpose: 'Readers need a title.',
		doneWhen: ['notes.md starts with a title']
	});
	await repo.start(id);

	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && ['running', 'reviewing'].includes(detail?.summary.status ?? ''); i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(id);
	}

	expect(detail!.summary.status).toBe('needs-you');
	expect(
		detail!.entries.flatMap((entry) => (entry.type === 'review' ? [entry] : []))
	).toMatchObject([
		{ round: 1, verdict: 'fail', checks: ['unmet'] },
		{ round: 2, verdict: 'pass', checks: ['met'] }
	]);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding[1]!.query)).toContain('A reviewer checked your work');
	expect(JSON.stringify(coding[1]!.query)).toContain('The title is missing.');
	expect(
		detail!.entries.some((entry) => entry.type === 'message' && entry.text.includes('reviewer'))
	).toBe(false);
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
		mode: 'small'
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
	expect((await env.ATTEMPTS.getByName(id).snapshot())!.status).toBe('interrupted');
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
		mode: 'small'
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

test('resumes a finished attempt when someone replies, updating the intent', async () => {
	await seed('resume', { 'notes.md': 'Some notes\n' });
	const intent = {
		headline: 'docs: add a title and footer',
		purpose: 'Readers need a title and a footer.',
		doneWhen: ['notes.md starts with a title', 'notes.md ends with a footer']
	};
	await script([
		[{ type: 'response.output_text.delta', delta: 'Sure.' }],
		[{ type: 'response.output_text.delta', delta: 'Added the title.' }],
		submitReview('pass', ['met']),
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'update',
					name: 'update_intent',
					arguments: JSON.stringify(intent)
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Added the footer too.' }],
		submitReview('pass', ['met', 'met'])
	]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('resume');
	const sam = { name: 'Sam', kind: 'person' as const };
	const { id } = await repo.openThread({
		repo: 'resume',
		author: sam,
		text: 'Add a title.',
		mode: 'small'
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
	await waitFor((detail) => detail.entries.at(-1)?.type === 'message');
	await repo.intentProposed(id, {
		headline: 'docs: add a title',
		purpose: 'Readers need a title.',
		doneWhen: ['notes.md starts with a title']
	});
	await repo.start(id);
	await waitFor((detail) => detail.summary.status === 'needs-you');

	await repo.reply(id, { author: sam, text: 'Also add a footer.' });
	const detail = await waitFor(
		(detail) =>
			detail.summary.status === 'needs-you' &&
			detail.entries.filter((entry) => entry.type === 'review').length === 2
	);

	expect(detail.summary.headline).toBe('docs: add a title and footer');
	expect(detail.entries.flatMap((entry) => (entry.type === 'review' ? [entry] : []))).toMatchObject(
		[
			{ round: 1, verdict: 'pass', checks: ['met'] },
			{ round: 1, verdict: 'pass', checks: ['met', 'met'] }
		]
	);
	const coding = (await modelRequests()).filter(
		(request) => (request.headers['cf-aig-metadata'] as { task: string }).task === 'code'
	);
	expect(JSON.stringify(coding[1]!.query)).toContain('Added the title.');
	expect(JSON.stringify(coding[1]!.query)).toContain('Sam: Also add a footer.');
	expect(
		(coding[1]!.query as { tools: { name: string }[] }).tools.map((tool) => tool.name)
	).toContain('update_intent');
});

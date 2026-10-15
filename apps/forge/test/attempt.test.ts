import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup, sleepCall } from './support.ts';

const { dir, git, worker, script, modelRequests, sh, seed, start, settled, untilRequests } =
	await setup();

test('prepares the workspace before the agent and blocks it on hook failure', async () => {
	await seed('hooks', {
		'.agents/setup': 'echo setup >> .git/hooks-ran\n',
		'.agents/resume': 'test "$(cat .git/hooks-ran)" = setup\necho resume >> .git/hooks-ran\n'
	});
	await script('hooks', [
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
	const requests = await modelRequests('hooks');
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
	expect(await modelRequests('hooks-fail')).toEqual([]);
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
	expect(await modelRequests('hooks-fail')).toEqual([]);
});

test('runs the agent on a fork of the repository, checkpointing its work', async () => {
	await seed('greeting', {
		'greeting.ts': "export const greeting = 'hello';\n",
		'AGENTS.md': 'Greeting project convention: use single quotes.'
	});
	await script('greeting', [
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
	expect(snapshot.steps).toHaveLength(3);
	expect(snapshot.steps[0]!.turns).toEqual([
		{ role: 'user', text: 'Sam: Make the greeting say hi' }
	]);

	const fork = join(dir, 'greeting--thread-1.git');
	const sha = snapshot.steps[1]!.checkpoint;
	expect(sha).toMatch(/^[0-9a-f]{40}$/);
	expect(sh(fork, 'rev-parse', 'main')).toBe(sha);
	expect(sh(fork, 'show', 'main:greeting.ts')).toBe("export const greeting = 'hi';");
	expect(sh(fork, 'log', '-1', '--format=%an %s', 'main')).toBe('ReGit Say hi instead');
	expect(sh(join(dir, 'greeting.git'), 'show', 'main:greeting.ts')).toBe(
		"export const greeting = 'hello';"
	);
	expect((await git.requests()).some((headers) => headers.authorization)).toBe(false);

	const [first, second] = await modelRequests('greeting');
	expect(JSON.stringify(first!.query)).toContain('Greeting project convention: use single quotes.');
	expect(JSON.stringify(first!.query)).toContain('verifying-changes');
	expect(JSON.stringify(first!.query)).not.toContain('Derive expected results from the contract');
	expect(first).toMatchObject({
		provider: 'openai',
		endpoint: 'responses',
		headers: { 'cf-aig-metadata': { thread: 'thread-1', mode: 'small', task: 'agent' } },
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
	await script('failing', [
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
		steps: [{ turns: [{ role: 'user', text: 'Sam: Anything' }] }]
	});
	const [sent] = await modelRequests('failing');
	expect(sent).toMatchObject({
		provider: 'anthropic',
		endpoint: 'v1/messages',
		headers: { 'cf-aig-metadata': { mode: 'medium', task: 'agent' } },
		query: { model: 'claude-opus-5-5', output_config: { effort: 'medium' } }
	});
});

test('records a failed agent turn in the thread', async () => {
	await seed('drafts', { 'README.md': '# Drafts\n' });
	await script('drafts', [
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
	expect(entries.at(-1)).toMatchObject({
		type: 'failure',
		title: 'The agent stopped',
		error: 'No credits',
		resumable: true
	});
	expect((await repo.thread(opened.id))!.summary.failure).toMatchObject({ error: 'No credits' });
});

test('steers a running attempt with messages read after the current step', async () => {
	await seed('steer', { 'notes.md': 'Some notes\n' });
	await script('steer', [
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
	await repo.reply(id, { author: sam, text: 'Keep the title short.' });
	let detail = await repo.thread(id);
	for (let i = 0; i < 300 && detail?.summary.status === 'working'; i++) {
		await new Promise((resolve) => setTimeout(resolve, 200));
		detail = await repo.thread(id);
	}

	expect(detail!.summary.status).toBe('idle');
	expect(detail!.entries.find((entry) => entry.type === 'message' && entry.steering)).toMatchObject(
		{ text: 'Keep the title short.', steering: { read: true } }
	);
	const turns = (await modelRequests('steer')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	expect(JSON.stringify(turns.at(-1)!.query)).toContain('Sam: Keep the title short.');
});

test('stops a running attempt mid tool call', async () => {
	await seed('stopping', { 'notes.md': 'Some notes\n' });
	await script('stopping', [sleepCall]);
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
	await untilRequests('stopping', id, 1);
	await new Promise((resolve) => setTimeout(resolve, 500));

	const stoppedAt = Date.now();
	await repo.stop(id, sam);
	const detail = await repo.thread(id);
	expect(Date.now() - stoppedAt).toBeLessThan(20_000);
	expect(detail!.summary.status).toBe('idle');
	expect(detail!.entries.at(-1)).toMatchObject({ type: 'event', text: 'Stopped by Sam' });
	expect((await env.ATTEMPTS.getByName(id).snapshot())!.status).toBe('interrupted');
	await new Promise((resolve) => setTimeout(resolve, 1000));
	expect((await repo.thread(id))!.entries.at(-1)).toMatchObject({ text: 'Stopped by Sam' });

	await script('stopping', [[{ type: 'response.output_text.delta', delta: 'Picking up.' }]]);
	await repo.reply(id, { author: sam, text: 'Carry on.' });
	await expect
		.poll(async () => (await repo.thread(id))!.entries.at(-1), { timeout: 30_000 })
		.toMatchObject({ type: 'message', text: 'Picking up.' });
	const stopped = 'Sam stopped your last turn before it finished';
	const query = JSON.stringify((await modelRequests('stopping')).at(-1)!.query);
	expect(query.split(stopped)).toHaveLength(2);
	expect(query.indexOf(stopped)).toBeLessThan(query.indexOf('Sam: Carry on.'));
});

test('reports a sandbox that fails before asking the model', async () => {
	await script('missing', []);
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
		.toMatchObject({ type: 'failure', title: 'The agent stopped' });
	const requests = (await modelRequests('missing')).filter(
		(request) => (request.headers['cf-aig-metadata'] as { thread: string }).thread === id
	);
	expect(requests).toHaveLength(0);
});

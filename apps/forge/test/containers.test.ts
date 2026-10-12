import { join } from 'node:path';
import { expect, test } from 'vitest';
import { setup } from './support.ts';

const { dir, git, worker, script, modelRequests, sh, seed, commit, start, settled } = await setup({
	containers: true
});

test('caches setup, reuses restored checkouts, and refreshes when tools change or the cache ages', async () => {
	const work = await seed('toolchain', {
		'README.md': '# Toolchain\n',
		'.agents/setup': 'echo setup >> .git/setup-runs\n',
		'.agents/resume': 'test -s .git/setup-runs\ntest ! -e .git/resume-ran\ntouch .git/resume-ran\n'
	});
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'fresh-hooks',
					name: 'run',
					arguments: JSON.stringify({ command: 'cat .git/setup-runs' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Nothing to do.' }],
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'restored-hooks',
					name: 'run',
					arguments: JSON.stringify({ command: 'cat .git/setup-runs' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Still nothing.' }],
		[{ type: 'response.output_text.delta', delta: 'Nothing here either.' }],
		[{ type: 'response.output_text.delta', delta: 'All set.' }],
		[{ type: 'response.output_text.delta', delta: 'New source ready.' }],
		[{ type: 'response.output_text.delta', delta: 'Refreshed.' }]
	]);
	const env = await worker.getEnv();
	const recorded = () =>
		env.DB.prepare('SELECT snapshot_id AS id, key, size FROM toolchain_snapshots WHERE repo = ?')
			.bind('toolchain')
			.first<{ id: string; key: string; size: number }>();

	await start('thread-3', { task: 'Look around', mode: 'small', repo: 'toolchain' });
	// The first container after an image rebuild can take minutes to start locally.
	expect(await settled('thread-3', 300_000)).toMatchObject({
		status: 'finished',
		error: null,
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
	const hookResults = JSON.stringify(await modelRequests());
	expect(hookResults.match(/exit code 0\\nsetup(?!\\nsetup)/g)).toHaveLength(2);
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
	await commit(work, { 'README.md': '# Updated source\n' }, 'Change source only');
	sh(work, 'push', '--quiet', join(dir, 'toolchain.git'), 'main');
	await start('thread-5b', { task: 'Check new source', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-5b')).toMatchObject({
		status: 'finished',
		error: null,
		toolchain: { restored: true }
	});
	expect(await recorded()).toEqual(refreshed);

	await env.DB.prepare('UPDATE toolchain_snapshots SET created_at = ? WHERE repo = ?')
		.bind(Date.now() - 2 * 24 * 60 * 60 * 1000, 'toolchain')
		.run();
	await start('thread-5c', { task: 'Check an aged cache', mode: 'small', repo: 'toolchain' });
	expect(await settled('thread-5c')).toMatchObject({ status: 'finished', error: null });
	const aged = await recorded();
	expect(aged!.key).toBe(refreshed!.key);
	expect(aged!.id).not.toBe(refreshed!.id);
}, 600_000);

test('records the stages of a cold start in the thread', async () => {
	await seed('cold', { 'README.md': '# Cold\n', '.agents/setup': 'echo dependencies-ready\n' });
	await script([[{ type: 'response.output_text.delta', delta: 'Hello.' }]]);
	const env = await worker.getEnv();
	const repo = env.REPOS.getByName('cold');
	const { id } = await repo.openThread({
		repo: 'cold',
		author: { name: 'Sam', kind: 'person' },
		text: 'Say hello.',
		mode: 'small',
		machine: 'standard-1'
	});

	await expect
		.poll(
			async () =>
				(await repo.thread(id))!.entries.some(
					(entry) => entry.type === 'message' && entry.author.kind === 'agent'
				),
			{ timeout: 300_000, interval: 1000 }
		)
		.toBe(true);
	const { entries } = (await repo.thread(id))!;
	const startup = entries.find((entry) => entry.type === 'startup');
	const reply = entries.find((entry) => entry.type === 'message' && entry.author.kind === 'agent');
	expect(entries.indexOf(startup!)).toBeLessThan(entries.indexOf(reply!));
	expect(startup).toMatchObject({
		stages: [
			{ label: 'Start a ½ vCPU sandbox', status: 'done' },
			{ label: 'Clone cold', status: 'done' },
			{
				label: expect.stringMatching(/^Install .*agent-browser 0\.38\.2.*jq \S+$/),
				status: 'done'
			},
			{ label: 'Run .agents/setup', status: 'done', output: 'dependencies-ready' },
			{ label: 'Cache the prepared sandbox', status: 'done' }
		]
	});
	for (const stage of startup!.type === 'startup' ? startup!.stages : []) {
		expect(stage.finishedAt!).toBeGreaterThanOrEqual(stage.startedAt!);
	}
});

test('runs native commands with the workspace environment, bounded output and process-tree deadlines', async () => {
	await seed('native-run', { 'README.md': '# Native run\n' });
	const calls = [
		{
			command:
				'printf "%s\\n" "$PWD" "$MISE_DATA_DIR" "$MISE_CACHE_DIR" "$REGIT_PREVIEW_HOST"; jq -n 42; printf diagnostic >&2; exit 7'
		},
		{
			command: "printf HEAD; printf 'α%.0s' {1..11000}; printf 'β%.0s' {1..23001}; printf TAIL"
		},
		{ command: 'exit 124' },
		{ command: 'exit 137' },
		{ command: '(sleep 2; touch foreground-survived) & wait', timeout_seconds: 1 },
		{ command: '(sleep 2; touch background-survived) & printf begun', timeout_seconds: 1 },
		{
			command:
				'sleep 2; test ! -e foreground-survived && test ! -e background-survived && printf stopped'
		}
	];
	await script([
		calls.map((args, index) => ({
			type: 'response.output_item.done',
			item: {
				type: 'function_call',
				call_id: `native-${index}`,
				name: 'run',
				arguments: JSON.stringify(args)
			}
		})),
		[{ type: 'response.output_text.delta', delta: 'Checked native commands.' }]
	]);
	await start('native-run-thread', { task: 'Run checks', mode: 'small', repo: 'native-run' });
	const snapshot = await settled('native-run-thread');
	expect(snapshot).toMatchObject({ status: 'finished', error: null });
	const outputs = snapshot.steps.flatMap((step) =>
		step.turns.flatMap((turn) => (turn.role === 'tool' ? turn.results.map((r) => r.output) : []))
	);
	expect(outputs).toHaveLength(calls.length);
	expect(outputs[0]).toMatch(
		/^exit code 7\n\/workspace\n\/opt\/mise\n\/opt\/mise\/cache\n\w+-\{name\}\.regit\.run\n/
	);
	expect(outputs[0]).toContain('42');
	expect(outputs[0]).toContain('diagnostic');
	expect(outputs[1]).toBe(
		`exit code 0\nHEAD${'α'.repeat(9996)}\n… 14009 characters omitted …\n${'β'.repeat(9996)}TAIL`
	);
	expect(outputs.slice(2)).toEqual([
		'exit code 124',
		'exit code 137',
		'timed out after 1s',
		'timed out after 1s\nbegun',
		'exit code 0\nstopped'
	]);

	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'restored',
					name: 'run',
					arguments: JSON.stringify({
						command: `set -e
jq -n 43
export AGENT_BROWSER_SESSION=container-smoke
trap 'agent-browser close >/dev/null 2>&1; rm -f /tmp/browser-smoke.png' EXIT
agent-browser open about:blank >/dev/null
agent-browser eval 'document.body.innerHTML = "<button>Before</button>"; document.querySelector("button").onclick = () => document.body.textContent = "After"' >/dev/null
agent-browser find role button click --name Before >/dev/null
test "$(agent-browser get text body)" = After
agent-browser screenshot /tmp/browser-smoke.png >/dev/null
test "$(od -An -tx1 -N8 /tmp/browser-smoke.png | tr -d ' \\n')" = 89504e470d0a1a0a
printf browser-ok`
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'Checked the restored toolchain.' }]
	]);
	await start('native-restored-thread', { task: 'Run again', mode: 'small', repo: 'native-run' });
	const restored = await settled('native-restored-thread');
	expect(restored).toMatchObject({
		status: 'finished',
		error: null,
		toolchain: { restored: true }
	});
	expect(restored.steps.flatMap((step) => step.turns)).toContainEqual({
		role: 'tool',
		results: [
			{ callId: 'restored', output: expect.stringMatching(/^exit code 0\n43\n.*browser-ok$/s) }
		]
	});
});

test('stopping a native command kills its children without destroying the workspace', async () => {
	await seed('native-stop', { 'README.md': '# Native stop\n' });
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'start-child',
					name: 'run',
					arguments: JSON.stringify({
						command: 'touch started; (sleep 4; touch survived) & wait',
						timeout_seconds: 30
					})
				}
			}
		]
	]);
	await start('native-stop-thread', { task: 'Run a build', mode: 'small', repo: 'native-stop' });
	await expect.poll(async () => (await modelRequests()).length, { timeout: 120_000 }).toBe(1);
	await new Promise((resolve) => setTimeout(resolve, 500));
	const env = await worker.getEnv();
	const attempt = env.ATTEMPTS.getByName('native-stop-thread');
	await attempt.stop();
	expect(await attempt.snapshot()).toMatchObject({ status: 'interrupted' });
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'check-child',
					name: 'run',
					arguments: JSON.stringify({
						command: 'sleep 4; test -e started && test ! -e survived && printf stopped'
					})
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'The child was stopped.' }]
	]);
	await attempt.converse({
		repo: 'native-stop',
		mode: 'small',
		author: 'Sam',
		text: 'Check that the build stopped',
		entry: 'stop-check'
	});
	const resumed = await settled('native-stop-thread');
	expect(resumed).toMatchObject({ status: 'finished', error: null });
	expect(resumed.steps.flatMap((step) => step.turns)).toContainEqual({
		role: 'tool',
		results: [{ callId: 'check-child', output: 'exit code 0\nstopped' }]
	});
});

test('tells the agent when its sandbox was rebuilt between turns', async () => {
	await seed('rebuilt', { 'README.md': '# Rebuilt\n', '.gitignore': 'built/\n' });
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'build',
					name: 'run',
					arguments: JSON.stringify({
						command: 'mkdir built && touch built/marker && sleep 30',
						timeout_seconds: 60
					})
				}
			}
		]
	]);
	await start('rebuilt-thread', { task: 'Build it', mode: 'small', repo: 'rebuilt' });
	await expect.poll(async () => (await modelRequests()).length, { timeout: 300_000 }).toBe(1);
	await new Promise((resolve) => setTimeout(resolve, 1000));
	const env = await worker.getEnv();
	const attempt = env.ATTEMPTS.getByName('rebuilt-thread');
	await attempt.cancel();
	await script([
		[
			{
				type: 'response.output_item.done',
				item: {
					type: 'function_call',
					call_id: 'check-build',
					name: 'run',
					arguments: JSON.stringify({ command: 'test ! -e built/marker && printf gone' })
				}
			}
		],
		[{ type: 'response.output_text.delta', delta: 'The build output is gone.' }]
	]);
	await attempt.converse({
		repo: 'rebuilt',
		mode: 'small',
		author: 'Sam',
		text: 'Is the build still there?',
		entry: 'rebuilt-check'
	});
	const resumed = await settled('rebuilt-thread', 300_000);
	expect(resumed).toMatchObject({ status: 'finished', error: null });
	const turns = resumed.steps.flatMap((step) => step.turns);
	expect(turns.filter((turn) => turn.role === 'notification')).toEqual([
		{ role: 'notification', text: expect.stringContaining('Your sandbox was rebuilt') }
	]);
	expect(turns).toContainEqual({
		role: 'tool',
		results: [{ callId: 'check-build', output: 'exit code 0\ngone' }]
	});
});

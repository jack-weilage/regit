import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseChecks } from './checks.ts';
import { git } from './exec.ts';
import { root, useWorkspace, workspace } from './test-workspace.ts';

useWorkspace();

async function commit(files: Record<string, string>, cwd = root) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(cwd, path, '..'), { recursive: true });
		await writeFile(join(cwd, path), content);
	}
	await git(cwd, ['add', '.']);
	await git(cwd, ['-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', 'commit', '-m', 'x']);
	return git(cwd, ['rev-parse', 'HEAD']);
}

const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

const config = `checks:
  - name: types
    run: test -f greeting.ts
    before: [handoff, deploy]
  - name: docs
    ask: Public changes come with docs
    when: ['src/**']
    before: [handoff]
  - name: lint
    run: exit 0
    inputs: greeting.ts
    blocking: false
    timeout: 30
    before: deploy
`;

describe('parsing checks', () => {
	test('reads run and ask checks with their defaults', () => {
		expect(parseChecks(config)).toEqual([
			{ name: 'types', run: 'test -f greeting.ts', before: ['handoff', 'deploy'], blocking: true },
			{
				name: 'docs',
				ask: 'Public changes come with docs',
				when: ['src/**'],
				before: ['handoff'],
				blocking: false
			},
			{
				name: 'lint',
				run: 'exit 0',
				inputs: ['greeting.ts'],
				before: ['deploy'],
				blocking: false,
				timeoutSeconds: 30
			}
		]);
		expect(parseChecks('')).toEqual([]);
	});

	test.each([
		['checks: {}', 'expected a checks list'],
		['checks:\n  - run: x\n    before: [deploy]', 'check 1 needs a name'],
		['checks:\n  - name: a\n    before: [deploy]', 'a needs exactly one of run or ask'],
		[
			'checks:\n  - name: a\n    run: x\n    ask: y\n    before: [deploy]',
			'exactly one of run or ask'
		],
		[
			'checks:\n  - name: a\n    run: x\n    before: [merge]',
			'before must list handoff and/or deploy'
		],
		['checks:\n  - name: a\n    ask: x\n    before: [deploy]', 'only run before handoff'],
		[
			'checks:\n  - name: a\n    run: x\n    before: [deploy]\n    befor: [deploy]',
			'unknown keys: befor'
		],
		[
			'checks:\n  - name: a\n    ask: x\n    inputs: [a]\n    before: [handoff]',
			'inputs only apply'
		],
		[
			'checks:\n  - name: a\n    run: x\n    before: [deploy]\n  - name: a\n    run: y\n    before: [deploy]',
			'a is defined twice'
		],
		['checks: [', '.agents/checks.yml: ']
	])('rejects %j', (text, message) => {
		expect(() => parseChecks(text)).toThrow(message);
	});
});

describe('planning checks', () => {
	test('has nothing to plan without a checks file', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		await commit({ 'greeting.ts': "export const greeting = 'hi';\n" });
		expect(await workspace.checks({ base, commit: 'HEAD' })).toEqual({
			checks: [],
			governing: []
		});
	});

	test('reports an invalid checks file instead of skipping it', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		await commit({ '.agents/checks.yml': 'checks:\n  - name: a\n    before: [deploy]\n' });
		expect(await workspace.checks({ base, commit: 'HEAD' })).toEqual({
			checks: [],
			error: '.agents/checks.yml: a needs exactly one of run or ask',
			governing: ['.agents/checks.yml']
		});
	});

	test('applies checks to the changed paths and keys them by their inputs', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		await commit({ '.agents/checks.yml': config, 'notes.md': 'Notes\n' });
		const first = await workspace.checks({ base, commit: 'HEAD' });
		expect(first.checks.map(({ name, applies }) => [name, applies])).toEqual([
			['types', true],
			['docs', false],
			['lint', true]
		]);
		expect(first.checks[0]!.inputsHash).toBe(await git(root, ['rev-parse', 'HEAD^{tree}']));

		await commit({ 'src/app.ts': 'export {};\n' });
		const second = await workspace.checks({ base, commit: 'HEAD' });
		expect(second.checks.find((check) => check.name === 'docs')!.applies).toBe(true);
		expect(second.checks[2]!.inputsHash).toBe(first.checks[2]!.inputsHash);
		expect(second.checks[0]!.inputsHash).not.toBe(first.checks[0]!.inputsHash);
		expect(second.checks[1]!.inputsHash).not.toBe(first.checks[1]!.inputsHash);

		await commit({ 'greeting.ts': "export const greeting = 'hi';\n" });
		const third = await workspace.checks({ base, commit: 'HEAD' });
		expect(third.checks[2]!.inputsHash).not.toBe(second.checks[2]!.inputsHash);
	});
});

describe('what governs deploys', () => {
	test('names changes to the checks and the deploy script, and plans everything from the empty tree', async () => {
		await commit({ '.agents/checks.yml': config });
		const main = await git(root, ['rev-parse', 'HEAD']);
		await commit({ '.agents/deploy': 'echo deploying\n', 'notes.md': 'Notes\n' });
		const changed = await workspace.checks({ base: main, commit: 'HEAD' });
		expect(changed.governing).toEqual(['.agents/deploy']);
		expect(changed.checks.map(({ name, applies }) => [name, applies])).toEqual([
			['types', true],
			['docs', false],
			['lint', true]
		]);
		const everything = await workspace.checks({ base: emptyTree, commit: main });
		expect(everything.governing).toEqual(['.agents/checks.yml']);
		expect(everything.checks.every(({ name, applies }) => applies || name === 'docs')).toBe(true);
	});
});

describe('running checks', () => {
	test('reports the exit status and the end of the output, and logs all of it', async () => {
		expect(await workspace.runCheck({ name: 'fine', command: 'echo fine' })).toEqual({
			ok: true,
			output: 'exit code 0\nfine',
			log: '.git/regit-checks/fine.log'
		});
		expect(
			await workspace.runCheck({ name: 'unit tests', command: 'echo broken >&2; exit 3' })
		).toEqual({
			ok: false,
			output: 'exit code 3\nbroken',
			log: '.git/regit-checks/unit-tests.log'
		});
		expect(
			await workspace.runCheck({ name: 'slow', command: 'sleep 5', timeoutSeconds: 1 })
		).toMatchObject({ ok: false, output: 'timed out after 1s' });

		const long = await workspace.runCheck({ name: 'long', command: 'seq 1 500; exit 1' });
		expect(long.output.split('\n').slice(0, 3)).toEqual([
			'exit code 1',
			'… (end of the log)',
			'461'
		]);
		expect(long.output).toEndWith('\n500');
		const log = await readFile(join(root, long.log), 'utf8');
		expect(log).toStartWith('$ seq 1 500; exit 1\n1\n2\n');
		expect(log).toEndWith('500\n\nexit code 1\n');
		expect(await git(root, ['status', '--porcelain'])).toBe('');
	});

	test('removes what a check leaves in a clean workspace, but not work in progress', async () => {
		await workspace.runCheck({
			name: 'generate',
			command:
				'mkdir -p coverage && echo report > coverage/index.html && echo changed > greeting.ts'
		});
		expect(await git(root, ['status', '--porcelain'])).toBe('');

		await writeFile(join(root, 'draft.md'), 'Draft\n');
		await workspace.runCheck({ name: 'generate', command: 'echo report > report.txt' });
		expect(await git(root, ['status', '--porcelain', '--untracked-files=all'])).toBe(
			'?? draft.md\n?? report.txt'
		);
	});

	test('can be cancelled', async () => {
		const started = Date.now();
		const run = workspace.runCheck({ name: 'hang', command: 'sleep 30' });
		await Bun.sleep(300);
		await workspace.cancelChecks();
		expect(await run).toMatchObject({ ok: false, output: 'cancelled' });
		expect(Date.now() - started).toBeLessThan(10_000);
	});

	test('checks another commit in its own worktree, leaving the workspace untouched', async () => {
		const old = await git(root, ['rev-parse', 'HEAD']);
		await commit({ 'greeting.ts': "export const greeting = 'hi';\n" });
		await writeFile(join(root, 'greeting.ts'), 'uncommitted\n');
		const result = await workspace.runCheck({
			name: 'old',
			command: 'cat greeting.ts; echo generated > generated.txt',
			commit: old
		});
		expect(result).toMatchObject({
			ok: true,
			output: "exit code 0\nexport const greeting = 'hello';"
		});
		expect(await git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe('uncommitted\n');
		expect(await git(root, ['status', '--porcelain', '--untracked-files=all'])).toBe(
			'M greeting.ts'
		);

		const again = await workspace.runCheck({ name: 'again', command: 'ls', commit: old });
		expect(again.output).not.toContain('generated.txt');
	});

	test('prepares the worktree with the setup hook only when dependency files change', async () => {
		const first = await commit({
			'.agents/setup':
				'echo ran >> "$(git rev-parse --git-common-dir)/setup-runs"\nmkdir -p deps\n',
			'package.json': '{}\n',
			'.gitignore': 'deps/\n'
		});
		const runs = () =>
			readFile(join(root, '.git/setup-runs'), 'utf8').then((text) => text.split('\n').length - 1);
		expect(
			await workspace.runCheck({ name: 'deps', command: 'test -d deps', commit: first })
		).toMatchObject({
			ok: true
		});
		const second = await commit({ 'notes.md': 'Notes\n' });
		await workspace.runCheck({ name: 'deps', command: 'test -d deps', commit: second });
		expect(await runs()).toBe(1);
		const third = await commit({ 'package.json': '{ "name": "x" }\n' });
		await workspace.runCheck({ name: 'deps', command: 'test -d deps', commit: third });
		expect(await runs()).toBe(2);

		const broken = await commit({ '.agents/setup': 'echo nope; exit 4\n' });
		const failed = await workspace.runCheck({ name: 'deps', command: 'true', commit: broken });
		expect(failed).toEqual({
			ok: false,
			output: '.agents/setup failed while preparing the check checkout\nnope',
			log: '.git/regit-checks/setup.log'
		});
	});
});

describe('deploying', () => {
	test('runs the deploy script at a commit with the secrets, keeping them out of its output', async () => {
		const none = await git(root, ['rev-parse', 'HEAD']);
		expect(await workspace.deploy({ commit: none, env: {} })).toEqual({ ran: false });

		const ok = await commit({
			'.agents/deploy': 'echo "deploying $(cat greeting.ts) with $API_TOKEN"\n'
		});
		await writeFile(join(root, 'greeting.ts'), 'uncommitted\n');
		const deployed = await workspace.deploy({ commit: ok, env: { API_TOKEN: 'sekrit-value' } });
		expect(deployed).toEqual({
			ran: true,
			ok: true,
			output: "exit code 0\ndeploying export const greeting = 'hello'; with [secret]",
			log: '.git/regit-checks/deploy.log'
		});
		const log = await readFile(join(root, '.git/regit-checks/deploy.log'), 'utf8');
		expect(log).toContain('with [secret]');
		expect(log).not.toContain('sekrit');
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe('uncommitted\n');

		const broken = await commit({ '.agents/deploy': 'echo nope; exit 2\n' });
		expect(await workspace.deploy({ commit: broken, env: {} })).toMatchObject({
			ran: true,
			ok: false,
			output: 'exit code 2\nnope'
		});
	});

	test('lists the first-parent commits in a range, oldest first', async () => {
		const from = await git(root, ['rev-parse', 'HEAD']);
		const one = await commit({ 'a.md': 'A\n' });
		await writeFile(join(root, 'b.md'), 'B\n');
		await git(root, ['add', '.']);
		await git(root, [
			'-c',
			'user.name=Sam',
			'-c',
			'user.email=s@example.com',
			'commit',
			'-m',
			'Add b\n\nWhy'
		]);
		const two = await git(root, ['rev-parse', 'HEAD']);
		expect(await workspace.commits({ from, to: two })).toEqual({
			commits: [
				{ sha: one, headline: 'x' },
				{ sha: two, headline: 'Add b' }
			]
		});
		expect(await workspace.commits({ from: null, to: one })).toEqual({
			commits: [{ sha: one, headline: 'x' }]
		});
	});
});

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { parseChecks } from './checks.ts';
import { git } from './exec.ts';
import { author, dir, remote, root, useWorkspace, workspace } from './test-workspace.ts';

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

const config = `checks:
  - name: types
    run: test -f greeting.ts
    before: [handoff, ship]
  - name: docs
    ask: Public changes come with docs
    when: ['src/**']
    before: [ship]
  - name: lint
    run: exit 0
    inputs: greeting.ts
    blocking: false
    timeout: 30
    before: ship
`;

describe('parsing checks', () => {
	test('reads run and ask checks with their defaults', () => {
		expect(parseChecks(config)).toEqual([
			{ name: 'types', run: 'test -f greeting.ts', before: ['handoff', 'ship'], blocking: true },
			{
				name: 'docs',
				ask: 'Public changes come with docs',
				when: ['src/**'],
				before: ['ship'],
				blocking: false
			},
			{
				name: 'lint',
				run: 'exit 0',
				inputs: ['greeting.ts'],
				before: ['ship'],
				blocking: false,
				timeoutSeconds: 30
			}
		]);
		expect(parseChecks('')).toEqual([]);
	});

	test.each([
		['checks: {}', 'expected a checks list'],
		['checks:\n  - run: x\n    before: [ship]', 'check 1 needs a name'],
		['checks:\n  - name: a\n    before: [ship]', 'a needs exactly one of run or ask'],
		[
			'checks:\n  - name: a\n    run: x\n    ask: y\n    before: [ship]',
			'exactly one of run or ask'
		],
		[
			'checks:\n  - name: a\n    run: x\n    before: [merge]',
			'before must list handoff and/or ship'
		],
		[
			'checks:\n  - name: a\n    run: x\n    before: [ship]\n    befor: [ship]',
			'unknown keys: befor'
		],
		['checks:\n  - name: a\n    ask: x\n    inputs: [a]\n    before: [ship]', 'inputs only apply'],
		[
			'checks:\n  - name: a\n    run: x\n    before: [ship]\n  - name: a\n    run: y\n    before: [ship]',
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
			configChanged: false
		});
	});

	test('reports an invalid checks file instead of skipping it', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		await commit({ '.agents/checks.yml': 'checks:\n  - name: a\n    before: [ship]\n' });
		expect(await workspace.checks({ base, commit: 'HEAD' })).toEqual({
			checks: [],
			error: '.agents/checks.yml: a needs exactly one of run or ask',
			configChanged: true
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

describe('whose checks govern', () => {
	test('reads the checks from another commit and reports when the change edits them', async () => {
		await commit({ '.agents/checks.yml': config });
		const main = await git(root, ['rev-parse', 'HEAD']);
		await commit({
			'.agents/checks.yml': 'checks:\n  - name: types\n    run: exit 0\n    before: [ship]\n',
			'notes.md': 'Notes\n'
		});
		const own = await workspace.checks({ base: main, commit: 'HEAD' });
		expect(own.checks.map(({ name }) => name)).toEqual(['types']);
		const governed = await workspace.checks({ base: main, commit: 'HEAD', config: main });
		expect(governed.configChanged).toBe(true);
		expect(governed.checks.map(({ name }) => name)).toEqual(['types', 'docs', 'lint']);
		expect(governed.checks[0]).toMatchObject({ run: 'test -f greeting.ts', applies: true });
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
			output: '.agents/setup failed while preparing the ship checkout\nnope',
			log: '.git/regit-checks/setup.log'
		});
	});
});

describe('ship candidates', () => {
	test('match the commit a ship pushes after main moved, or name the conflicts', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		const source = await commit({ 'greeting.ts': "export const greeting = 'hi';\n" });
		const elsewhere = join(dir, 'elsewhere');
		await git(dir, ['clone', remote, elsewhere]);
		const onto = await commit({ 'other.md': 'Other\n' }, elsewhere);
		await git(elsewhere, ['push', 'origin', 'main']);
		await git(root, ['fetch', 'origin', 'main']);

		const built = await workspace.candidate({ base, onto, source });
		const shipped = await workspace.buildShip({
			id: 'b'.repeat(32),
			sourceSha: source,
			base,
			remote,
			branch: 'main',
			message: 'Ship',
			author,
			committer: author
		});
		expect(built).toEqual({ sha: expect.any(String), tree: shipped.tree });

		const clash = await commit({ 'greeting.ts': "export const greeting = 'hey';\n" }, elsewhere);
		await git(root, ['fetch', elsewhere, 'main']);
		expect(await workspace.candidate({ base, onto: clash, source })).toEqual({
			conflicts: ['greeting.ts']
		});
	});
});

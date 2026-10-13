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
		expect(await workspace.checks({ base, commit: 'HEAD' })).toEqual({ checks: [] });
	});

	test('reports an invalid checks file instead of skipping it', async () => {
		const base = await git(root, ['rev-parse', 'HEAD']);
		await commit({ '.agents/checks.yml': 'checks:\n  - name: a\n    before: [ship]\n' });
		expect(await workspace.checks({ base, commit: 'HEAD' })).toEqual({
			checks: [],
			error: '.agents/checks.yml: a needs exactly one of run or ask'
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

describe('running checks', () => {
	test('reports the exit status and output', async () => {
		expect(await workspace.runCheck({ command: 'echo fine' })).toEqual({
			ok: true,
			output: 'exit code 0\nfine'
		});
		expect(await workspace.runCheck({ command: 'echo broken >&2; exit 3' })).toEqual({
			ok: false,
			output: 'exit code 3\nbroken'
		});
		expect(await workspace.runCheck({ command: 'sleep 5', timeoutSeconds: 1 })).toEqual({
			ok: false,
			output: 'timed out after 1s'
		});
	});

	test('runs at another commit and returns the workspace to its branch', async () => {
		const old = await git(root, ['rev-parse', 'HEAD']);
		await commit({ 'greeting.ts': "export const greeting = 'hi';\n" });
		const result = await workspace.runCheck({
			command: 'cat greeting.ts; echo dirty > greeting.ts',
			commit: old
		});
		expect(result).toEqual({ ok: true, output: "exit code 0\nexport const greeting = 'hello';" });
		expect(await git(root, ['symbolic-ref', '--short', 'HEAD'])).toBe('main');
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe(
			"export const greeting = 'hi';\n"
		);

		await writeFile(join(root, 'greeting.ts'), 'uncommitted\n');
		expect(workspace.runCheck({ command: 'true', commit: old })).rejects.toThrow(
			'uncommitted changes'
		);
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

import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { git } from './exec.ts';
import {
	author,
	call,
	dir,
	recreateSandbox,
	remote,
	root,
	useWorkspace,
	workspace
} from './test-workspace.ts';

useWorkspace();

describe('workspace', () => {
	test('clones a remote into an empty workspace', async () => {
		const empty = join(dir, 'fresh');
		await git(dir, ['init', empty]);
		await rm(join(empty, '.git'), { recursive: true });
		recreateSandbox(empty);

		await workspace.clone({ remote, branch: 'main' });
		expect(await readFile(join(empty, 'greeting.ts'), 'utf8')).toContain('hello');
	});

	test('creates the requested branch when the remote lacks it', async () => {
		const empty = join(dir, 'fresh');
		await git(dir, ['init', empty]);
		await rm(join(empty, '.git'), { recursive: true });
		recreateSandbox(empty);

		await workspace.clone({ remote, branch: 'trunk' });
		expect(await git(empty, ['branch', '--show-current'])).toBe('trunk');
		expect(await readFile(join(empty, 'greeting.ts'), 'utf8')).toContain('hello');
	});

	test('retargets a clone of a different remote, as left by a restored snapshot', async () => {
		const other = join(dir, 'other.git');
		await git(dir, ['init', '--bare', '--initial-branch', 'main', other]);
		await git(root, ['push', other, 'main']);
		await git(root, ['remote', 'set-url', 'origin', other]);
		await call('write_file', { path: 'stale.ts', content: 'export {};\n' });

		await workspace.clone({ remote, branch: 'main' });
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(remote);
		await expect(readFile(join(root, 'stale.ts'), 'utf8')).rejects.toThrow();
	});

	test('replaces a workspace whose repository cannot be reused', async () => {
		await rm(join(root, '.git'), { recursive: true });
		await mkdir(join(root, '.git'));

		expect(await workspace.clone({ remote, branch: 'main' })).toEqual({
			preserved: false,
			setup: null
		});
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(remote);
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toContain('hello');
	});

	test('keeps prepared files when reusing a restored checkout at any revision', async () => {
		await call('write_file', { path: '.gitignore', content: '.cache/\n' });
		await call('write_file', {
			path: '.agents/setup',
			content: 'mkdir -p .cache\necho prepared > .cache/ready\n'
		});
		await workspace.commit({ message: 'Add setup', author });
		const setup = await git(root, ['rev-parse', 'HEAD:.agents/setup']);
		const fork = join(dir, 'fork.git');
		await git(dir, ['clone', '--bare', root, fork]);
		await workspace.hook('setup');
		expect(await workspace.clone({ remote: fork, branch: 'work' })).toEqual({
			preserved: true,
			setup
		});
		expect(await readFile(join(root, '.cache/ready'), 'utf8')).toBe('prepared\n');
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(fork);
		expect(await git(root, ['branch', '--format=%(refname:short)'])).toBe('work');
		await call('write_file', { path: 'greeting.ts', content: 'changed\n' });
		await workspace.commit({ message: 'Change source', author });
		await git(root, ['push', fork, 'HEAD:main']);
		await git(root, ['reset', '--hard', 'HEAD~1']);
		expect(await workspace.clone({ remote: fork, branch: 'main' })).toEqual({
			preserved: false,
			setup
		});
		expect(await readFile(join(root, '.cache/ready'), 'utf8')).toBe('prepared\n');
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe('changed\n');
		expect(await git(root, ['rev-parse', '--abbrev-ref', 'main@{upstream}'])).toBe('origin/main');
		expect(await git(root, ['branch', '--format=%(refname:short)'])).toBe('main');
	});

	test('installs and reports the toolchain with mise', async () => {
		const mise = join(dir, 'mise');
		const log = join(dir, 'mise.log');
		await writeFile(
			mise,
			`#!/usr/bin/env bash
echo "$PWD $*" >> ${log}
if [ "$1" = ls ]; then
	echo 'mise WARN some warning' >&2
	echo '{"node":[{"version":"22.23.3"}],"jq":[{"version":"1.8.2"}]}'
fi
`
		);
		await chmod(mise, 0o755);
		recreateSandbox(root, { mise });

		expect(await workspace.toolchain()).toEqual({ jq: ['1.8.2'], node: ['22.23.3'] });
		expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual([
			`${root} install`,
			`${root} ls --current --json`
		]);
	});

	test('reports a failed toolchain install', async () => {
		const mise = join(dir, 'mise');
		await writeFile(mise, '#!/usr/bin/env bash\necho "no such version" >&2\nexit 1\n');
		await chmod(mise, 0o755);
		recreateSandbox(root, { mise });

		await expect(workspace.toolchain()).rejects.toThrow('mise install failed: no such version');
	});

	test('resets a clone of the same remote to the remote branch', async () => {
		const elsewhere = join(dir, 'elsewhere');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'checkpoint.ts'), 'export {};\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=ReGit',
			'-c',
			'user.email=agent@regit.dev',
			'commit',
			'-m',
			'Checkpoint'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
		await call('write_file', { path: 'draft.ts', content: 'export {};\n' });

		await workspace.clone({ remote, branch: 'main' });
		expect(await readFile(join(root, 'checkpoint.ts'), 'utf8')).toBe('export {};\n');
		await expect(readFile(join(root, 'draft.ts'), 'utf8')).rejects.toThrow();
	});

	test('commits checkpoints only when something changed, then pushes', async () => {
		expect(await workspace.commit({ message: 'nothing', author })).toBeNull();

		await call('edit_file', { path: 'greeting.ts', old_string: 'hello', new_string: 'hi' });
		const sha = await workspace.commit({ message: 'Say hi', author });
		expect(sha).toMatch(/^[0-9a-f]{40}$/);

		await workspace.push({ ref: 'thread/say-hi' });
		expect(await git(remote, ['rev-parse', 'thread/say-hi'])).toBe(sha!);
		expect(await git(remote, ['log', '-1', '--format=%an <%ae> %s', 'thread/say-hi'])).toBe(
			'ReGit <agent@regit.dev> Say hi'
		);
	});

	test("commits and pushes without running the repository's git hooks", async () => {
		for (const hook of ['pre-commit', 'pre-push']) {
			await writeFile(join(root, '.git/hooks', hook), '#!/bin/sh\necho "hook ran"; exit 1\n');
			await chmod(join(root, '.git/hooks', hook), 0o755);
		}
		await call('edit_file', { path: 'greeting.ts', old_string: 'hello', new_string: 'hey' });
		const sha = await workspace.commit({ message: 'Say hey', author });
		await workspace.push({ ref: 'thread/say-hey' });
		expect(await git(remote, ['rev-parse', 'thread/say-hey'])).toBe(sha!);
	});
});

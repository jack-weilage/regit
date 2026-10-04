import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxTools, sandboxWorkspace, type ToolArguments, type ToolName } from '@regit/agent';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { git } from './exec.ts';
import { createSandbox } from './server.ts';

const author = { name: 'ReGit', email: 'agent@regit.dev' };

let dir: string;
let root: string;
let remote: string;
let sandbox: ReturnType<typeof createSandbox>;

const fetch = (url: string, init?: RequestInit) => sandbox(new Request(url, init));
const tools = sandboxTools(fetch);
const workspace = sandboxWorkspace(fetch);

function call<Name extends ToolName>(name: Name, args: ToolArguments[Name]) {
	return tools.execute({ id: 'call', name, arguments: JSON.stringify(args) });
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'regit-sandbox-'));
	remote = join(dir, 'remote.git');
	root = join(dir, 'workspace');
	await git(dir, ['init', '--bare', '--initial-branch', 'main', remote]);
	await git(dir, ['clone', remote, root]);
	await writeFile(join(root, 'greeting.ts'), "export const greeting = 'hello';\n");
	await git(root, ['add', '.']);
	await git(root, [
		'-c',
		'user.name=Sam',
		'-c',
		'user.email=sam@example.com',
		'commit',
		'-m',
		'init'
	]);
	await git(root, ['push', 'origin', 'main']);
	sandbox = createSandbox(root);
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe('tools', () => {
	test('reads files, paging long ones', async () => {
		expect(await call('read_file', { path: 'greeting.ts' })).toBe(
			"export const greeting = 'hello';\n"
		);

		await writeFile(
			join(root, 'long.txt'),
			Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n')
		);
		expect(await call('read_file', { path: 'long.txt', offset: 3, limit: 2 })).toBe(
			'line 3\nline 4\n… lines 3–4 of 10'
		);
	});

	test('writes files, creating directories', async () => {
		await call('write_file', { path: 'src/new/file.ts', content: 'export {};\n' });
		expect(await readFile(join(root, 'src/new/file.ts'), 'utf8')).toBe('export {};\n');
	});

	test('edits a unique match and refuses ambiguous ones', async () => {
		await call('edit_file', { path: 'greeting.ts', old_string: "'hello'", new_string: "'hi'" });
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe(
			"export const greeting = 'hi';\n"
		);

		await writeFile(join(root, 'twice.ts'), 'a a');
		await expect(
			call('edit_file', { path: 'twice.ts', old_string: 'a', new_string: 'b' })
		).rejects.toThrow('matches 2 places');
		await call('edit_file', {
			path: 'twice.ts',
			old_string: 'a',
			new_string: '$&',
			replace_all: true
		});
		expect(await readFile(join(root, 'twice.ts'), 'utf8')).toBe('$& $&');
	});

	test('finds files and searches contents, respecting .gitignore', async () => {
		await writeFile(join(root, '.gitignore'), 'dist\n');
		await call('write_file', {
			path: 'dist/out.ts',
			content: "export const greeting = 'built';\n"
		});
		await call('write_file', {
			path: 'src/other.ts',
			content: 'import { greeting } from "../greeting";\n'
		});

		expect(await call('find_files', { pattern: '**/*.ts' })).toBe('greeting.ts\nsrc/other.ts');
		expect(await call('find_files', { pattern: '*' })).not.toContain('.git/');
		expect(await call('search', { pattern: 'main', glob: '*' })).not.toContain('.git/');
		expect(await call('search', { pattern: 'greeting', glob: 'src/**' })).toBe(
			'src/other.ts:1:import { greeting } from "../greeting";'
		);
		expect(await call('search', { pattern: 'nothing-matches-this' })).toBe('No matches');
	});

	test('runs commands with their exit code and combined output', async () => {
		expect(await call('run', { command: 'echo out; echo err >&2; exit 3' })).toBe(
			'exit code 3\nout\nerr'
		);
		expect(await call('run', { command: 'sleep 5', timeout_seconds: 1 })).toBe(
			'timed out after 1s'
		);
	});

	test('keeps paths inside the repository', async () => {
		await expect(call('read_file', { path: '../remote.git/HEAD' })).rejects.toThrow(
			'outside the repository'
		);
		await expect(call('write_file', { path: '/etc/evil', content: '' })).rejects.toThrow(
			'outside the repository'
		);
	});

	test('reports missing files and bad arguments as tool errors', async () => {
		await expect(call('read_file', { path: 'missing.ts' })).rejects.toThrow(
			'Could not read missing.ts'
		);
		await expect(tools.execute({ id: 'call', name: 'run', arguments: '{oops' })).rejects.toThrow(
			'not valid JSON'
		);
	});
});

describe('workspace', () => {
	test('clones a remote into an empty workspace', async () => {
		const empty = join(dir, 'fresh');
		await git(dir, ['init', empty]);
		await rm(join(empty, '.git'), { recursive: true });
		sandbox = createSandbox(empty);

		await workspace.clone({ remote, token: 'token', branch: 'main' });
		expect(await readFile(join(empty, 'greeting.ts'), 'utf8')).toContain('hello');
	});

	test('creates the requested branch when the remote lacks it', async () => {
		const empty = join(dir, 'fresh');
		await git(dir, ['init', empty]);
		await rm(join(empty, '.git'), { recursive: true });
		sandbox = createSandbox(empty);

		await workspace.clone({ remote, branch: 'trunk' });
		expect(await git(empty, ['branch', '--show-current'])).toBe('trunk');
		expect(await readFile(join(empty, 'greeting.ts'), 'utf8')).toContain('hello');
	});

	test('replaces a clone of a different remote, as left by a restored snapshot', async () => {
		const other = join(dir, 'other.git');
		await git(dir, ['init', '--bare', '--initial-branch', 'main', other]);
		await git(root, ['push', other, 'main']);
		await git(root, ['remote', 'set-url', 'origin', other]);
		await call('write_file', { path: 'stale.ts', content: 'export {};\n' });

		await workspace.clone({ remote, token: 'token', branch: 'main' });
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(remote);
		await expect(readFile(join(root, 'stale.ts'), 'utf8')).rejects.toThrow();
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
		sandbox = createSandbox(root, { mise });

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
		sandbox = createSandbox(root, { mise });

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

		await workspace.clone({ remote, token: 'token', branch: 'main' });
		expect(await readFile(join(root, 'checkpoint.ts'), 'utf8')).toBe('export {};\n');
		await expect(readFile(join(root, 'draft.ts'), 'utf8')).rejects.toThrow();
	});

	test('commits checkpoints only when something changed, then pushes', async () => {
		expect(await workspace.commit({ message: 'nothing', author })).toBeNull();

		await call('edit_file', { path: 'greeting.ts', old_string: 'hello', new_string: 'hi' });
		const sha = await workspace.commit({ message: 'Say hi', author });
		expect(sha).toMatch(/^[0-9a-f]{40}$/);

		await workspace.push({ token: 'token', ref: 'thread/say-hi' });
		expect(await git(remote, ['rev-parse', 'thread/say-hi'])).toBe(sha);
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
		await workspace.push({ token: 'token', ref: 'thread/say-hey' });
		expect(await git(remote, ['rev-parse', 'thread/say-hey'])).toBe(sha);
	});
});

describe('shipping', () => {
	const sam = { name: 'Sam Rivera', email: 'sam@example.com' };
	let base: string;

	async function checkpoint(content: string, message: string) {
		await call('write_file', { path: 'greeting.ts', content });
		return workspace.commit({ message, author });
	}

	async function landOnMain(content: string) {
		const elsewhere = join(dir, 'elsewhere');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'greeting.ts'), content);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-am',
			'Main moved'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
	}

	beforeEach(async () => {
		base = await git(root, ['rev-parse', 'HEAD']);
	});

	test("finds the branch a remote's HEAD points to", async () => {
		expect(await workspace.headBranch({ remote })).toBe('main');
		await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
		await git(root, ['push', 'origin', 'main:trunk']);
		expect(await workspace.headBranch({ remote })).toBe('trunk');
	});

	test('diffs the work against the commit it started from', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await call('write_file', { path: 'farewell.ts', content: "export const bye = 'bye';\n" });
		await workspace.commit({ message: 'Say bye', author });

		const diff = await workspace.diff({ base });
		expect(diff).toContain("-export const greeting = 'hello';\n+export const greeting = 'hi';");
		expect(diff).toContain('new file mode');
	});

	test('squashes checkpoints into one commit by the person shipping', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Checkpoint 1');
		await checkpoint("export const greeting = 'hey';\n", 'Checkpoint 2');

		const sha = await workspace.squash({
			base,
			message: 'feat: say hey',
			author: sam,
			committer: author
		});
		expect(await git(root, ['rev-list', '--count', `${base}..HEAD`])).toBe('1');
		expect(await git(root, ['log', '-1', '--format=%an|%cn|%s', sha!])).toBe(
			'Sam Rivera|ReGit|feat: say hey'
		);
		expect(
			await workspace.squash({ base: sha!, message: 'empty', author: sam, committer: author })
		).toBeNull();
	});

	test('rebases onto the latest main and pushes there', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await call('write_file', { path: 'farewell.ts', content: "export const bye = 'bye';\n" });
		await workspace.commit({ message: 'Say bye', author });
		await workspace.squash({ base, message: 'feat: greet', author: sam, committer: author });
		const elsewhere = join(dir, 'elsewhere');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'other.ts'), 'export {};\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-m',
			'Other'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);

		const rebased = await workspace.rebase({ remote, branch: 'main', committer: author });
		expect(rebased).toMatchObject({
			conflicts: [],
			onto: await git(remote, ['rev-parse', 'main'])
		});
		const sha = await workspace.push({ remote, ref: 'main' });
		expect(sha).toBe(rebased.sha);
		expect(await git(remote, ['log', '--format=%s', 'main'])).toBe('feat: greet\nOther\ninit');
	});

	test('stops on conflicts, refuses leftover markers, then continues once resolved', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await workspace.squash({ base, message: 'feat: say hi', author: sam, committer: author });
		await landOnMain("export const greeting = 'hey';\n");

		const rebased = await workspace.rebase({ remote, branch: 'main', committer: author });
		expect(rebased).toMatchObject({ sha: null, conflicts: ['greeting.ts'] });
		expect(await workspace.continueRebase({ committer: author })).toEqual({
			sha: null,
			conflicts: ['greeting.ts']
		});

		await call('write_file', {
			path: 'greeting.ts',
			content: "export const greeting = 'hi, hey';\n"
		});
		const continued = await workspace.continueRebase({ committer: author });
		expect(continued.conflicts).toEqual([]);
		expect(await git(root, ['log', '--format=%s', '-2'])).toBe('feat: say hi\nMain moved');
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe(
			"export const greeting = 'hi, hey';\n"
		);
	});

	test('aborts a rebase and force pushes the rewritten branch', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await workspace.push({ ref: 'thread/hi' });
		const squashed = await workspace.squash({
			base,
			message: 'feat: say hi',
			author: sam,
			committer: author
		});
		await landOnMain("export const greeting = 'hey';\n");
		await workspace.rebase({ remote, branch: 'main', committer: author });

		await workspace.abortRebase();
		expect(await git(root, ['rev-parse', 'HEAD'])).toBe(squashed);
		await expect(workspace.push({ ref: 'thread/hi' })).rejects.toThrow();
		expect(await workspace.push({ ref: 'thread/hi', force: true })).toBe(squashed);
	});
});

test('serves a health check', async () => {
	const response = await sandbox(new Request('http://sandbox/health'));
	expect(await response.text()).toBe('ok');
});

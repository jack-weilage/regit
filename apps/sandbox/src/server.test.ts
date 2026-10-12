import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('runs optional lifecycle scripts from the root without an executable bit and reports failures', async () => {
	expect(await workspace.hook('setup')).toEqual({ ran: false, output: '' });
	await call('write_file', {
		path: '.agents/setup',
		content: 'printf "prepared" > .git/setup-result\necho setup-out\necho setup-err >&2\n'
	});
	await call('write_file', {
		path: '.agents/resume',
		content: 'test "$(cat .git/setup-result)" = prepared\necho resumed\n'
	});
	expect(await workspace.hook('setup')).toEqual({ ran: true, output: 'setup-out\nsetup-err' });
	expect(await workspace.hook('resume')).toEqual({ ran: true, output: 'resumed' });
	await call('write_file', {
		path: '.agents/setup',
		content: 'echo dependency-unavailable >&2\nfalse\necho should-not-run\n'
	});
	await expect(workspace.hook('setup')).rejects.toThrow(
		'.agents/setup failed (exit code 1)\ndependency-unavailable'
	);
	const invalid = await fetch('http://sandbox/workspace/hook', {
		method: 'POST',
		body: JSON.stringify({ name: '../greeting.ts' })
	});
	expect(invalid.ok).toBe(false);
	expect(await invalid.json()).toEqual({ error: 'Unknown lifecycle hook' });
});

describe('tools', () => {
	test('reads image pixels, rejects unsupported or oversized files and resolves path boundaries', async () => {
		const png =
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=';
		await writeFile(join(root, 'capture.png'), Buffer.from(png, 'base64'));
		expect(await call('view_image', { path: 'capture.png' })).toEqual({
			text: 'Image: capture.png',
			imageUrl: `data:image/png;base64,${png}`
		});
		await expect(call('view_image', { path: 'greeting.ts' })).rejects.toThrow(
			'Only PNG, JPEG and WebP'
		);
		await writeFile(join(root, 'large.png'), Buffer.alloc(4 * 1024 * 1024 + 1));
		await expect(call('view_image', { path: 'large.png' })).rejects.toThrow('up to 4 MiB');
		await writeFile(join(dir, 'outside.png'), Buffer.from(png, 'base64'));
		await symlink(join(dir, 'outside.png'), join(root, 'escape.png'));
		await expect(call('view_image', { path: 'escape.png' })).rejects.toThrow(
			'outside the repository'
		);
		await expect(call('view_image', { path: '../outside.png' })).rejects.toThrow(
			'outside the repository'
		);
		await expect(call('view_image', { path: 'missing.png' })).rejects.toThrow(
			'Could not read image'
		);
	});

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

		await workspace.clone({ remote, branch: 'main' });
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

		await workspace.clone({ remote, branch: 'main' });
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(remote);
		await expect(readFile(join(root, 'stale.ts'), 'utf8')).rejects.toThrow();
	});

	test('preserves prepared files across fork restores only at the same revision', async () => {
		await call('write_file', { path: '.gitignore', content: '.cache/\n' });
		await call('write_file', {
			path: '.agents/setup',
			content: 'mkdir -p .cache\necho prepared > .cache/ready\n'
		});
		await workspace.commit({ message: 'Add setup', author });
		const fork = join(dir, 'fork.git');
		await git(dir, ['clone', '--bare', root, fork]);
		await workspace.hook('setup');
		expect(await workspace.clone({ remote: fork, branch: 'work', preserveSetup: true })).toEqual({
			preserved: true
		});
		expect(await readFile(join(root, '.cache/ready'), 'utf8')).toBe('prepared\n');
		expect(await git(root, ['remote', 'get-url', 'origin'])).toBe(fork);
		expect(await git(root, ['branch', '--show-current'])).toBe('work');
		await call('write_file', { path: 'greeting.ts', content: 'changed\n' });
		await workspace.commit({ message: 'Change setup inputs', author });
		await git(root, ['push', fork, 'HEAD:main']);
		await git(root, ['reset', '--hard', 'HEAD~1']);
		expect(await workspace.clone({ remote: fork, branch: 'main', preserveSetup: true })).toEqual({
			preserved: false
		});
		await expect(readFile(join(root, '.cache/ready'), 'utf8')).rejects.toThrow();
		expect(await readFile(join(root, 'greeting.ts'), 'utf8')).toBe('changed\n');
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
		await workspace.push({ ref: 'thread/say-hey' });
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

	async function prepare(sourceSha: string) {
		return workspace.prepareCandidate({
			sourceSha,
			base,
			remote,
			branch: 'main',
			message: 'Trusted squash',
			author: sam,
			committer: author
		});
	}

	test('assembles the exact source tree, retains identities and retries a successful promotion', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'First');
		await writeFile(join(root, 'source-only.txt'), 'source\n');
		const sourceSha = (await workspace.commit({ message: 'Second', author }))!;
		await checkpoint("export const greeting = 'not selected';\n", 'Unselected');
		const elsewhere = join(dir, 'canonical');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'canonical-only.txt'), 'canonical\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-m',
			'Independent'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
		const candidate = await prepare(sourceSha);
		expect(candidate.expectedHead).toBe(await git(remote, ['rev-parse', 'main']));
		expect(await git(root, ['rev-list', '--parents', '-1', candidate.sha])).toBe(
			`${candidate.sha} ${candidate.expectedHead}`
		);
		expect(await git(root, ['show', `${candidate.sha}:greeting.ts`])).toContain("'hi'");
		expect(await git(root, ['show', `${candidate.sha}:source-only.txt`])).toBe('source');
		expect(await git(root, ['show', `${candidate.sha}:canonical-only.txt`])).toBe('canonical');
		expect(await git(root, ['log', '-1', '--format=%an|%ae|%cn|%ce', candidate.sha])).toBe(
			'Sam Rivera|sam@example.com|ReGit|agent@regit.dev'
		);
		const request = { ...candidate, remote, branch: 'main' };
		expect(await workspace.promoteCandidate(request)).toEqual({ sha: candidate.sha });
		expect(await workspace.promoteCandidate(request)).toEqual({ sha: candidate.sha });
		expect(await git(remote, ['rev-list', '--count', `${base}..main`])).toBe('2');
	});

	test('refuses a stale candidate without regenerating it', async () => {
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		const candidate = await prepare(sourceSha);
		await landOnMain("export const greeting = 'canonical';\n");
		const head = await git(remote, ['rev-parse', 'main']);
		await expect(
			workspace.promoteCandidate({ ...candidate, remote, branch: 'main' })
		).rejects.toThrow('Stale candidate');
		expect(await git(remote, ['rev-parse', 'main'])).toBe(head);
		expect(await git(root, ['rev-parse', 'HEAD'])).toBe(candidate.sha);
	});

	test('aborts trusted conflicts and rejects empty or invalid candidates', async () => {
		await expect(prepare(base)).rejects.toThrow('no changes');
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		await landOnMain("export const greeting = 'conflict';\n");
		await expect(prepare(sourceSha)).rejects.toThrow('Candidate rebase failed');
		await expect(readFile(join(root, '.git/rebase-merge/head-name'))).rejects.toThrow();
		await expect(readFile(join(root, '.git/rebase-apply/head-name'))).rejects.toThrow();
		expect(await git(root, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
		await expect(
			workspace.promoteCandidate({
				sha: sourceSha,
				expectedHead: sourceSha,
				remote,
				branch: 'main'
			})
		).rejects.toThrow('parent');
		await expect(
			workspace.promoteCandidate({ sha: sourceSha, expectedHead: base, remote, branch: '--all' })
		).rejects.toThrow('Invalid branch');
	});

	test('explicitly synchronizes notes without losing another publisher notes', async () => {
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		const candidate = await prepare(sourceSha);
		await workspace.promoteCandidate({ ...candidate, remote, branch: 'main' });
		await workspace.publishProvenance({ sha: candidate.sha, remote, note: '{"attempt":1}' });
		const elsewhere = join(dir, 'notes-publisher');
		await git(dir, ['clone', remote, elsewhere]);
		await git(elsewhere, ['fetch', 'origin', 'refs/notes/regit:refs/notes/regit']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'notes',
			'--ref=regit',
			'add',
			'-m',
			'{"other":true}',
			base
		]);
		await git(elsewhere, ['push', 'origin', 'refs/notes/regit']);
		await workspace.publishProvenance({ sha: candidate.sha, note: '{"attempt":2}' });
		expect(await git(remote, ['notes', '--ref=regit', 'show', base])).toBe('{"other":true}');
		expect(await git(remote, ['notes', '--ref=regit', 'show', candidate.sha])).toBe(
			'{"attempt":2}'
		);
		await expect(
			workspace.publishProvenance({
				sha: candidate.sha,
				remote: join(dir, 'missing.git'),
				note: '{}'
			})
		).rejects.toThrow('Notes discovery failed');
		expect(await git(remote, ['rev-parse', 'main'])).toBe(candidate.sha);
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
});

test('serves a health check', async () => {
	const response = await sandbox(new Request('http://sandbox/health'));
	expect(await response.text()).toBe('ok');
});

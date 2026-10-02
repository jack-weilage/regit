import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
});

test('serves a health check', async () => {
	const response = await sandbox(new Request('http://sandbox/health'));
	expect(await response.text()).toBe('ok');
});

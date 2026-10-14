import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sandboxWorkspace } from '@regit/agent';
import { describe, expect, test } from 'bun:test';
import { serveSandbox } from './serve.ts';
import {
	call,
	dir,
	fetch,
	remote,
	root,
	sandbox,
	tools,
	useWorkspace,
	workspace
} from './test-workspace.ts';

useWorkspace();

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

test('streams lifecycle script output while the script runs', async () => {
	await call('write_file', {
		path: '.agents/setup',
		content: 'echo first\nwhile [ ! -f .git/release ]; do sleep 0.05; done\necho second\n'
	});
	const chunks: string[] = [];
	const finished = workspace.hook('setup', (chunk) => chunks.push(chunk));
	while (!chunks.join('').includes('first')) await Bun.sleep(20);
	expect(chunks.join('')).not.toContain('second');
	await writeFile(join(root, '.git/release'), '');
	expect(await finished).toEqual({ ran: true, output: 'first\nsecond' });
	expect(chunks.join('')).toBe('first\nsecond\n');
});

test('keeps streaming a lifecycle script that stays quiet past the idle timeout', async () => {
	await call('write_file', { path: '.agents/setup', content: 'echo start\nsleep 13\necho done\n' });
	const server = serveSandbox(root, 0);
	try {
		const served = sandboxWorkspace((url, init) =>
			globalThis.fetch(new URL(new URL(String(url)).pathname, server.url), init)
		);
		expect(await served.hook('setup')).toEqual({ ran: true, output: 'start\ndone' });
	} finally {
		await server.stop(true);
	}
}, 20_000);

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

test('serves a health check', async () => {
	const response = await sandbox(new Request('http://sandbox/health'));
	expect(await response.text()).toBe('ok');
});

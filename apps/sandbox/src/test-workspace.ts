import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxTools, sandboxWorkspace, type ToolArguments, type ToolName } from '@regit/agent';
import { afterEach, beforeEach } from 'bun:test';
import { git } from './exec.ts';
import { createSandbox } from './server.ts';

export const author = { name: 'ReGit', email: 'agent@regit.dev' };

export let dir: string;
export let root: string;
export let remote: string;
export let sandbox: ReturnType<typeof createSandbox>;

export const fetch = (url: string, init?: RequestInit) => sandbox(new Request(url, init));
export const tools = sandboxTools(fetch);
export const workspace = sandboxWorkspace(fetch);

export function call<Name extends ToolName>(name: Name, args: ToolArguments[Name]) {
	return tools.execute({ id: 'call', name, arguments: JSON.stringify(args) });
}

export function recreateSandbox(...args: Parameters<typeof createSandbox>) {
	sandbox = createSandbox(...args);
}

export function useWorkspace() {
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
}

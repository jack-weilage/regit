import { access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { CloneRequest, CommitRequest, PushRequest, Toolchain } from '@regit/agent';
import { exec, git, truncate } from './exec.ts';

function auth(token?: string) {
	if (!token) return undefined;
	return {
		GIT_CONFIG_COUNT: '1',
		GIT_CONFIG_KEY_0: 'http.extraHeader',
		GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`
	};
}

export async function clone(root: string, { remote, token, branch }: CloneRequest) {
	if (await exists(join(root, '.git'))) {
		const origin = await git(root, ['remote', 'get-url', 'origin']).catch(() => '');
		if (origin === remote) {
			await git(root, ['fetch', 'origin', branch ?? 'HEAD'], auth(token));
			await git(root, ['reset', '--hard', 'FETCH_HEAD']);
			await git(root, ['clean', '-fd']);
			return;
		}
		for (const entry of await readdir(root)) {
			await rm(join(root, entry), { recursive: true, force: true });
		}
	}
	await git(root, ['clone', remote, '.'], auth(token));
	if (!branch) return;
	const remoteBranch = await git(root, ['rev-parse', '--verify', `origin/${branch}`]).catch(
		() => null
	);
	await git(root, ['checkout', '-B', branch, ...(remoteBranch ? [`origin/${branch}`] : [])]);
}

function exists(path: string) {
	return access(path).then(
		() => true,
		() => false
	);
}

export async function commit(root: string, { message, author }: CommitRequest) {
	await git(root, ['add', '--all']);
	if (!(await git(root, ['status', '--porcelain']))) return null;
	await git(root, [
		'-c',
		`user.name=${author.name}`,
		'-c',
		`user.email=${author.email}`,
		'commit',
		'--message',
		message
	]);
	return git(root, ['rev-parse', 'HEAD']);
}

export async function push(root: string, { token, ref }: PushRequest) {
	await git(root, ['push', 'origin', `HEAD:${ref}`], auth(token));
}

export async function toolchain(root: string, mise: string): Promise<Toolchain> {
	const install = await exec(mise, ['install'], { cwd: root, timeout: 15 * 60 * 1000 });
	if (install.code !== 0)
		throw new Error(`mise install failed: ${truncate(install.output.trim(), 4000)}`);

	const list = await exec(mise, ['ls', '--current', '--json'], { cwd: root });
	if (list.code !== 0) throw new Error(`mise ls failed: ${list.output.trim()}`);
	const current = JSON.parse(list.stdout) as Record<string, { version: string }[]>;
	return Object.fromEntries(
		Object.entries(current)
			.map(([tool, versions]) => [tool, versions.map((v) => v.version).sort()] as const)
			.sort(([a], [b]) => a.localeCompare(b))
	);
}

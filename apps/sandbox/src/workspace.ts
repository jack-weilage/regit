import { access, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	CloneRequest,
	CommitRequest,
	ContinueRebaseRequest,
	DiffRequest,
	Identity,
	PushRequest,
	RebaseRequest,
	RebaseResponse,
	SquashRequest,
	Toolchain
} from '@regit/agent';
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

export async function push(root: string, { token, ref, remote = 'origin', force }: PushRequest) {
	await git(root, ['push', ...(force ? ['--force'] : []), remote, `HEAD:${ref}`], auth(token));
	return git(root, ['rev-parse', 'HEAD']);
}

function identity(prefix: 'AUTHOR' | 'COMMITTER', { name, email }: Identity) {
	return { [`GIT_${prefix}_NAME`]: name, [`GIT_${prefix}_EMAIL`]: email };
}

export async function diff(root: string, { base }: DiffRequest) {
	const result = await exec(
		'git',
		['diff', '--no-color', '--no-ext-diff', '--find-renames', base, 'HEAD'],
		{
			cwd: root
		}
	);
	if (result.code !== 0) throw new Error(`git diff failed: ${result.output.trim()}`);
	return result.stdout;
}

export async function squash(root: string, { base, message, author, committer }: SquashRequest) {
	await git(root, ['reset', '--soft', base]);
	if (!(await git(root, ['diff', '--cached', '--name-only']))) return null;
	await git(root, ['commit', '--message', message], {
		...identity('AUTHOR', author),
		...identity('COMMITTER', committer)
	});
	return git(root, ['rev-parse', 'HEAD']);
}

export async function rebase(
	root: string,
	{ remote, branch, token, committer }: RebaseRequest
): Promise<RebaseResponse> {
	await git(root, ['fetch', remote, branch], auth(token));
	const onto = await git(root, ['rev-parse', 'FETCH_HEAD']);
	const result = await exec('git', ['rebase', onto], {
		cwd: root,
		env: identity('COMMITTER', committer)
	});
	return { ...(await rebased(root, result.code, result.output)), onto };
}

export async function continueRebase(root: string, { committer }: ContinueRebaseRequest) {
	const marked = [];
	for (const file of await unmerged(root)) {
		const content = await readFile(join(root, file), 'utf8').catch(() => '');
		if (/^(<{7}|>{7})( |$)/m.test(content)) marked.push(file);
	}
	if (marked.length) return { sha: null, conflicts: marked };
	await git(root, ['add', '--all']);
	const result = await exec('git', ['-c', 'core.editor=true', 'rebase', '--continue'], {
		cwd: root,
		env: identity('COMMITTER', committer)
	});
	return rebased(root, result.code, result.output);
}

async function unmerged(root: string) {
	return (await git(root, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
}

export async function abortRebase(root: string) {
	await exec('git', ['rebase', '--abort'], { cwd: root });
}

async function rebased(root: string, code: number | null, output: string) {
	if (code === 0) return { sha: await git(root, ['rev-parse', 'HEAD']), conflicts: [] };
	const conflicts = await unmerged(root);
	if (!conflicts.length) {
		await abortRebase(root);
		throw new Error(`git rebase failed: ${output.trim()}`);
	}
	return { sha: null, conflicts };
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

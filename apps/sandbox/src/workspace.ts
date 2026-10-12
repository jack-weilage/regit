import { access, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	CloneRequest,
	CommitRequest,
	CompareRequest,
	CompareResponse,
	DiffRequest,
	HeadBranchRequest,
	HookRequest,
	HookResponse,
	Identity,
	PrepareCandidateRequest,
	PrepareCandidateResponse,
	PromoteCandidateRequest,
	PromoteCandidateResponse,
	PublishProvenanceRequest,
	PushRequest,
	SquashRequest,
	Toolchain
} from '@regit/agent';
import { exec, git, noHooks, truncate } from './exec.ts';

export async function clone(root: string, { remote, branch, preserveSetup }: CloneRequest) {
	if (await exists(join(root, '.git'))) {
		const origin = await git(root, ['remote', 'get-url', 'origin']).catch(() => '');
		if (preserveSetup) {
			const refs = branch ? await git(root, ['ls-remote', '--heads', remote, branch]) : '';
			await git(root, ['fetch', remote, refs ? branch! : 'HEAD']);
			const revision = await git(root, ['rev-parse', 'FETCH_HEAD']);
			if (revision === (await git(root, ['rev-parse', 'HEAD']))) {
				await git(root, ['remote', 'set-url', 'origin', remote]);
				if (branch) await git(root, ['checkout', '-B', branch]);
				return { preserved: true };
			}
		}
		if (origin === remote && !preserveSetup) {
			await git(root, ['fetch', 'origin', branch ?? 'HEAD']);
			await git(root, ['reset', '--hard', 'FETCH_HEAD']);
			await git(root, ['clean', '-fd']);
			return { preserved: false };
		}
		for (const entry of await readdir(root)) {
			await rm(join(root, entry), { recursive: true, force: true });
		}
	}
	await git(root, ['clone', remote, '.']);
	if (!branch) return { preserved: false };
	const remoteBranch = await git(root, ['rev-parse', '--verify', `origin/${branch}`]).catch(
		() => null
	);
	await git(root, ['checkout', '-B', branch, ...(remoteBranch ? [`origin/${branch}`] : [])]);
	return { preserved: false };
}

function exists(path: string) {
	return access(path).then(
		() => true,
		() => false
	);
}

export async function commit(root: string, { message, author }: CommitRequest) {
	const merging =
		(await exec('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: root })).code === 0;
	if (merging) {
		const unmerged = (await git(root, ['diff', '--name-only', '--diff-filter=U']))
			.split('\n')
			.filter(Boolean);
		for (const file of unmerged) {
			const content = await readFile(join(root, file), 'utf8').catch(() => '');
			if (/^(<{7}|>{7})( |$)/m.test(content)) return null;
		}
	}
	await git(root, ['add', '--all']);
	if (!merging && !(await git(root, ['status', '--porcelain']))) return null;
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

export async function push(root: string, { ref, remote = 'origin', force }: PushRequest) {
	await git(root, ['push', ...(force ? ['--force'] : []), remote, `HEAD:${ref}`]);
	return git(root, ['rev-parse', 'HEAD']);
}

function identity(prefix: 'AUTHOR' | 'COMMITTER', { name, email }: Identity) {
	return { [`GIT_${prefix}_NAME`]: name, [`GIT_${prefix}_EMAIL`]: email };
}

function exactSha(sha: string) {
	if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error('Expected an exact commit SHA');
}

function safeRemote(remote: string) {
	if (!remote || remote.startsWith('-') || /[\s\x00]/.test(remote))
		throw new Error('Invalid remote');
}

async function branchRef(root: string, branch: string) {
	if (!branch || branch.startsWith('-') || branch.startsWith('refs/'))
		throw new Error('Invalid branch');
	const ref = `refs/heads/${branch}`;
	await git(root, ['check-ref-format', ref]);
	return ref;
}

async function canonicalHead(root: string, remote: string, ref: string) {
	await git(root, ['fetch', '--no-tags', remote, ref]);
	return git(root, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']);
}

export async function prepareCandidate(
	root: string,
	{ sourceSha, base, remote, branch, message, author, committer }: PrepareCandidateRequest
): Promise<PrepareCandidateResponse> {
	exactSha(sourceSha);
	exactSha(base);
	safeRemote(remote);
	const ref = await branchRef(root, branch);
	await git(root, ['reset', '--hard', sourceSha]);
	await git(root, ['clean', '-fd']);
	await git(root, ['merge-base', '--is-ancestor', base, sourceSha]);
	const sha = await squash(root, { base, message, author, committer });
	if (!sha) throw new Error('Candidate has no changes');
	const expectedHead = await canonicalHead(root, remote, ref);
	const result = await exec(
		'git',
		[...noHooks, 'rebase', '--empty=stop', '--onto', expectedHead, base],
		{
			cwd: root,
			env: identity('COMMITTER', committer)
		}
	);
	if (result.code !== 0) {
		await abortRebase(root);
		throw new Error(`Candidate rebase failed: ${result.output.trim()}`);
	}
	const candidate = await git(root, ['rev-parse', 'HEAD']);
	if (
		(await git(root, ['rev-list', '--parents', '-1', candidate])) !== `${candidate} ${expectedHead}`
	)
		throw new Error('Candidate must contain exactly one commit');
	return { sha: candidate, expectedHead };
}

export async function promoteCandidate(
	root: string,
	{ sha, expectedHead, remote, branch }: PromoteCandidateRequest
): Promise<PromoteCandidateResponse> {
	exactSha(sha);
	exactSha(expectedHead);
	safeRemote(remote);
	const ref = await branchRef(root, branch);
	if ((await git(root, ['rev-list', '--parents', '-1', sha])) !== `${sha} ${expectedHead}`)
		throw new Error('Candidate parent does not match expected head');
	const head = await canonicalHead(root, remote, ref);
	if (head === sha) return { sha };
	if (head !== expectedHead) throw new Error('Stale candidate: canonical head changed');
	await git(root, ['push', `--force-with-lease=${ref}:${expectedHead}`, remote, `${sha}:${ref}`]);
	return { sha };
}

export async function publishProvenance(
	root: string,
	{ sha, ref = 'refs/notes/regit', note, remote = 'origin' }: PublishProvenanceRequest
): Promise<void> {
	exactSha(sha);
	safeRemote(remote);
	if (ref !== 'refs/notes/regit') throw new Error('Invalid provenance notes ref');
	JSON.parse(note);
	await git(root, ['rev-parse', '--verify', `${sha}^{commit}`]);
	const advertised = await exec('git', [...noHooks, 'ls-remote', '--exit-code', remote, ref], {
		cwd: root
	});
	if (advertised.code === 0) await git(root, ['fetch', '--no-tags', remote, `+${ref}:${ref}`]);
	else if (advertised.code === 2) await git(root, ['update-ref', '-d', ref]);
	else throw new Error(`Notes discovery failed: ${advertised.output.trim()}`);
	await git(root, [
		'-c',
		'user.name=ReGit',
		'-c',
		'user.email=agent@regit.dev',
		'notes',
		`--ref=${ref}`,
		'add',
		'-f',
		'-m',
		note,
		sha
	]);
	await git(root, ['push', remote, `${ref}:${ref}`]);
}

export async function compare(
	root: string,
	{ remote, forks }: CompareRequest
): Promise<CompareResponse> {
	safeRemote(remote);
	if (!(await exists(join(root, '.git')))) await git(root, ['init', '--quiet']);
	await git(root, ['fetch', '--no-tags', remote, 'HEAD']);
	const main = await git(root, ['rev-parse', 'FETCH_HEAD']);
	const threads: CompareResponse['threads'] = [];
	for (const fork of forks) {
		safeRemote(fork.remote);
		const fetched = await exec('git', ['fetch', '--no-tags', fork.remote, fork.branch], {
			cwd: root
		});
		if (fetched.code !== 0) continue;
		const head = await git(root, ['rev-parse', 'FETCH_HEAD']);
		const behind = Number(await git(root, ['rev-list', '--count', `${head}..${main}`]));
		if (!behind) {
			threads.push({ id: fork.id, behind, conflicts: [] });
			continue;
		}
		const merged = await exec(
			'git',
			['merge-tree', '--write-tree', '--name-only', '--no-messages', main, head],
			{ cwd: root }
		);
		if (merged.code !== 0 && merged.code !== 1)
			throw new Error(`git merge-tree failed: ${merged.output.trim()}`);
		const files = merged.code === 1 ? merged.stdout.trim().split('\n').slice(1) : [];
		threads.push({ id: fork.id, behind, conflicts: files.filter(Boolean) });
	}
	return { main, threads };
}

export async function headBranch(root: string, { remote }: HeadBranchRequest) {
	const refs = await git(root, ['ls-remote', '--symref', remote, 'HEAD']);
	return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(refs)?.[1] ?? null;
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

async function squash(root: string, { base, message, author, committer }: SquashRequest) {
	await git(root, ['reset', '--soft', base]);
	if (!(await git(root, ['diff', '--cached', '--name-only']))) return null;
	await git(root, ['commit', '--message', message], {
		...identity('AUTHOR', author),
		...identity('COMMITTER', committer)
	});
	return git(root, ['rev-parse', 'HEAD']);
}

async function abortRebase(root: string) {
	await exec('git', [...noHooks, 'rebase', '--abort'], { cwd: root });
}

export async function hook(root: string, { name }: HookRequest): Promise<HookResponse> {
	if (name !== 'setup' && name !== 'resume') throw new Error('Unknown lifecycle hook');
	const path = `.agents/${name}`;
	try {
		if (!(await stat(join(root, path))).isFile()) throw new Error(`${path} must be a file`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ran: false, output: '' };
		throw error;
	}
	const result = await exec('bash', ['-e', path], { cwd: root, timeout: 15 * 60 * 1000 });
	const output = truncate(result.output.trim());
	if (result.timedOut || result.code !== 0) {
		throw new Error(
			`${path} ${result.timedOut ? 'timed out after 15 minutes' : `failed (exit code ${result.code})`}\n${output}`
		);
	}
	return { ran: true, output };
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

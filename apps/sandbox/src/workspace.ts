import { access, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	ClashesRequest,
	ClashesResponse,
	CloneRequest,
	CloneResponse,
	CommitRequest,
	CompareRequest,
	CompareResponse,
	BuildRevertRequest,
	BuildShipRequest,
	BuildShipResponse,
	PushShipRequest,
	PushShipResponse,
	DiffRequest,
	HeadBranchRequest,
	HookRequest,
	HookResponse,
	Identity,
	PublishProvenanceRequest,
	PushRequest,
	SquashRequest,
	Toolchain
} from '@regit/agent';
import { exec, git, noHooks, truncate } from './exec.ts';

export async function clone(
	root: string,
	{ remote, branch }: CloneRequest
): Promise<CloneResponse> {
	if (await exists(join(root, '.git'))) {
		const before = await git(root, ['rev-parse', 'HEAD']).catch(() => null);
		const reused = await retarget(root, remote, branch).then(
			() => true,
			() => false
		);
		if (reused) {
			const preserved = before === (await git(root, ['rev-parse', 'HEAD']));
			return { preserved, setup: await setupScript(root) };
		}
		for (const entry of await readdir(root)) {
			await rm(join(root, entry), { recursive: true, force: true });
		}
	}
	await git(root, ['clone', remote, '.']);
	if (branch) {
		const start = await remoteBranch(root, branch);
		await git(root, ['checkout', '-B', branch, ...(start ? [start] : [])]);
	}
	return { preserved: false, setup: await setupScript(root) };
}

async function retarget(root: string, remote: string, branch?: string) {
	await git(root, ['remote', 'remove', 'origin']).catch(() => {});
	await git(root, ['remote', 'add', 'origin', remote]);
	await git(root, ['fetch', 'origin']);
	await git(root, ['remote', 'set-head', 'origin', '--auto']);
	const fallback = await git(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
	const name = branch ?? fallback.slice('origin/'.length);
	const start = await remoteBranch(root, name);
	await git(root, [
		'checkout',
		'--force',
		...(start ? [] : ['--no-track']),
		'-B',
		name,
		start ?? fallback
	]);
	const branches = await git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
	for (const other of branches.split('\n')) {
		if (other && other !== name) await git(root, ['branch', '-D', other]);
	}
	await git(root, ['clean', '-fd']);
}

function remoteBranch(root: string, branch: string) {
	return git(root, ['rev-parse', '--verify', '--quiet', `origin/${branch}`]).then(
		() => `origin/${branch}`,
		() => null
	);
}

function setupScript(root: string) {
	return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD:.agents/setup']).catch(() => null);
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

const shipTrailer = 'ReGit-Ship';

// Squashes the thread's work into one commit on main, or finds it there when a retried ship already landed.
export async function buildShip(
	root: string,
	{ id, sourceSha, base, remote, branch, message, author, committer }: BuildShipRequest
): Promise<BuildShipResponse> {
	if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('Invalid ship id');
	exactSha(sourceSha);
	exactSha(base);
	safeRemote(remote);
	const ref = await branchRef(root, branch);
	const head = await canonicalHead(root, remote, ref);
	const shipped = await git(root, [
		'log',
		'-1',
		'--format=%H',
		'--fixed-strings',
		`--grep=${shipTrailer}: ${id}`,
		head
	]);
	if (shipped) return { sha: shipped, tree: await treeOf(root, shipped), head, shipped: true };
	await git(root, ['reset', '--hard', sourceSha]);
	await git(root, ['clean', '-fd']);
	await git(root, ['merge-base', '--is-ancestor', base, sourceSha]);
	const squashed = await squash(root, {
		base,
		message: `${message}\n\n${shipTrailer}: ${id}`,
		author,
		committer
	});
	if (!squashed) throw new Error('Nothing to ship');
	const rebased = await exec('git', [...noHooks, 'rebase', '--empty=stop', '--onto', head, base], {
		cwd: root,
		env: identity('COMMITTER', committer)
	});
	if (rebased.code !== 0) {
		const conflicts = (await git(root, ['diff', '--name-only', '--diff-filter=U']))
			.split('\n')
			.filter(Boolean);
		await abortRebase(root);
		if (conflicts.length)
			throw new Error(`Ship conflicts with ${branch} in ${conflicts.join(', ')}`);
		throw new Error(`Ship rebase failed: ${rebased.output.trim()}`);
	}
	const sha = await git(root, ['rev-parse', 'HEAD']);
	if ((await git(root, ['rev-list', '--parents', '-1', sha])) !== `${sha} ${head}`)
		throw new Error('A ship must be exactly one commit');
	return { sha, tree: await treeOf(root, sha), head, shipped: false };
}

const revertTrailer = 'ReGit-Revert';

// Reverts a commit on top of the branch, or finds the revert there when a retried one already landed.
export async function buildRevert(
	root: string,
	{ sha, remote, branch, message, committer }: BuildRevertRequest
): Promise<BuildShipResponse> {
	exactSha(sha);
	safeRemote(remote);
	const ref = await branchRef(root, branch);
	const head = await canonicalHead(root, remote, ref);
	const reverted = await git(root, [
		'log',
		'-1',
		'--format=%H',
		'--fixed-strings',
		`--grep=${revertTrailer}: ${sha}`,
		head
	]);
	if (reverted) return { sha: reverted, tree: await treeOf(root, reverted), head, shipped: true };
	await git(root, ['merge-base', '--is-ancestor', sha, head]);
	await git(root, ['reset', '--hard', head]);
	await git(root, ['clean', '-fd']);
	const applied = await exec('git', [...noHooks, 'revert', '--no-commit', sha], { cwd: root });
	if (applied.code !== 0) {
		const conflicts = (await git(root, ['diff', '--name-only', '--diff-filter=U']))
			.split('\n')
			.filter(Boolean);
		await exec('git', [...noHooks, 'revert', '--abort'], { cwd: root });
		await git(root, ['reset', '--hard', head]);
		if (conflicts.length)
			throw new Error(`Reverting conflicts with ${branch} in ${conflicts.join(', ')}`);
		throw new Error(`Reverting failed: ${applied.output.trim()}`);
	}
	if (!(await git(root, ['diff', '--cached', '--name-only']))) throw new Error('Nothing to revert');
	await git(root, ['commit', '--message', `${message}\n\n${revertTrailer}: ${sha}`], {
		...identity('AUTHOR', committer),
		...identity('COMMITTER', committer)
	});
	const commit = await git(root, ['rev-parse', 'HEAD']);
	return { sha: commit, tree: await treeOf(root, commit), head, shipped: false };
}

// Pushes a built ship only if main is still where it was built; reports when main moved instead.
export async function pushShip(
	root: string,
	{ sha, head, remote, branch }: PushShipRequest
): Promise<PushShipResponse> {
	exactSha(sha);
	exactSha(head);
	safeRemote(remote);
	const ref = await branchRef(root, branch);
	if ((await git(root, ['rev-list', '--parents', '-1', sha])) !== `${sha} ${head}`)
		throw new Error('The ship was not built on that head');
	const pushed = await exec(
		'git',
		[...noHooks, 'push', `--force-with-lease=${ref}:${head}`, remote, `${sha}:${ref}`],
		{ cwd: root }
	);
	if (pushed.code === 0) return { pushed: true };
	if ((await canonicalHead(root, remote, ref)) !== head) return { pushed: false };
	throw new Error(`Pushing to ${branch} failed: ${pushed.output.trim()}`);
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
	const headline = await git(root, ['log', '-1', '--format=%s', main]);
	const branch = (await headBranch(root, { remote })) ?? 'HEAD';
	const threads: CompareResponse['threads'] = [];
	for (const fork of forks) {
		safeRemote(fork.remote);
		const head = await forkHead(root, fork);
		if (!head) continue;
		const behind = Number(await git(root, ['rev-list', '--count', `${head}..${main}`]));
		if (!behind) {
			threads.push({ id: fork.id, behind, conflicts: [] });
			continue;
		}
		threads.push({ id: fork.id, behind, conflicts: await conflicts(root, main, head) });
	}
	return { main, branch, headline, threads };
}

// Files that would conflict if each of the other forks merged into this one.
export async function clashes(
	root: string,
	{ fork, others }: ClashesRequest
): Promise<ClashesResponse> {
	if (!(await exists(join(root, '.git')))) await git(root, ['init', '--quiet']);
	safeRemote(fork.remote);
	const head = await forkHead(root, fork);
	if (!head) return { clashes: [] };
	const found: ClashesResponse['clashes'] = [];
	for (const other of others) {
		safeRemote(other.remote);
		const theirs = await forkHead(root, other);
		const files = theirs ? await conflicts(root, head, theirs) : [];
		if (files.length) found.push({ id: other.id, files });
	}
	return { clashes: found };
}

async function conflicts(root: string, ours: string, theirs: string) {
	const merged = await exec(
		'git',
		['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs],
		{ cwd: root }
	);
	if (merged.code !== 0 && merged.code !== 1)
		throw new Error(`git merge-tree failed: ${merged.output.trim()}`);
	return merged.code === 1 ? merged.stdout.trim().split('\n').slice(1).filter(Boolean) : [];
}

async function forkHead(root: string, { remote, branch, published }: CompareRequest['forks'][0]) {
	if (published) {
		const known = await exec('git', ['cat-file', '-e', `${published}^{commit}`], { cwd: root });
		if (known.code === 0) return published;
	}
	const fetched = await exec('git', ['fetch', '--no-tags', remote, branch], { cwd: root });
	return fetched.code === 0 ? await git(root, ['rev-parse', 'FETCH_HEAD']) : null;
}

export async function headBranch(root: string, { remote }: HeadBranchRequest) {
	const refs = await git(root, ['ls-remote', '--symref', remote, 'HEAD']);
	return /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(refs)?.[1] ?? null;
}

const treeOf = (root: string, sha: string) => git(root, ['rev-parse', `${sha}^{tree}`]);

export async function diff(root: string, { base, head = 'HEAD' }: DiffRequest) {
	const result = await exec(
		'git',
		['diff', '--no-color', '--no-ext-diff', '--find-renames', base, head],
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

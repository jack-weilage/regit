import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	CandidateRequest,
	CandidateResponse,
	CheckAction,
	CheckSpec,
	ChecksRequest,
	ChecksResponse,
	RunCheckRequest,
	RunCheckResponse
} from '@regit/agent';
import { exec, git, noHooks } from './exec.ts';

export const checksFile = '.agents/checks.yml';
export const checkLogs = '.git/regit-checks';

const actions: CheckAction[] = ['handoff', 'ship'];
const keys = ['name', 'run', 'ask', 'when', 'inputs', 'before', 'blocking', 'timeout'];
const defaultTimeoutSeconds = 15 * 60;
const tailLines = 40;
const tailChars = 4_000;
const candidateIdentity = {
	GIT_AUTHOR_NAME: 'ReGit',
	GIT_AUTHOR_EMAIL: 'agent@regit.dev',
	GIT_COMMITTER_NAME: 'ReGit',
	GIT_COMMITTER_EMAIL: 'agent@regit.dev'
};

// The sandbox runs on Bun; this keeps its YAML and glob APIs typed where Bun's globals aren't declared.
const bun = (
	globalThis as unknown as {
		Bun: {
			YAML: { parse(text: string): unknown };
			Glob: new (pattern: string) => { match(path: string): boolean };
		};
	}
).Bun;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseChecks(text: string): CheckSpec[] {
	let root: unknown;
	try {
		root = bun.YAML.parse(text);
	} catch (error) {
		throw new Error(`${checksFile}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (root === null || root === undefined) return [];
	if (!isRecord(root) || (root.checks !== undefined && !Array.isArray(root.checks)))
		throw new Error(`${checksFile}: expected a checks list`);
	const names = new Set<string>();
	return ((root.checks ?? []) as unknown[]).map((value, index) => {
		if (!isRecord(value)) throw new Error(`${checksFile}: check ${index + 1} must be a map`);
		const { name, run, ask, when, inputs, before, blocking, timeout } = value;
		if (typeof name !== 'string' || !name.trim())
			throw new Error(`${checksFile}: check ${index + 1} needs a name`);
		const label = `${checksFile}: ${name}`;
		if (names.has(name)) throw new Error(`${label} is defined twice`);
		names.add(name);
		const unknown = Object.keys(value).filter((key) => !keys.includes(key));
		if (unknown.length) throw new Error(`${label} has unknown keys: ${unknown.join(', ')}`);
		if ((run === undefined) === (ask === undefined))
			throw new Error(`${label} needs exactly one of run or ask`);
		if (run !== undefined && (typeof run !== 'string' || !run.trim()))
			throw new Error(`${label}: run must be a command`);
		if (ask !== undefined && (typeof ask !== 'string' || !ask.trim()))
			throw new Error(`${label}: ask must be a question`);
		if (inputs !== undefined && ask !== undefined)
			throw new Error(`${label}: inputs only apply to run checks`);
		if (timeout !== undefined && (ask !== undefined || !(Number(timeout) > 0)))
			throw new Error(`${label}: timeout must be a number of seconds on a run check`);
		if (blocking !== undefined && typeof blocking !== 'boolean')
			throw new Error(`${label}: blocking must be true or false`);
		const steps = globs(before, `${label}: before`);
		if (!steps?.length || steps.some((step) => !actions.includes(step as CheckAction)))
			throw new Error(`${label}: before must list ${actions.join(' and/or ')}`);
		return {
			name,
			...(run !== undefined && { run: (run as string).trim() }),
			...(ask !== undefined && { ask: (ask as string).trim() }),
			...(when !== undefined && { when: globs(when, `${label}: when`) }),
			...(inputs !== undefined && { inputs: globs(inputs, `${label}: inputs`) }),
			before: steps as CheckAction[],
			blocking: blocking ?? run !== undefined,
			...(timeout !== undefined && { timeoutSeconds: Number(timeout) })
		};
	});
}

function globs(value: unknown, label: string) {
	const list = typeof value === 'string' ? [value] : value;
	if (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || !item.trim()))
		throw new Error(`${label} must be a list of paths`);
	return list.map((item: string) => item.trim());
}

// A pattern matches paths by glob, and a plain directory matches everything under it.
function matcher(patterns: string[]) {
	const compiled = patterns.map((pattern) => ({
		glob: new bun.Glob(pattern),
		prefix: `${pattern.replace(/\/+$/, '')}/`
	}));
	return (path: string) =>
		compiled.some(({ glob, prefix }) => glob.match(path) || path.startsWith(prefix));
}

const lines = (text: string) => text.split('\n').filter(Boolean);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function commitRef(ref: string) {
	if (!/^(?:HEAD|[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref))
		throw new Error('Expected HEAD or an exact commit SHA');
	return ref;
}

// Reads the checks at a commit and works out which apply to its changes since base and what each one's result depends on.
export async function checks(
	root: string,
	{ base, commit }: ChecksRequest
): Promise<ChecksResponse> {
	commitRef(base);
	commitRef(commit);
	const file = `${commit}:${checksFile}`;
	if ((await exec('git', ['cat-file', '-e', file], { cwd: root })).code !== 0)
		return { checks: [] };
	let specs: CheckSpec[];
	try {
		specs = parseChecks(await git(root, ['show', file]));
	} catch (error) {
		return { checks: [], error: error instanceof Error ? error.message : String(error) };
	}
	const changed = lines(await git(root, ['diff', '--name-only', '--no-renames', base, commit]));
	const files = lines((await exec('git', ['ls-tree', '-r', commit], { cwd: root })).stdout);
	const tree = await git(root, ['rev-parse', `${commit}^{tree}`]);
	const diff = sha256((await exec('git', ['diff', base, commit], { cwd: root })).stdout);
	const checks = specs.map((spec) => {
		const touches = spec.when ? matcher(spec.when) : () => true;
		const inputs = spec.inputs && matcher(spec.inputs);
		const inputsHash = spec.ask
			? diff
			: inputs
				? sha256(files.filter((line) => inputs(line.slice(line.indexOf('\t') + 1))).join('\n'))
				: tree;
		return { ...spec, applies: changed.some(touches), inputsHash };
	});
	return { checks };
}

// The end of a check's output, where failures usually are; the whole output goes to its log.
function tail(output: string) {
	const lines = output.trimEnd().split('\n');
	const end = lines.slice(-tailLines).join('\n');
	const text = end.length > tailChars ? end.slice(-tailChars) : end;
	return text.length < output.trimEnd().length ? `… (end of the log)\n${text}` : text;
}

// Runs a check command in the workspace, at another commit when given, and puts the workspace back afterwards.
// The full output is written to a log under .git, which checkpoints don't commit.
export async function runCheck(
	root: string,
	{ name, command, commit, timeoutSeconds = defaultTimeoutSeconds }: RunCheckRequest
): Promise<RunCheckResponse> {
	const log = `${checkLogs}/${name.replace(/[^\w.-]+/g, '-')}.log`;
	const run = async () => {
		const { code, output, timedOut } = await exec('bash', ['-lc', command], {
			cwd: root,
			timeout: timeoutSeconds * 1000
		});
		const status = timedOut ? `timed out after ${timeoutSeconds}s` : `exit code ${code}`;
		await mkdir(join(root, checkLogs), { recursive: true });
		await writeFile(join(root, log), `$ ${command}\n${output}\n${status}\n`);
		return {
			ok: code === 0 && !timedOut,
			output: `${status}\n${tail(output)}`.trimEnd(),
			log
		};
	};
	if (!commit || commit === 'HEAD') return run();
	commitRef(commit);
	if (await git(root, ['status', '--porcelain', '--untracked-files=no']))
		throw new Error('The workspace has uncommitted changes, so it cannot check another commit');
	const branch = await exec('git', ['symbolic-ref', '-q', '--short', 'HEAD'], { cwd: root });
	const previous = branch.stdout.trim() || (await git(root, ['rev-parse', 'HEAD']));
	await git(root, ['checkout', '--quiet', '--detach', commit]);
	try {
		return await run();
	} finally {
		await exec('git', [...noHooks, 'reset', '--quiet', '--hard'], { cwd: root });
		await git(root, ['checkout', '--quiet', previous]);
	}
}

// Builds the commit a ship would push: the thread's changes since base applied on top of onto.
export async function candidate(
	root: string,
	{ base, onto, source }: CandidateRequest
): Promise<CandidateResponse> {
	for (const sha of [base, onto, source])
		if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) throw new Error('Expected exact commit SHAs');
	const merged = await exec(
		'git',
		[
			'merge-tree',
			'--write-tree',
			'--name-only',
			'--no-messages',
			'--merge-base',
			base,
			onto,
			source
		],
		{ cwd: root }
	);
	if (merged.code === 1)
		return { conflicts: merged.stdout.trim().split('\n').slice(1).filter(Boolean) };
	if (merged.code !== 0) throw new Error(`git merge-tree failed: ${merged.output.trim()}`);
	const tree = merged.stdout.trim().split('\n')[0]!;
	const sha = await git(
		root,
		['commit-tree', tree, '-p', onto, '-m', 'ReGit ship candidate'],
		candidateIdentity
	);
	return { sha, tree };
}

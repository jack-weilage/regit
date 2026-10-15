import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	CheckAction,
	CheckSpec,
	ChecksRequest,
	ChecksResponse,
	CommitsRequest,
	CommitsResponse,
	DeployRequest,
	DeployResponse,
	RunCheckRequest,
	RunCheckResponse
} from '@regit/agent';
import { exec, git } from './exec.ts';

export const checksFile = '.agents/checks.yml';
export const deployScript = '.agents/deploy';
export const checkLogs = '.git/regit-checks';
// Checks of another commit run in a separate worktree, so the workspace never leaves its branch.
export const checkout = '.git/regit-checkout';

const actions: CheckAction[] = ['handoff', 'deploy'];
const deployTimeoutSeconds = 30 * 60;
const keys = ['name', 'run', 'ask', 'when', 'inputs', 'before', 'blocking', 'timeout'];
const defaultTimeoutSeconds = 15 * 60;
const setupTimeoutSeconds = 15 * 60;
const tailLines = 40;
const tailChars = 4_000;

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
		if (ask !== undefined && steps.includes('deploy'))
			throw new Error(
				`${label}: ask checks judge a thread's diff, so they only run before handoff`
			);
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

// Lists entries NUL-separated (-z), so git doesn't quote paths with non-ASCII or special characters.
async function entries(root: string, args: string[]) {
	const result = await exec('git', [...args.slice(0, 1), '-z', ...args.slice(1)], { cwd: root });
	if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.output.trim()}`);
	return result.stdout.split('\0').filter(Boolean);
}

const entryPath = (entry: string) => entry.slice(entry.indexOf('\t') + 1);

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

function commitRef(ref: string) {
	if (!/^(?:HEAD|[0-9a-f]{40}|[0-9a-f]{64})$/.test(ref))
		throw new Error('Expected HEAD or an exact commit SHA');
	return ref;
}

// Reads the checks defined at the commit, works out which apply to its changes since base (a commit, or the empty
// tree for everything), and what each one's result depends on.
export async function checks(
	root: string,
	{ base, commit }: ChecksRequest
): Promise<ChecksResponse> {
	commitRef(base);
	commitRef(commit);
	const governing = await entries(root, [
		'diff',
		'--name-only',
		base,
		commit,
		'--',
		checksFile,
		deployScript
	]);
	const file = `${commit}:${checksFile}`;
	if ((await exec('git', ['cat-file', '-e', file], { cwd: root })).code !== 0)
		return { checks: [], governing };
	let specs: CheckSpec[];
	try {
		specs = parseChecks(await git(root, ['show', file]));
	} catch (error) {
		return {
			checks: [],
			error: error instanceof Error ? error.message : String(error),
			governing
		};
	}
	const changed = await entries(root, ['diff', '--name-only', '--no-renames', base, commit]);
	const files = await entries(root, ['ls-tree', '-r', commit]);
	const tree = await git(root, ['rev-parse', `${commit}^{tree}`]);
	const diff = sha256((await exec('git', ['diff', base, commit], { cwd: root })).stdout);
	const checks = specs.map((spec) => {
		const touches = spec.when ? matcher(spec.when) : () => true;
		const inputs = spec.inputs && matcher(spec.inputs);
		const inputsHash = spec.ask
			? diff
			: inputs
				? sha256(files.filter((entry) => inputs(entryPath(entry))).join('\n'))
				: tree;
		return { ...spec, applies: changed.some(touches), inputsHash };
	});
	return { checks, governing };
}

// The end of a check's output, where failures usually are; the whole output goes to its log.
function tail(output: string) {
	const lines = output.trimEnd().split('\n');
	const end = lines.slice(-tailLines).join('\n');
	const text = end.length > tailChars ? end.slice(-tailChars) : end;
	return text.length < output.trimEnd().length ? `… (end of the log)\n${text}` : text;
}

const running = new Map<string, Set<AbortController>>();
const queues = new Map<string, Promise<unknown>>();

// Checks run one at a time per workspace.
function serial<T>(root: string, run: () => Promise<T>): Promise<T> {
	const next = (queues.get(root) ?? Promise.resolve()).then(run);
	queues.set(
		root,
		next.catch(() => {})
	);
	return next;
}

export function cancelChecks(root: string) {
	for (const controller of running.get(root) ?? []) controller.abort();
}

const logPath = (name: string) => `${checkLogs}/${name.replace(/[^\w.-]+/g, '-')}.log`;

async function exists(path: string) {
	return stat(path).then(
		() => true,
		() => false
	);
}

const dependencyFile =
	/(?:^|\/)(?:package\.json|bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.(?:toml|lock)|go\.(?:mod|sum)|pyproject\.toml|poetry\.lock|uv\.lock|requirements[^/]*\.txt|Gemfile(?:\.lock)?|composer\.(?:json|lock)|mise\.toml|\.tool-versions|\.node-version|\.nvmrc|\.python-version)$|^\.agents\/setup$/;

// Moves the check worktree to the commit and, when its dependency files changed, prepares it with .agents/setup.
async function prepareCheckout(root: string, commit: string, signal: AbortSignal) {
	const dir = join(root, checkout);
	if (await exists(join(dir, '.git'))) {
		await git(dir, ['checkout', '--quiet', '--force', '--detach', commit]);
		await git(dir, ['clean', '-fdq']);
	} else {
		await git(root, ['worktree', 'prune']);
		await git(root, ['worktree', 'add', '--quiet', '--force', '--detach', checkout, commit]);
	}
	const dependencies = sha256(
		(await entries(root, ['ls-tree', '-r', commit]))
			.filter((entry) => dependencyFile.test(entryPath(entry)))
			.join('\n')
	);
	const stamp = join(root, checkLogs, 'checkout.setup');
	if ((await readFile(stamp, 'utf8').catch(() => null)) === dependencies) return { dir };
	if (await exists(join(dir, '.agents/setup'))) {
		const result = await exec('bash', ['-e', '.agents/setup'], {
			cwd: dir,
			timeout: setupTimeoutSeconds * 1000,
			signal
		});
		const log = logPath('setup');
		await writeFile(
			join(root, log),
			`$ .agents/setup\n${result.output}\nexit code ${result.code}\n`
		);
		if (result.timedOut || result.code !== 0)
			return {
				failed: {
					ok: false,
					output: `.agents/setup failed while preparing the check checkout\n${tail(result.output)}`,
					log
				}
			};
	}
	await writeFile(stamp, dependencies);
	return { dir };
}

// Runs a check command and writes its full output to a log under .git, which checkpoints don't commit.
// At HEAD it runs in the workspace and removes files it leaves behind; at another commit it runs in the check worktree.
export function runCheck(
	root: string,
	{ name, command, commit, timeoutSeconds = defaultTimeoutSeconds }: RunCheckRequest
): Promise<RunCheckResponse> {
	return serial(root, async () => {
		const controller = new AbortController();
		const active = running.get(root) ?? new Set();
		running.set(root, active.add(controller));
		try {
			await mkdir(join(root, checkLogs), { recursive: true });
			let cwd = root;
			let tidy = false;
			if (commit && commit !== 'HEAD') {
				commitRef(commit);
				const prepared = await prepareCheckout(root, commit, controller.signal);
				if (prepared.failed) return prepared.failed;
				cwd = prepared.dir;
			} else {
				tidy = !(await git(root, ['status', '--porcelain']));
			}
			const log = logPath(name);
			const { code, output, timedOut } = await exec('bash', ['-lc', command], {
				cwd,
				timeout: timeoutSeconds * 1000,
				signal: controller.signal
			});
			if (tidy) {
				await git(root, ['reset', '--quiet', '--hard']);
				await git(root, ['clean', '-fdq']);
			}
			const status = controller.signal.aborted
				? 'cancelled'
				: timedOut
					? `timed out after ${timeoutSeconds}s`
					: `exit code ${code}`;
			await writeFile(join(root, log), `$ ${command}\n${output}\n${status}\n`);
			return { ok: code === 0 && !timedOut, output: `${status}\n${tail(output)}`.trimEnd(), log };
		} finally {
			active.delete(controller);
		}
	});
}

// Runs .agents/deploy from the check worktree at the commit with the deploy secrets in its environment, keeping them
// out of its output and log.
export function deploy(
	root: string,
	{ commit, env, deployed, timeoutSeconds = deployTimeoutSeconds }: DeployRequest
): Promise<DeployResponse> {
	commitRef(commit);
	if (deployed) commitRef(deployed);
	return serial(root, async () => {
		if ((await exec('git', ['cat-file', '-e', `${commit}:${deployScript}`], { cwd: root })).code)
			return { ran: false };
		const controller = new AbortController();
		const active = running.get(root) ?? new Set();
		running.set(root, active.add(controller));
		try {
			await mkdir(join(root, checkLogs), { recursive: true });
			const prepared = await prepareCheckout(root, commit, controller.signal);
			if (prepared.failed) return { ran: true, ...prepared.failed };
			const result = await exec('bash', ['-e', deployScript], {
				cwd: prepared.dir,
				env: { ...env, REGIT_COMMIT_SHA: commit, REGIT_DEPLOYED_SHA: deployed ?? '' },
				timeout: timeoutSeconds * 1000,
				signal: controller.signal
			});
			const output = redact(result.output, Object.values(env));
			const status = result.timedOut
				? `timed out after ${timeoutSeconds}s`
				: `exit code ${result.code}`;
			const log = logPath('deploy');
			await writeFile(join(root, log), `$ ${deployScript}\n${output}\n${status}\n`);
			return {
				ran: true,
				ok: result.code === 0 && !result.timedOut,
				output: `${status}\n${tail(output)}`.trimEnd(),
				log
			};
		} finally {
			active.delete(controller);
		}
	});
}

function redact(text: string, secrets: string[]) {
	return secrets
		.filter((secret) => secret.length >= 4)
		.sort((a, b) => b.length - a.length)
		.reduce((text, secret) => text.replaceAll(secret, '[secret]'), text);
}

// The first-parent commits after from up to and including to, oldest first.
export async function commits(
	root: string,
	{ from, to }: CommitsRequest
): Promise<CommitsResponse> {
	commitRef(to);
	if (from) commitRef(from);
	const range = from ? [`${from}..${to}`] : ['-1', to];
	const log = await git(root, ['log', '--first-parent', '--reverse', '--format=%H %s', ...range]);
	return {
		commits: lines(log).map((line) => {
			const [sha = '', ...headline] = line.split(' ');
			return { sha, headline: headline.join(' ') };
		})
	};
}

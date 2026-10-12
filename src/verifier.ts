/**
 * The Verifier turns an agent's submission into one commit on top of trunk
 * and runs tests against it, in a sandbox.
 *
 * It is a Durable Object so that each candidate gets its own sandbox. The
 * sandbox runs agent-written code and tests, so it is given a read token for
 * trunk and a write token for the agent's own fork, and nothing that can
 * write to trunk. It leaves the commit on a ref in the fork, where the
 * integrator fetches it and checks it before landing.
 *
 * Verification is two calls, `prepare` then `runTests`, because the
 * integrator decides which tests to run in between, from the prepared commit.
 */
import { DurableObject } from "cloudflare:workers";
import type { Identity } from "./git/ops";
import { ContainerSandbox, type ExecOptions, type ExecResult, HttpSandbox, type Sandbox } from "./sandbox";

export interface StepResult {
	step: string;
	exitCode: number;
	/** The tail of standard output. */
	stdout: string;
	/** The tail of standard error. */
	stderr: string;
	ms: number;
}

const OUTPUT_TAIL = 4_000;
const VERIFIER_IDENTITY: Identity = { name: "regit verifier", email: "verifier@regit.invalid" };

/** Hide repo tokens that appear in git remote URLs. */
export function redact(text: string): string {
	return text.replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, "//x:***@");
}

function tail(text: string): string {
	return redact(text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text);
}

function toStep(step: string, result: ExecResult): StepResult {
	return { step, exitCode: result.exitCode, stdout: tail(result.stdout), stderr: tail(result.stderr), ms: result.ms };
}

export interface PrepareInput {
	candidateId: string;
	/** Authenticated URL of the agent's fork, with a write token. */
	forkUrl: string;
	/** Authenticated URL of trunk, with a read token. */
	trunkUrl: string;
	branch: string;
	/** The ref in the fork the agent submitted. */
	ref: string;
	/** The commit that ref pointed at when it was submitted. */
	expectHead: string;
	/** The trunk head to build on. */
	base: string;
	message: string;
	author: Identity;
}

export interface FileStat {
	path: string;
	added: number;
	deleted: number;
	hunks: string[];
}

export type PrepareResult =
	| {
			ok: true;
			/** The single commit on top of `base` that holds the change. */
			commit: string;
			/** The ref in the fork where that commit was left. */
			ref: string;
			/** Line counts and hunk headers. Advisory: they come from the sandbox. */
			stats: FileStat[];
			bootMs: number;
			steps: StepResult[];
	  }
	| {
			ok: false;
			reason: "conflict" | "empty" | "candidate-changed" | "trunk-moved" | "ref-not-found" | "sandbox-error";
			detail: string;
			/** Files with merge conflicts, when the reason is `conflict`. */
			conflicts?: string[];
			steps: StepResult[];
	  };

export interface TestInput {
	/** The prepared commit. The sandbox must still have it checked out. */
	commit: string;
	/** Shell command that installs dependencies. Skipped when empty. */
	install?: string;
	/** Shell command that runs tests. Test files are appended as arguments. */
	command: string;
	/** Test files to run, or null for the whole suite. */
	files: string[] | null;
	timeoutSeconds?: number;
}

export interface TestResult {
	ok: boolean;
	/** Which step decided the result. */
	failedStep?: string;
	durationMs: number;
	steps: StepResult[];
}

export interface SandboxSpikeInput {
	/** Authenticated clone URL for a repository to clone. */
	cloneUrl: string;
	branch: string;
	/** Shell command that installs dependencies, run in the clone. Skipped when empty. */
	install?: string;
	/** Shell command that runs tests, run in the clone. Skipped when empty. */
	test?: string;
}

/** Parse `git diff --numstat` and the hunk headers of `git diff -U0` into per-file stats. */
export function parseDiffStats(numstat: string, unified: string): FileStat[] {
	const stats = new Map<string, FileStat>();
	for (const line of numstat.split("\n")) {
		const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
		if (!match) continue;
		stats.set(match[3], {
			path: match[3],
			added: match[1] === "-" ? 0 : Number(match[1]),
			deleted: match[2] === "-" ? 0 : Number(match[2]),
			hunks: [],
		});
	}
	let current: FileStat | undefined;
	for (const line of unified.split("\n")) {
		if (line.startsWith("+++ ") || line.startsWith("--- ")) {
			const path = line.slice(4).replace(/^[ab]\//, "");
			if (path !== "/dev/null") current = stats.get(path) ?? current;
		} else if (line.startsWith("@@") && current && current.hunks.length < 6) {
			current.hunks.push(line.slice(0, 160));
		}
	}
	return [...stats.values()];
}

export class Verifier extends DurableObject<Env> {
	private sandbox: Sandbox | undefined;
	private workdir = "/workspace";

	private getSandbox(): Sandbox {
		if (this.sandbox) return this.sandbox;
		if (this.env.REGIT_FAKE_SANDBOX_URL) {
			this.sandbox = new HttpSandbox(this.env.REGIT_FAKE_SANDBOX_URL, this.ctx.id.toString());
		} else {
			const container = this.ctx.container;
			if (!container) throw new Error("The container binding is not configured for Verifier");
			this.sandbox = new ContainerSandbox(container);
		}
		return this.sandbox;
	}

	/** Build one commit that holds the agent's change on top of the trunk head. */
	async prepare(input: PrepareInput): Promise<PrepareResult> {
		const steps: StepResult[] = [];
		const sandbox = this.getSandbox();
		const fail = (reason: Exclude<PrepareResult, { ok: true }>["reason"], detail: string, conflicts?: string[]) =>
			({ ok: false, reason, detail: redact(detail), conflicts, steps }) as const;

		try {
			const { workdir, bootMs } = await sandbox.start();
			this.workdir = workdir;
			const git = async (step: string, args: string[], options: ExecOptions = {}) => {
				const result = await sandbox.exec(["git", ...args], {
					cwd: workdir,
					timeoutSeconds: 180,
					...options,
					env: {
						GIT_TERMINAL_PROMPT: "0",
						GIT_AUTHOR_NAME: input.author.name,
						GIT_AUTHOR_EMAIL: input.author.email,
						GIT_COMMITTER_NAME: VERIFIER_IDENTITY.name,
						GIT_COMMITTER_EMAIL: VERIFIER_IDENTITY.email,
						...options.env,
					},
				});
				steps.push(toStep(step, result));
				return result;
			};

			const setup = [
				await git("init", ["init", "--quiet", "--initial-branch=regit-verify", "."]),
				await git("remote-trunk", ["remote", "add", "trunk", input.trunkUrl]),
				await git("remote-fork", ["remote", "add", "fork", input.forkUrl]),
			];
			if (setup.some((result) => result.exitCode !== 0)) {
				return fail("sandbox-error", "could not initialise a repository in the sandbox");
			}

			const fetchTrunk = await git("fetch-trunk", ["fetch", "--quiet", "--no-tags", "trunk", input.branch]);
			if (fetchTrunk.exitCode !== 0) return fail("sandbox-error", `could not fetch trunk: ${fetchTrunk.stderr}`);
			const head = (await git("trunk-head", ["rev-parse", "FETCH_HEAD"])).stdout.trim();
			if (head !== input.base) {
				return fail("trunk-moved", `trunk is at ${head}, expected ${input.base}`);
			}

			const fetchFork = await git("fetch-fork", ["fetch", "--quiet", "--no-tags", "fork", input.ref]);
			if (fetchFork.exitCode !== 0) return fail("ref-not-found", `could not fetch ${input.ref}: ${fetchFork.stderr}`);
			const submitted = (await git("fork-head", ["rev-parse", "FETCH_HEAD"])).stdout.trim();
			if (submitted !== input.expectHead) {
				return fail("candidate-changed", `${input.ref} is at ${submitted}, but ${input.expectHead} was submitted`);
			}

			const checkout = await git("checkout", ["checkout", "--quiet", "--detach", input.base]);
			if (checkout.exitCode !== 0) return fail("sandbox-error", `could not check out trunk: ${checkout.stderr}`);

			const merge = await git("squash", ["merge", "--squash", "--no-commit", submitted]);
			if (merge.exitCode !== 0) {
				const unmerged = await git("conflicts", ["diff", "--name-only", "--diff-filter=U"]);
				const conflicts = unmerged.stdout.split("\n").filter(Boolean);
				return fail(
					"conflict",
					conflicts.length > 0
						? `the change conflicts with trunk in ${conflicts.join(", ")}`
						: `the change could not be applied to trunk: ${merge.stderr || merge.stdout}`,
					conflicts,
				);
			}

			const staged = await git("staged", ["diff", "--cached", "--quiet"]);
			if (staged.exitCode === 0) return fail("empty", "the change adds nothing to trunk");

			const commit = await git("commit", ["commit", "--quiet", "--no-verify", "-m", input.message]);
			if (commit.exitCode !== 0) return fail("sandbox-error", `could not commit: ${commit.stderr}`);
			const oid = (await git("commit-id", ["rev-parse", "HEAD"])).stdout.trim();

			const numstat = await git("numstat", ["diff", "--numstat", input.base, oid]);
			const unified = await git("hunks", ["diff", "--unified=0", "--no-color", input.base, oid]);
			// The full diff is only needed for its hunk headers; do not keep it in the report.
			steps[steps.length - 1].stdout = "(diff omitted)";

			const ref = `refs/heads/regit/verified/${input.candidateId}`;
			const push = await git("push", ["push", "--quiet", "--force", "fork", `HEAD:${ref}`]);
			if (push.exitCode !== 0) return fail("sandbox-error", `could not push to the fork: ${push.stderr}`);

			return { ok: true, commit: oid, ref, stats: parseDiffStats(numstat.stdout, unified.stdout), bootMs, steps };
		} catch (error) {
			return fail("sandbox-error", error instanceof Error ? error.message : String(error));
		}
	}

	/** Run the install and test commands against the prepared commit. */
	async runTests(input: TestInput): Promise<TestResult> {
		const started = Date.now();
		const steps: StepResult[] = [];
		const sandbox = this.getSandbox();
		const timeoutSeconds = input.timeoutSeconds ?? 600;
		try {
			// A sandbox that was restarted since `prepare` no longer holds the commit.
			const { workdir } = await sandbox.start();
			this.workdir = workdir;
			const head = await sandbox.exec(["git", "rev-parse", "HEAD"], { cwd: workdir, timeoutSeconds: 30 });
			if (head.exitCode !== 0 || head.stdout.trim() !== input.commit) {
				steps.push(toStep("sandbox", { ...head, exitCode: -1, stderr: "the sandbox lost the prepared commit" }));
				return { ok: false, failedStep: "sandbox", durationMs: Date.now() - started, steps };
			}
			if (input.install) {
				const install = await sandbox.exec(["sh", "-c", input.install], { cwd: this.workdir, timeoutSeconds });
				steps.push(toStep("install", install));
				if (install.exitCode !== 0) {
					return { ok: false, failedStep: "install", durationMs: Date.now() - started, steps };
				}
			}
			// Test files are passed as arguments, never spliced into the command string.
			const test = await sandbox.exec(["sh", "-c", `${input.command} "$@"`, "regit-test", ...(input.files ?? [])], {
				cwd: this.workdir,
				timeoutSeconds,
				env: { CI: "1" },
			});
			steps.push(toStep("test", test));
			return {
				ok: test.exitCode === 0,
				failedStep: test.exitCode === 0 ? undefined : "test",
				durationMs: Date.now() - started,
				steps,
			};
		} catch (error) {
			steps.push({
				step: "sandbox",
				exitCode: -1,
				stdout: "",
				stderr: redact(error instanceof Error ? error.message : String(error)),
				ms: 0,
			});
			return { ok: false, failedStep: "sandbox", durationMs: Date.now() - started, steps };
		}
	}

	/** Throw the sandbox away. Safe to call more than once. */
	async release(): Promise<void> {
		try {
			await this.getSandbox().destroy();
		} catch {
			// Already gone.
		}
		this.sandbox = undefined;
	}

	/**
	 * Day-one spike: how long a sandbox takes to start, clone a repository,
	 * install dependencies and run tests.
	 */
	async spike(input: SandboxSpikeInput): Promise<{ steps: StepResult[]; gitPreinstalled: boolean; bootMs: number }> {
		const steps: StepResult[] = [];
		const sandbox = this.getSandbox();
		let gitPreinstalled = true;
		let bootMs = 0;
		const run = async (step: string, argv: string[], options: ExecOptions = {}) => {
			const result = await sandbox.exec(argv, options);
			steps.push(toStep(step, result));
			return result;
		};
		try {
			const boot = await sandbox.start();
			bootMs = boot.bootMs;
			const checkout = `${boot.workdir}/repo`;
			const tools = await run("tools", [
				"sh",
				"-c",
				"echo git=$(git --version 2>/dev/null || echo missing); echo node=$(node --version 2>/dev/null || echo missing); echo npm=$(npm --version 2>/dev/null || echo missing)",
			]);
			if (tools.stdout.includes("git=missing")) {
				gitPreinstalled = false;
				const install = await run(
					"install-git",
					["sh", "-c", "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates"],
					{ timeoutSeconds: 180 },
				);
				if (install.exitCode !== 0) return { steps, gitPreinstalled, bootMs };
			}

			const clone = await run(
				"clone",
				["git", "clone", "--quiet", "--depth=1", `--branch=${input.branch}`, "--", input.cloneUrl, checkout],
				{ timeoutSeconds: 120 },
			);
			if (clone.exitCode !== 0) return { steps, gitPreinstalled, bootMs };

			await run("inspect", ["sh", "-c", "git log --oneline -1 && git ls-files | wc -l && du -sh .git"], {
				cwd: checkout,
			});
			if (input.install) {
				const install = await run("install", ["sh", "-c", input.install], { cwd: checkout, timeoutSeconds: 300 });
				if (install.exitCode !== 0) return { steps, gitPreinstalled, bootMs };
			}
			if (input.test) {
				await run("test", ["sh", "-c", input.test], { cwd: checkout, timeoutSeconds: 300 });
			}
			return { steps, gitPreinstalled, bootMs };
		} finally {
			await this.release();
		}
	}
}

/**
 * The Verifier runs one candidate change in a sandbox container.
 *
 * It is a Durable Object so that each candidate gets its own container. The
 * container runs agent-written code and tests, so it is never given a token
 * that can write to trunk.
 */
import { DurableObject } from "cloudflare:workers";

export interface StepResult {
	step: string;
	exitCode: number;
	/** The tail of standard output. */
	stdout: string;
	/** The tail of standard error. */
	stderr: string;
	ms: number;
}

const SANDBOX_IMAGE = "cloudflare/debian-trixie";
/** 1 vCPU and 6 GiB: the default instance is too small to install and test a project. */
const SANDBOX_INSTANCE = "standard-2";
const OUTPUT_TAIL = 4_000;

/** Hide repo tokens that appear in git remote URLs. */
function redact(text: string): string {
	return text.replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, "//x:***@");
}

function tail(buffer: ArrayBuffer): string {
	const text = new TextDecoder().decode(buffer);
	return redact(text.length > OUTPUT_TAIL ? `…${text.slice(-OUTPUT_TAIL)}` : text);
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

export class Verifier extends DurableObject<Env> {
	private get container(): Container {
		const container = this.ctx.container;
		if (!container) throw new Error("The container binding is not configured for Verifier");
		return container;
	}

	/**
	 * Run one command in the container. `timeout` ends the command and every
	 * process it started; a command that hits the limit exits with code 124.
	 */
	private async run(
		step: string,
		argv: string[],
		options: { cwd?: string; env?: Record<string, string>; timeoutSeconds?: number } = {},
	): Promise<StepResult> {
		const started = Date.now();
		const limit = String(options.timeoutSeconds ?? 300);
		const process = await this.container.exec(["timeout", "--kill-after=5", limit, ...argv], {
			cwd: options.cwd,
			env: options.env,
		});
		const output = await process.output();
		return {
			step,
			exitCode: output.exitCode,
			stdout: tail(output.stdout),
			stderr: tail(output.stderr),
			ms: Date.now() - started,
		};
	}

	/** Start the container and wait until it accepts a command. */
	private async boot(): Promise<StepResult> {
		const started = Date.now();
		if (!this.container.running) {
			this.container.start({
				image: SANDBOX_IMAGE,
				instance: SANDBOX_INSTANCE,
				entrypoint: ["sleep", "infinity"],
				// git needs the Artifacts host and installs need the package registry.
				enableInternet: true,
			});
		}
		let lastError: unknown;
		for (let attempt = 0; attempt < 120; attempt++) {
			try {
				const result = await this.run("boot", ["uname", "-srm"], { timeoutSeconds: 20 });
				return { ...result, ms: Date.now() - started };
			} catch (error) {
				lastError = error;
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}
		throw new Error(`container did not accept commands within 30s: ${String(lastError)}`);
	}

	/**
	 * Day-one spike: how long a sandbox takes to start, clone a repository,
	 * install dependencies and run tests.
	 */
	async spike(input: SandboxSpikeInput): Promise<{ steps: StepResult[]; gitPreinstalled: boolean }> {
		const steps: StepResult[] = [];
		let gitPreinstalled = true;
		try {
			steps.push(await this.boot());
			steps.push(
				await this.run("tools", [
					"sh",
					"-c",
					"echo git=$(git --version 2>/dev/null || echo missing); echo node=$(node --version 2>/dev/null || echo missing); echo npm=$(npm --version 2>/dev/null || echo missing)",
				]),
			);
			if (steps[1].stdout.includes("git=missing")) {
				gitPreinstalled = false;
				const install = await this.run(
					"install-git",
					["sh", "-c", "apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates"],
					{ timeoutSeconds: 180 },
				);
				steps.push(install);
				if (install.exitCode !== 0) return { steps, gitPreinstalled };
			}

			const clone = await this.run(
				"clone",
				["git", "clone", "--quiet", "--depth=1", `--branch=${input.branch}`, "--", input.cloneUrl, "/workspace"],
				{ timeoutSeconds: 120 },
			);
			steps.push(clone);
			if (clone.exitCode !== 0) return { steps, gitPreinstalled };

			steps.push(
				await this.run("inspect", ["sh", "-c", "git log --oneline -1 && git ls-files | wc -l && du -sh .git"], {
					cwd: "/workspace",
				}),
			);
			if (input.install) {
				const install = await this.run("install", ["sh", "-c", input.install], {
					cwd: "/workspace",
					timeoutSeconds: 300,
				});
				steps.push(install);
				if (install.exitCode !== 0) return { steps, gitPreinstalled };
			}
			if (input.test) {
				steps.push(await this.run("test", ["sh", "-c", input.test], { cwd: "/workspace", timeoutSeconds: 300 }));
			}
			return { steps, gitPreinstalled };
		} finally {
			if (this.container.running) await this.container.destroy();
		}
	}
}

/**
 * A sandbox is somewhere to run commands that the Worker does not trust.
 *
 * In production it is a Cloudflare container owned by a Verifier Durable
 * Object. The local test suite cannot run containers, so it substitutes a
 * small command server (`test/sandbox-server.ts`) behind the same interface.
 */

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** The command and everything it started are ended after this long. Exit code 124 means it was. */
	timeoutSeconds?: number;
}

export interface ExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	ms: number;
}

export interface Sandbox {
	/** Start the sandbox if it is not running. Returns the directory to check the repository out into. */
	start(): Promise<{ workdir: string; bootMs: number }>;
	exec(argv: string[], options?: ExecOptions): Promise<ExecResult>;
	destroy(): Promise<void>;
}

const SANDBOX_IMAGE = "cloudflare/debian-trixie";
/** 1 vCPU and 6 GiB: the default instance is too small to install and test a project. */
const SANDBOX_INSTANCE = "standard-2";
/** Keep the container between the two verifier calls, and no longer. */
const INACTIVITY_MS = 3 * 60_000;
const MAX_OUTPUT = 1_000_000;

function decode(buffer: ArrayBuffer): string {
	const bytes = buffer.byteLength > MAX_OUTPUT ? buffer.slice(buffer.byteLength - MAX_OUTPUT) : buffer;
	return new TextDecoder().decode(bytes);
}

/** A sandbox backed by the container attached to a Durable Object. */
export class ContainerSandbox implements Sandbox {
	constructor(private container: Container) {}

	async start(): Promise<{ workdir: string; bootMs: number }> {
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
		// `start()` returns before the container accepts commands.
		let lastError: unknown;
		for (let attempt = 0; attempt < 120; attempt++) {
			try {
				const ready = await this.exec(["mkdir", "-p", "/workspace"], { timeoutSeconds: 20 });
				if (ready.exitCode === 0) {
					await this.container.setInactivityTimeout(INACTIVITY_MS);
					return { workdir: "/workspace", bootMs: Date.now() - started };
				}
				lastError = ready.stderr;
			} catch (error) {
				lastError = error;
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		throw new Error(`container did not accept commands within 30s: ${String(lastError)}`);
	}

	async exec(argv: string[], options: ExecOptions = {}): Promise<ExecResult> {
		const started = Date.now();
		// `timeout` ends the command and every process it started.
		const limit = String(options.timeoutSeconds ?? 300);
		const process = await this.container.exec(["timeout", "--kill-after=5", limit, ...argv], {
			cwd: options.cwd,
			env: options.env,
		});
		const output = await process.output();
		return {
			exitCode: output.exitCode,
			stdout: decode(output.stdout),
			stderr: decode(output.stderr),
			ms: Date.now() - started,
		};
	}

	async destroy(): Promise<void> {
		if (this.container.running) await this.container.destroy();
	}
}

/** The test stand-in: commands run on the machine running the test suite. */
export class HttpSandbox implements Sandbox {
	constructor(
		private origin: string,
		private id: string,
	) {}

	private async call<T>(action: string, body: Record<string, unknown>): Promise<T> {
		const response = await fetch(`${this.origin}/${action}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: this.id, ...body }),
		});
		if (!response.ok) throw new Error(`sandbox ${action} failed: ${response.status} ${await response.text()}`);
		return (await response.json()) as T;
	}

	async start(): Promise<{ workdir: string; bootMs: number }> {
		const started = Date.now();
		const { workdir } = await this.call<{ workdir: string }>("start", {});
		return { workdir, bootMs: Date.now() - started };
	}

	async exec(argv: string[], options: ExecOptions = {}): Promise<ExecResult> {
		const started = Date.now();
		const result = await this.call<Omit<ExecResult, "ms">>("exec", { argv, ...options });
		return { ...result, ms: Date.now() - started };
	}

	async destroy(): Promise<void> {
		await this.call("destroy", {});
	}
}

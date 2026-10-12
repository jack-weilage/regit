/**
 * Runs the Worker in workerd for tests, by starting `wrangler dev` with the
 * test configuration and waiting until it answers.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const TEST_ADMIN_TOKEN = "test-admin-token";

export interface TestWorker {
	origin: string;
	/** Call the Worker with the admin token. */
	fetch(path: string, init?: RequestInit): Promise<Response>;
	stop(): Promise<void>;
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

export async function startWorker(vars: Record<string, string>): Promise<TestWorker> {
	const [port, inspectorPort] = await Promise.all([freePort(), freePort()]);
	const state = mkdtempSync(join(tmpdir(), "regit-wrangler-"));
	const args = [
		join(here, "../node_modules/wrangler/bin/wrangler.js"),
		"dev",
		"--config",
		join(here, "wrangler.test.jsonc"),
		"--ip",
		"127.0.0.1",
		"--port",
		String(port),
		"--inspector-port",
		String(inspectorPort),
		"--persist-to",
		state,
		"--show-interactive-dev-session=false",
	];
	for (const [name, value] of Object.entries({ REGIT_ADMIN_TOKEN: TEST_ADMIN_TOKEN, ...vars })) {
		args.push("--var", `${name}:${value}`);
	}

	let log = "";
	const child: ChildProcess = spawn(process.execPath, args, {
		cwd: join(here, ".."),
		env: { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost", CI: "1" },
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", (chunk: Buffer) => (log += chunk.toString()));
	child.stderr?.on("data", (chunk: Buffer) => (log += chunk.toString()));

	const origin = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 60_000;
	for (;;) {
		if (child.exitCode !== null) throw new Error(`wrangler dev exited early:\n${log}`);
		try {
			const response = await fetch(origin, { signal: AbortSignal.timeout(2_000) });
			if (response.ok) break;
		} catch {
			// Not listening yet.
		}
		if (Date.now() > deadline) {
			child.kill("SIGKILL");
			throw new Error(`wrangler dev did not start within 60s:\n${log}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}

	return {
		origin,
		fetch: (path, init = {}) =>
			fetch(`${origin}${path}`, {
				...init,
				headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}`, ...(init.headers as Record<string, string>) },
			}),
		async stop() {
			const exited = new Promise((resolve) => child.once("exit", resolve));
			child.kill("SIGTERM");
			await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
			if (child.exitCode === null) child.kill("SIGKILL");
			rmSync(state, { recursive: true, force: true });
		},
	};
}

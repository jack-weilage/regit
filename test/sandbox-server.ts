/**
 * A local stand-in for the verifier's sandbox container, for tests.
 *
 * It runs the commands the Verifier sends on this machine, each sandbox in
 * its own temporary directory. `src/sandbox.ts` speaks this protocol when
 * `REGIT_FAKE_SANDBOX_URL` is set.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface SandboxServer {
	origin: string;
	/** Every command the sandboxes have been asked to run, for assertions. */
	commands: Array<{ id: string; argv: string[] }>;
	/** Sandboxes that have been started and not destroyed. */
	live(): string[];
	close(): Promise<void>;
}

export async function startSandboxServer(): Promise<SandboxServer> {
	const root = mkdtempSync(join(tmpdir(), "regit-sandbox-"));
	const sandboxes = new Map<string, string>();
	const commands: Array<{ id: string; argv: string[] }> = [];

	const dirFor = (id: string) => join(root, id.replace(/[^A-Za-z0-9_-]/g, "_"));

	function exec(body: {
		id: string;
		argv: string[];
		cwd?: string;
		env?: Record<string, string>;
		timeoutSeconds?: number;
	}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
		commands.push({ id: body.id, argv: body.argv });
		return new Promise((resolve) => {
			const child = spawn(body.argv[0], body.argv.slice(1), {
				cwd: body.cwd ?? sandboxes.get(body.id),
				env: {
					PATH: process.env.PATH,
					HOME: dirFor(body.id),
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
					NO_PROXY: "127.0.0.1,localhost",
					no_proxy: "127.0.0.1,localhost",
					...body.env,
				} as unknown as NodeJS.ProcessEnv,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdout = "";
			let stderr = "";
			let timedOut = false;
			const timer = setTimeout(
				() => {
					timedOut = true;
					child.kill("SIGKILL");
				},
				(body.timeoutSeconds ?? 300) * 1000,
			);
			child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
			child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
			child.on("error", (error) => {
				clearTimeout(timer);
				resolve({ exitCode: 127, stdout, stderr: `${stderr}${error.message}` });
			});
			child.on("close", (code) => {
				clearTimeout(timer);
				resolve({ exitCode: timedOut ? 124 : (code ?? 1), stdout, stderr });
			});
		});
	}

	const server = http.createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", async () => {
			const send = (status: number, body: unknown) => {
				response.writeHead(status, { "content-type": "application/json" });
				response.end(JSON.stringify(body));
			};
			try {
				const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
				const id = String(body.id ?? "");
				switch (request.url) {
					case "/start": {
						if (!sandboxes.has(id)) {
							const workdir = join(dirFor(id), "workspace");
							mkdirSync(workdir, { recursive: true });
							sandboxes.set(id, workdir);
						}
						return send(200, { workdir: sandboxes.get(id) });
					}
					case "/exec":
						if (!sandboxes.has(id)) return send(409, { error: "sandbox is not running" });
						return send(200, await exec(body));
					case "/destroy":
						sandboxes.delete(id);
						rmSync(dirFor(id), { recursive: true, force: true });
						return send(200, {});
					default:
						return send(404, { error: "not found" });
				}
			} catch (error) {
				send(500, { error: String(error) });
			}
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;

	return {
		origin: `http://127.0.0.1:${port}`,
		commands,
		live: () => [...sandboxes.keys()],
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(root, { recursive: true, force: true });
		},
	};
}

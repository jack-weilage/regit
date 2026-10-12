/**
 * A local stand-in for Artifacts, for tests.
 *
 * Git traffic is served by the real `git http-backend`, so any git client,
 * including isomorphic-git, can fetch and push. A small JSON control API under
 * `/_control/` covers what the Artifacts binding does (create, fork, delete,
 * tokens, reads), and `src/dev/fake-artifacts.ts` speaks it from inside the
 * Worker.
 *
 * With `auth: true` the server checks repo tokens the way Artifacts does: a
 * read token can fetch, and only a write token for that repository can push.
 */
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface GitServer {
	/** Base URL of the server, for the control API. */
	origin: string;
	/** HTTP remote URL for a repository on this server. */
	url(name: string): string;
	/** Create an empty bare repository. */
	createRepo(name: string, defaultBranch?: string): void;
	/** Copy a repository, as an Artifacts fork does. */
	forkRepo(source: string, name: string, defaultBranchOnly?: boolean): void;
	/** Mint a token for a repository. Only checked when the server was started with `auth: true`. */
	token(name: string, scope: "read" | "write"): string;
	/** Names of the repositories that currently exist. */
	repos(): string[];
	/** Run a git command against a repository on the server and return stdout. */
	git(name: string, ...args: string[]): string;
	/** A scratch directory for working clones. */
	scratch(): string;
	close(): Promise<void>;
}

const GIT_ENV = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_TERMINAL_PROMPT: "0",
	// The server is on loopback; never send these requests to a configured proxy.
	NO_PROXY: "127.0.0.1,localhost",
	no_proxy: "127.0.0.1,localhost",
	GIT_AUTHOR_NAME: "Test Agent",
	GIT_AUTHOR_EMAIL: "agent@example.com",
	GIT_COMMITTER_NAME: "Test Agent",
	GIT_COMMITTER_EMAIL: "agent@example.com",
};

/** Run git synchronously. Only for commands that do not talk to the server in this process. */
function runGitSync(cwd: string, ...args: string[]): string {
	return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Run git in a directory. Exported so tests can act as a stock git client.
 * Asynchronous because the server it talks to runs on this process's event loop.
 */
export function runGit(cwd: string, ...args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }, (error, stdout, stderr) => {
			if (error) reject(new Error(`git ${args.join(" ")} failed: ${stderr || error.message}`));
			else resolve(stdout);
		});
	});
}

const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function startGitServer(options: { auth?: boolean } = {}): Promise<GitServer> {
	const root = mkdtempSync(join(tmpdir(), "regit-git-"));
	const scratchRoot = mkdtempSync(join(tmpdir(), "regit-work-"));
	const tokens = new Map<string, { repo: string; scope: "read" | "write" }>();
	let origin = "";

	const repoDir = (name: string) => join(root, `${name}.git`);
	const remoteUrl = (name: string) => `${origin}/${name}.git`;
	const exists = (name: string) => REPO_NAME.test(name) && existsSync(repoDir(name));

	function mintToken(name: string, scope: "read" | "write"): string {
		const secret = `art_v1_${[...crypto.getRandomValues(new Uint8Array(20))].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
		tokens.set(secret, { repo: name, scope });
		return `${secret}?expires=${Math.floor(Date.now() / 1000) + 3600}`;
	}

	function createRepo(name: string, defaultBranch = "main") {
		runGitSync(root, "init", "--quiet", "--bare", `--initial-branch=${defaultBranch}`, `${name}.git`);
		runGitSync(repoDir(name), "config", "http.receivepack", "true");
	}

	function forkRepo(source: string, name: string, defaultBranchOnly = false) {
		const extra = defaultBranchOnly ? ["--single-branch"] : [];
		runGitSync(root, "clone", "--quiet", "--bare", ...extra, `${source}.git`, `${name}.git`);
		runGitSync(repoDir(name), "config", "http.receivepack", "true");
		if (!defaultBranchOnly) {
			// `clone --bare` copies branches and tags only; bring every other ref across too.
			runGitSync(repoDir(name), "fetch", "--quiet", "origin", "+refs/*:refs/*");
		}
	}

	function defaultBranch(name: string): string {
		return runGitSync(repoDir(name), "symbolic-ref", "--short", "HEAD").trim();
	}

	/** The control API: what the Artifacts binding does, as JSON over HTTP. */
	function control(action: string, body: Record<string, unknown>): { status: number; body: unknown } {
		const name = String(body.name ?? "");
		const fail = (code: string, status = 400) => ({ status, body: { error: code } });
		if (!REPO_NAME.test(name)) return fail("INVALID_REPO_NAME");
		const created = () => ({
			status: 200,
			body: {
				id: name,
				name,
				description: null,
				defaultBranch: defaultBranch(name),
				remote: remoteUrl(name),
				token: mintToken(name, "write"),
			},
		});

		switch (action) {
			case "create":
				if (exists(name)) return fail("ALREADY_EXISTS", 409);
				createRepo(name, String(body.defaultBranch ?? "main"));
				return created();
			case "fork": {
				const source = String(body.source ?? "");
				if (!exists(source)) return fail("NOT_FOUND", 404);
				if (exists(name)) return fail("ALREADY_EXISTS", 409);
				forkRepo(source, name, body.defaultBranchOnly !== false);
				return created();
			}
			case "delete": {
				const had = exists(name);
				if (had) rmSync(repoDir(name), { recursive: true, force: true });
				return { status: 200, body: { deleted: had } };
			}
			case "info":
				if (!exists(name)) return fail("NOT_FOUND", 404);
				return {
					status: 200,
					body: { id: name, name, defaultBranch: defaultBranch(name), remote: remoteUrl(name) },
				};
			case "token":
				if (!exists(name)) return fail("NOT_FOUND", 404);
				return {
					status: 200,
					body: {
						id: "token",
						plaintext: mintToken(name, body.scope === "read" ? "read" : "write"),
						scope: body.scope === "read" ? "read" : "write",
						expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
					},
				};
			case "log": {
				if (!exists(name)) return fail("NOT_FOUND", 404);
				const limit = String(Number(body.limit ?? 50));
				const format = "%H%x1f%T%x1f%P%x1f%an%x1f%ae%x1f%cn%x1f%ce%x1f%at%x1f%ct%x1f%B%x1e";
				let out = "";
				try {
					out = runGitSync(
						repoDir(name),
						"log",
						"--first-parent",
						`--max-count=${limit}`,
						`--skip=${Number(body.offset ?? 0)}`,
						`--format=${format}`,
						String(body.ref ?? "HEAD"),
						"--",
					);
				} catch {
					return { status: 200, body: { commits: [] } };
				}
				const commits = out
					.split("\x1e")
					.map((record) => record.replace(/^\n/, ""))
					.filter(Boolean)
					.map((record) => {
						const [hash, treeHash, parents, an, ae, cn, ce, at, ct, message] = record.split("\x1f");
						return {
							hash,
							treeHash,
							message: message.replace(/\n$/, ""),
							author: { name: an, email: ae },
							committer: { name: cn, email: ce },
							parents: parents ? parents.split(" ") : [],
							authoredAt: Number(at),
							committedAt: Number(ct),
						};
					});
				return { status: 200, body: { commits } };
			}
			case "file": {
				if (!exists(name)) return fail("NOT_FOUND", 404);
				try {
					const content = execFileSync("git", ["show", `${String(body.ref)}:${String(body.path)}`], {
						cwd: repoDir(name),
						env: GIT_ENV,
						stdio: ["ignore", "pipe", "ignore"],
					});
					return { status: 200, body: { base64: content.toString("base64") } };
				} catch {
					return { status: 200, body: { base64: null } };
				}
			}
			default:
				return fail("NOT_FOUND", 404);
		}
	}

	/** Decide whether a git request is allowed. Returns an HTTP status to refuse with, or null. */
	function refuseGit(request: http.IncomingMessage, url: URL): number | null {
		if (!options.auth) return null;
		const match = url.pathname.match(/^\/([^/]+)\.git\//);
		if (!match) return 404;
		const wantsWrite =
			url.pathname.endsWith("/git-receive-pack") || url.searchParams.get("service") === "git-receive-pack";
		const header = request.headers.authorization ?? "";
		let secret = "";
		if (header.startsWith("Basic ")) {
			secret = Buffer.from(header.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
		} else if (header.startsWith("Bearer ")) {
			secret = header.slice(7).split("?expires=")[0];
		}
		const token = tokens.get(secret);
		if (!token) return 401;
		if (token.repo !== match[1]) return 403;
		if (wantsWrite && token.scope !== "write") return 403;
		return null;
	}

	const server = http.createServer((request, response) => {
		const url = new URL(request.url ?? "/", "http://localhost");

		if (url.pathname.startsWith("/_control/")) {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				let result: { status: number; body: unknown };
				try {
					const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
					result = control(url.pathname.slice("/_control/".length), body);
				} catch (error) {
					result = { status: 500, body: { error: "INTERNAL_ERROR", message: String(error) } };
				}
				response.writeHead(result.status, { "content-type": "application/json" });
				response.end(JSON.stringify(result.body));
			});
			return;
		}

		const refused = refuseGit(request, url);
		if (refused !== null) {
			request.resume();
			response.writeHead(refused, refused === 401 ? { "WWW-Authenticate": 'Basic realm="regit-test"' } : {});
			response.end();
			return;
		}

		const headers = request.headers;
		const backend = spawn("git", ["http-backend"], {
			env: {
				...GIT_ENV,
				GIT_PROJECT_ROOT: root,
				GIT_HTTP_EXPORT_ALL: "1",
				REQUEST_METHOD: request.method ?? "GET",
				PATH_INFO: decodeURIComponent(url.pathname),
				QUERY_STRING: url.search.slice(1),
				CONTENT_TYPE: String(headers["content-type"] ?? ""),
				CONTENT_LENGTH: String(headers["content-length"] ?? ""),
				HTTP_CONTENT_ENCODING: String(headers["content-encoding"] ?? ""),
				GIT_PROTOCOL: String(headers["git-protocol"] ?? ""),
				REMOTE_USER: "test",
				REMOTE_ADDR: "127.0.0.1",
			},
		});
		request.pipe(backend.stdin);
		backend.stdin.on("error", () => {});

		// A CGI response is headers, a blank line, then the body.
		let pending: Buffer | null = Buffer.alloc(0);
		backend.stdout.on("data", (chunk: Buffer) => {
			if (pending === null) {
				response.write(chunk);
				return;
			}
			pending = Buffer.concat([pending, chunk]);
			const end = pending.indexOf("\r\n\r\n");
			if (end === -1) return;
			let status = 200;
			for (const line of pending.subarray(0, end).toString("latin1").split("\r\n")) {
				const colon = line.indexOf(":");
				if (colon === -1) continue;
				const name = line.slice(0, colon).trim();
				const value = line.slice(colon + 1).trim();
				if (name.toLowerCase() === "status") status = Number.parseInt(value, 10);
				else response.setHeader(name, value);
			}
			response.statusCode = status;
			response.write(pending.subarray(end + 4));
			pending = null;
		});
		backend.stdout.on("end", () => response.end());
		backend.on("error", () => {
			response.statusCode = 500;
			response.end();
		});
	});

	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	origin = `http://127.0.0.1:${port}`;
	let scratchCount = 0;

	return {
		origin,
		url: remoteUrl,
		createRepo,
		forkRepo,
		token: mintToken,
		repos: () =>
			readdirSync(root)
				.filter((entry) => entry.endsWith(".git"))
				.map((entry) => entry.slice(0, -4)),
		git: (name, ...args) => runGitSync(repoDir(name), ...args),
		scratch: () => join(scratchRoot, `work-${scratchCount++}`),
		async close() {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
			rmSync(root, { recursive: true, force: true });
			rmSync(scratchRoot, { recursive: true, force: true });
		},
	};
}

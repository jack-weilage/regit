/** Helpers around the Artifacts Workers binding. */
import type { Remote } from "./git/ops";

/** The error codes that mean "this repository exists but is not ready yet". */
const IN_PROGRESS = new Set(["FORK_IN_PROGRESS", "IMPORT_IN_PROGRESS", "CREATE_IN_PROGRESS"]);

function errorCode(error: unknown): string | undefined {
	return (error as { code?: string } | null)?.code;
}

/**
 * Run a function with a repository handle and release the handle afterwards.
 * Handles are RPC stubs and should not outlive the work that needs them.
 */
export async function withRepo<T>(
	artifacts: Artifacts,
	name: string,
	fn: (repo: ArtifactsRepo) => Promise<T>,
): Promise<T> {
	const repo = await artifacts.get(name);
	try {
		return await fn(repo);
	} finally {
		repo[Symbol.dispose]?.();
	}
}

/**
 * Wait until a forked or imported repository is ready to use.
 * @returns how long the wait took, in milliseconds.
 */
export async function waitForRepo(artifacts: Artifacts, name: string, timeoutMs = 60_000): Promise<number> {
	const started = Date.now();
	for (;;) {
		try {
			await withRepo(artifacts, name, async () => undefined);
			return Date.now() - started;
		} catch (error) {
			const code = errorCode(error);
			const retryable = (code !== undefined && IN_PROGRESS.has(code)) || code === "NOT_FOUND";
			if (!retryable || Date.now() - started > timeoutMs) throw error;
			await new Promise((resolve) => setTimeout(resolve, 150));
		}
	}
}

/** Mint a short-lived token for a repository and return it as a git remote. */
export async function remoteFor(
	artifacts: Artifacts,
	name: string,
	scope: "read" | "write",
	ttlSeconds = 900,
): Promise<Remote> {
	return withRepo(artifacts, name, async (repo) => {
		const [info, token] = await Promise.all([repo.info(), repo.createToken(scope, ttlSeconds)]);
		return { url: info.remote, token: token.plaintext };
	});
}

/** Delete repositories, ignoring ones that are already gone. */
export async function deleteRepos(artifacts: Artifacts, names: Iterable<string>): Promise<void> {
	await Promise.all([...names].map((name) => artifacts.delete(name).catch(() => false)));
}

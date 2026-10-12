/**
 * A stand-in for the Artifacts binding, for local tests only.
 *
 * `wrangler dev` has no local Artifacts simulation, so the test suite runs
 * the Worker against a local git server (`test/git-server.ts`) and this
 * object translates binding calls into that server's control API. It is used
 * only when `REGIT_FAKE_ARTIFACTS_URL` is set, which production never does.
 */

class FakeArtifactsError extends Error {
	readonly name = "ArtifactsError";
	readonly numericCode = 0;
	constructor(readonly code: string) {
		super(code);
	}
}

export function fakeArtifacts(origin: string): Artifacts {
	async function call<T>(action: string, body: Record<string, unknown>): Promise<T> {
		const response = await fetch(`${origin}/_control/${action}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = (await response.json()) as T & { error?: string };
		if (!response.ok) throw new FakeArtifactsError(data.error ?? "INTERNAL_ERROR");
		return data;
	}

	const unsupported = (method: string) => async (): Promise<never> => {
		throw new Error(`fake Artifacts does not implement ${method}()`);
	};

	function handle(name: string): ArtifactsRepo {
		return {
			info: () => call<ArtifactsRepoInfo>("info", { name }),
			createToken: (scope = "write") => call<ArtifactsCreateTokenResult>("token", { name, scope }),
			fork: (target, options) =>
				call<ArtifactsCreateRepoResult>("fork", {
					source: name,
					name: target,
					defaultBranchOnly: options?.defaultBranchOnly ?? true,
				}),
			log: async (options) =>
				(await call<{ commits: ArtifactsCommitMetadata[] }>("log", { name, ...options })).commits,
			readFile: async ({ ref, path }) => {
				const { base64 } = await call<{ base64: string | null }>("file", { name, ref, path });
				if (base64 === null) return null;
				return new Blob([Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))]);
			},
			listTokens: unsupported("listTokens"),
			revokeToken: unsupported("revokeToken"),
			readBlob: unsupported("readBlob"),
			readTree: unsupported("readTree"),
			readCommit: unsupported("readCommit"),
			[Symbol.dispose]() {},
		};
	}

	return {
		create: (name, options) =>
			call<ArtifactsCreateRepoResult>("create", { name, defaultBranch: options?.setDefaultBranch }),
		get: async (name) => {
			await call("info", { name });
			return handle(name);
		},
		delete: async (name) => (await call<{ deleted: boolean }>("delete", { name })).deleted,
		import: unsupported("import"),
		list: unsupported("list"),
	};
}

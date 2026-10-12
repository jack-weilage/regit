import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	NOTES_EVIDENCE,
	NOTES_THREADS,
	Workspace,
	commitFiles,
	fetchRef,
	land,
	listRemoteRefs,
	pushRef,
	rawRefUpdate,
	readNote,
	writeNotes,
} from "../src/git/ops";
import { type GitServer, runGit, startGitServer } from "./git-server";

let server: GitServer;
let repoCount = 0;

beforeAll(async () => {
	server = await startGitServer();
});
afterAll(async () => {
	await server.close();
});

/** A trunk with one commit, seeded the way regit seeds one: from a Worker, with no git binary. */
async function seedTrunk(): Promise<{ name: string; head: string }> {
	const name = `trunk-${repoCount++}`;
	server.createRepo(name);
	const ws = await Workspace.create();
	const head = await commitFiles(ws, {
		files: {
			"README.md": "# demo\n",
			"src/math/add.ts": "export const add = (a: number, b: number) => a + b;\n",
			"src/math/add.test.ts": "import { add } from './add';\n",
			"src/text/upper.ts": "export const upper = (s: string) => s.toUpperCase();\n",
		},
		message: "Initial commit",
		timestamp: 1_760_000_000,
	});
	const pushed = await pushRef(ws, { url: server.url(name) }, head, "refs/heads/main");
	expect(pushed).toEqual({ ok: true });
	return { name, head };
}

/**
 * Do what the verifier sandbox does, with the stock git client: put the
 * change on top of the current trunk head as one commit and leave it on a ref
 * in the fork.
 */
async function makeCandidate(
	trunk: string,
	fork: string,
	id: string,
	files: Record<string, string>,
): Promise<{ oid: string; base: string; ref: string }> {
	const work = server.scratch();
	await runGit(dirname(work), "clone", "--quiet", server.url(fork), work);
	await runGit(work, "fetch", "--quiet", server.url(trunk), "main");
	await runGit(work, "checkout", "--quiet", "-B", "regit-verify", "FETCH_HEAD");
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(work, path)), { recursive: true });
		writeFileSync(join(work, path), content);
	}
	await runGit(work, "add", "-A");
	await runGit(work, "commit", "--quiet", "-m", `Change ${id}`);
	const ref = `refs/heads/regit/verified/${id}`;
	await runGit(work, "push", "--quiet", "origin", `HEAD:${ref}`);
	return {
		oid: (await runGit(work, "rev-parse", "HEAD")).trim(),
		base: (await runGit(work, "rev-parse", "HEAD~1")).trim(),
		ref,
	};
}

describe("commitFiles and pushRef", () => {
	it("seeds a repository that stock git accepts", async () => {
		const trunk = await seedTrunk();
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(trunk.head);
		expect(server.git(trunk.name, "ls-tree", "-r", "--name-only", "main").trim().split("\n")).toEqual([
			"README.md",
			"src/math/add.test.ts",
			"src/math/add.ts",
			"src/text/upper.ts",
		]);
		// fsck exits non-zero on any corrupt or missing object.
		server.git(trunk.name, "fsck", "--strict");
	});

	it("edits, adds and deletes paths relative to a parent commit", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		const ws = await Workspace.create();
		await fetchRef(ws, remote, "refs/heads/main", { depth: 1 });
		const next = await commitFiles(ws, {
			parent: trunk.head,
			files: {
				"src/math/add.ts": "export const add = (a: number, b: number) => b + a;\n",
				"src/math/sub.ts": "export const sub = (a: number, b: number) => a - b;\n",
				"src/text/upper.ts": null,
			},
			message: "Second commit",
		});
		expect(await pushRef(ws, remote, next, "refs/heads/main")).toEqual({ ok: true });

		expect(server.git(trunk.name, "ls-tree", "-r", "--name-only", "main").trim().split("\n")).toEqual([
			"README.md",
			"src/math/add.test.ts",
			"src/math/add.ts",
			"src/math/sub.ts",
		]);
		expect(server.git(trunk.name, "show", "main:src/math/add.ts")).toContain("b + a");
		expect(server.git(trunk.name, "rev-parse", "main~1").trim()).toBe(trunk.head);
		server.git(trunk.name, "fsck", "--strict");
	});

	it("refuses a push that is not a fast-forward", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		const ws = await Workspace.create();
		await fetchRef(ws, remote, "refs/heads/main", { depth: 1 });
		const unrelated = await commitFiles(ws, { files: { "x.txt": "x\n" }, message: "Unrelated root" });
		const pushed = await pushRef(ws, remote, unrelated, "refs/heads/main");
		expect(pushed.ok).toBe(false);
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(trunk.head);
	});
});

describe("land", () => {
	it("fast-forwards trunk to a commit a stock git client left in a fork", async () => {
		const trunk = await seedTrunk();
		const fork = `${trunk.name}-agent-a`;
		server.forkRepo(trunk.name, fork);
		const candidate = await makeCandidate(trunk.name, fork, "c1", { "src/math/add.ts": "// changed by agent a\n" });
		expect(candidate.base).toBe(trunk.head);

		const ws = await Workspace.create();
		const result = await land(ws, {
			trunk: { url: server.url(trunk.name) },
			fork: { url: server.url(fork) },
			branch: "main",
			candidateRef: candidate.ref,
			expectOid: candidate.oid,
			expectBase: candidate.base,
		});

		expect(result).toEqual({ landed: true, head: candidate.oid });
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(candidate.oid);
		expect(server.git(trunk.name, "show", "main:src/math/add.ts")).toBe("// changed by agent a\n");
		expect(server.git(trunk.name, "rev-list", "--count", "main").trim()).toBe("2");
		server.git(trunk.name, "fsck", "--strict");
	});

	it("lands several candidates in sequence from one long-lived workspace", async () => {
		const trunk = await seedTrunk();
		const ws = await Workspace.create();
		const trunkRemote = { url: server.url(trunk.name) };
		let head = trunk.head;

		for (const agent of ["a", "b", "c"]) {
			const fork = `${trunk.name}-agent-${agent}`;
			server.forkRepo(trunk.name, fork);
			const candidate = await makeCandidate(trunk.name, fork, agent, {
				[`src/agents/${agent}.ts`]: `export const who = "${agent}";\n`,
			});
			expect(candidate.base).toBe(head);
			const result = await land(ws, {
				trunk: trunkRemote,
				fork: { url: server.url(fork) },
				branch: "main",
				candidateRef: candidate.ref,
				expectOid: candidate.oid,
				expectBase: candidate.base,
			});
			expect(result).toEqual({ landed: true, head: candidate.oid });
			head = candidate.oid;
		}

		expect(server.git(trunk.name, "rev-list", "--count", "main").trim()).toBe("4");
		expect(server.git(trunk.name, "ls-tree", "-r", "--name-only", "main")).toContain("src/agents/c.ts");
		server.git(trunk.name, "fsck", "--strict");
	});

	it("reports trunk-moved when trunk advanced after verification", async () => {
		const trunk = await seedTrunk();
		const forkA = `${trunk.name}-agent-a`;
		const forkB = `${trunk.name}-agent-b`;
		server.forkRepo(trunk.name, forkA);
		server.forkRepo(trunk.name, forkB);
		const first = await makeCandidate(trunk.name, forkA, "c1", { "a.txt": "a\n" });
		const second = await makeCandidate(trunk.name, forkB, "c2", { "b.txt": "b\n" });

		const ws = await Workspace.create();
		const trunkRemote = { url: server.url(trunk.name) };
		const landed = await land(ws, {
			trunk: trunkRemote,
			fork: { url: server.url(forkA) },
			branch: "main",
			candidateRef: first.ref,
			expectOid: first.oid,
			expectBase: first.base,
		});
		expect(landed.landed).toBe(true);

		const stale = await land(ws, {
			trunk: trunkRemote,
			fork: { url: server.url(forkB) },
			branch: "main",
			candidateRef: second.ref,
			expectOid: second.oid,
			expectBase: second.base,
		});
		expect(stale).toMatchObject({ landed: false, reason: "trunk-moved", head: first.oid });
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(first.oid);
	});

	it("refuses a candidate whose ref moved after it was verified", async () => {
		const trunk = await seedTrunk();
		const fork = `${trunk.name}-agent-a`;
		server.forkRepo(trunk.name, fork);
		const verified = await makeCandidate(trunk.name, fork, "c1", { "a.txt": "verified\n" });
		// The agent overwrites the verified ref with something that was never tested.
		const swapped = await makeCandidate(trunk.name, fork, "swap", { "a.txt": "not verified\n" });
		server.git(fork, "update-ref", verified.ref, swapped.oid);

		const result = await land(await Workspace.create(), {
			trunk: { url: server.url(trunk.name) },
			fork: { url: server.url(fork) },
			branch: "main",
			candidateRef: verified.ref,
			expectOid: verified.oid,
			expectBase: verified.base,
		});
		expect(result).toMatchObject({ landed: false, reason: "candidate-changed" });
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(trunk.head);
	});

	it("refuses a candidate that is more than one commit on top of trunk", async () => {
		const trunk = await seedTrunk();
		const fork = `${trunk.name}-agent-a`;
		server.forkRepo(trunk.name, fork);
		const first = await makeCandidate(trunk.name, fork, "c1", { "a.txt": "one\n" });
		// Build a second commit on top of the first, still in the fork only.
		const work = server.scratch();
		await runGit(dirname(work), "clone", "--quiet", server.url(fork), work);
		await runGit(work, "checkout", "--quiet", first.oid);
		writeFileSync(join(work, "a.txt"), "two\n");
		await runGit(work, "commit", "--quiet", "-am", "Stacked");
		const ref = "refs/heads/regit/verified/stacked";
		await runGit(work, "push", "--quiet", "origin", `HEAD:${ref}`);
		const stacked = (await runGit(work, "rev-parse", "HEAD")).trim();

		const result = await land(await Workspace.create(), {
			trunk: { url: server.url(trunk.name) },
			fork: { url: server.url(fork) },
			branch: "main",
			candidateRef: ref,
			expectOid: stacked,
			expectBase: trunk.head,
		});
		expect(result).toMatchObject({ landed: false, reason: "not-on-base" });
		expect(server.git(trunk.name, "rev-parse", "main").trim()).toBe(trunk.head);
	});

	it("reports candidate-missing when the fork has no such ref", async () => {
		const trunk = await seedTrunk();
		const fork = `${trunk.name}-agent-a`;
		server.forkRepo(trunk.name, fork);
		const result = await land(await Workspace.create(), {
			trunk: { url: server.url(trunk.name) },
			fork: { url: server.url(fork) },
			branch: "main",
			candidateRef: "refs/heads/regit/verified/nope",
			expectOid: "1".repeat(40),
			expectBase: trunk.head,
		});
		expect(result).toMatchObject({ landed: false, reason: "candidate-missing" });
	});
});

describe("notes", () => {
	it("writes notes that stock git reads, and keeps earlier notes when adding more", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		const ws = await Workspace.create();

		const threads = JSON.stringify({ v: 1, threads: [{ agent: "agent-07", decision: "Cap jitter at 2s" }] });
		const evidence = JSON.stringify({ v: 1, tests: { selected: 14, total: 600, result: "pass" } });
		await writeNotes(ws, remote, trunk.head, [
			{ ref: NOTES_THREADS, body: threads },
			{ ref: NOTES_EVIDENCE, body: evidence },
		]);

		expect(server.git(trunk.name, "notes", "--ref=threads", "show", trunk.head).trim()).toBe(threads);
		expect(server.git(trunk.name, "notes", "--ref=evidence", "show", trunk.head).trim()).toBe(evidence);
		expect(server.git(trunk.name, "log", "--notes=threads", "-1", "main")).toContain("Cap jitter at 2s");

		// A second commit gets its own note, written from a fresh workspace.
		const ws2 = await Workspace.create();
		await fetchRef(ws2, remote, "refs/heads/main", { depth: 1 });
		const second = await commitFiles(ws2, { parent: trunk.head, files: { "b.txt": "b\n" }, message: "Second" });
		await pushRef(ws2, remote, second, "refs/heads/main");
		await writeNotes(ws2, remote, second, [{ ref: NOTES_THREADS, body: '{"v":1,"threads":[]}' }]);

		expect(server.git(trunk.name, "notes", "--ref=threads", "show", second).trim()).toBe('{"v":1,"threads":[]}');
		expect(server.git(trunk.name, "notes", "--ref=threads", "show", trunk.head).trim()).toBe(threads);
		expect(server.git(trunk.name, "rev-list", "--count", NOTES_THREADS).trim()).toBe("2");
		server.git(trunk.name, "fsck", "--strict");
	});

	it("reads a note back from a fresh workspace, and returns null when there is none", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		expect(await readNote(await Workspace.create(), remote, NOTES_THREADS, trunk.head)).toBeNull();

		await writeNotes(await Workspace.create(), remote, trunk.head, [{ ref: NOTES_THREADS, body: "why" }]);
		const reader = await Workspace.create();
		expect(await readNote(reader, remote, NOTES_THREADS, trunk.head)).toBe("why");
		expect(await readNote(reader, remote, NOTES_THREADS, "2".repeat(40))).toBeNull();
	});

	it("reads a note written by the stock git client", async () => {
		const trunk = await seedTrunk();
		server.git(trunk.name, "notes", "--ref=threads", "add", "-m", "written by git", trunk.head);
		const note = await readNote(
			await Workspace.create(),
			{ url: server.url(trunk.name) },
			NOTES_THREADS,
			trunk.head,
		);
		expect(note?.trim()).toBe("written by git");
	});
});

describe("listRemoteRefs and rawRefUpdate", () => {
	it("lists branches and notes refs", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		await writeNotes(await Workspace.create(), remote, trunk.head, [{ ref: NOTES_THREADS, body: "n" }]);
		const refs = await listRemoteRefs(remote);
		expect(refs.get("refs/heads/main")).toBe(trunk.head);
		expect(refs.has(NOTES_THREADS)).toBe(true);
	});

	it("is rejected by a compare-and-swap server when the expected value is stale", async () => {
		const trunk = await seedTrunk();
		const remote = { url: server.url(trunk.name) };
		const ws = await Workspace.create();
		await fetchRef(ws, remote, "refs/heads/main", { depth: 1 });
		const second = await commitFiles(ws, { parent: trunk.head, files: { "b.txt": "b\n" }, message: "Second" });
		await pushRef(ws, remote, second, "refs/heads/probe");

		// Stale expectation: the ref is at `second`, we claim it is at `trunk.head`.
		const stale = await rawRefUpdate(remote, { ref: "refs/heads/probe", expectOid: trunk.head, newOid: trunk.head });
		expect(stale.accepted).toBe(false);
		expect(server.git(trunk.name, "rev-parse", "probe").trim()).toBe(second);

		// Correct expectation: accepted.
		const fresh = await rawRefUpdate(remote, { ref: "refs/heads/probe", expectOid: second, newOid: trunk.head });
		expect(fresh.accepted).toBe(true);
		expect(server.git(trunk.name, "rev-parse", "probe").trim()).toBe(trunk.head);
	});
});

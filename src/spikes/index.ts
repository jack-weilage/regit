/**
 * Day-one spikes.
 *
 * Each spike tests one assumption the design depends on that the Cloudflare
 * documentation does not settle, against the real services. A spike returns a
 * verdict, the measurements behind it, and the fallback the design takes if
 * the assumption does not hold.
 */
import { deleteRepos, remoteFor, waitForRepo, withRepo } from "../artifacts";
import { artifactsOf } from "../env";
import { ROUTINE_THRESHOLD, classifyRisk, screenNote } from "../clef";
import {
	NOTES_EVIDENCE,
	NOTES_THREADS,
	type Remote,
	Workspace,
	authenticatedUrl,
	commitFiles,
	fetchRef,
	land,
	listRemoteRefs,
	pushRef,
	rawRefUpdate,
	readNote,
	writeNotes,
} from "../git/ops";
import { NOTE_FIXTURES, RISK_FIXTURES } from "./fixtures";

export interface SpikeReport {
	id: string;
	assumption: string;
	verdict: "pass" | "fail" | "error";
	summary: string;
	fallback: string;
	ms: number;
	details: Record<string, unknown>;
}

export interface SpikeOptions {
	/** Import this repository as trunk instead of seeding a small one. */
	importUrl?: string;
	importBranch?: string;
	/** Sandbox spike: command that installs dependencies. */
	install?: string;
	/** Sandbox spike: command that runs tests. */
	test?: string;
	/** Leave the repositories the spike created in place. */
	keep?: boolean;
}

interface Context {
	env: Env;
	artifacts: Artifacts;
	options: SpikeOptions;
	runId: string;
	repos: Set<string>;
}

interface Trunk {
	name: string;
	branch: string;
	/** Remote with a write token. Only the integrator holds this in the real system. */
	write: Remote;
	head: string;
	imported: boolean;
}

const SEED_FILES: Record<string, string> = {
	"README.md": "# regit spike\n\nA small repository created by a regit spike.\n",
	"package.json": `${JSON.stringify({ name: "regit-spike", version: "0.0.0", private: true, type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
	"src/add.js": "export const add = (a, b) => a + b;\n",
	"src/add.test.js":
		"import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { add } from './add.js';\n\ntest('add', () => {\n\tassert.equal(add(2, 3), 5);\n});\n",
	"src/upper.js": "export const upper = (text) => text.toUpperCase();\n",
};

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
	const started = Date.now();
	const value = await fn();
	return [value, Date.now() - started];
}

/** Create the trunk repository a spike works against. */
async function setupTrunk(ctx: Context, label: string): Promise<Trunk & { setupMs: number }> {
	const name = `spike-${ctx.runId}-${label}-trunk`;
	const started = Date.now();
	ctx.repos.add(name);

	if (ctx.options.importUrl) {
		const imported = await ctx.artifacts.import({
			source: { url: ctx.options.importUrl, branch: ctx.options.importBranch },
			target: { name },
		});
		await waitForRepo(ctx.artifacts, name, 120_000);
		const write = { url: imported.remote, token: imported.token };
		const refs = await listRemoteRefs(write);
		const head = refs.get(`refs/heads/${imported.defaultBranch}`);
		if (!head) throw new Error(`imported repository has no ${imported.defaultBranch} branch`);
		return { name, branch: imported.defaultBranch, write, head, imported: true, setupMs: Date.now() - started };
	}

	const created = await ctx.artifacts.create(name, { setDefaultBranch: "main" });
	const write = { url: created.remote, token: created.token };
	const ws = await Workspace.create();
	const head = await commitFiles(ws, { files: SEED_FILES, message: "Seed spike repository" });
	const pushed = await pushRef(ws, write, head, "refs/heads/main");
	if (!pushed.ok) throw new Error(`could not seed trunk: ${pushed.detail}`);
	return { name, branch: "main", write, head, imported: false, setupMs: Date.now() - started };
}

/** Fork trunk the way regit forks it for an agent, and wait until the fork is usable. */
async function forkTrunk(
	ctx: Context,
	trunk: Trunk,
	label: string,
	defaultBranchOnly: boolean,
): Promise<{ name: string; write: Remote; forkMs: number }> {
	const name = `spike-${ctx.runId}-${label}`;
	ctx.repos.add(name);
	const started = Date.now();
	const forked = await withRepo(ctx.artifacts, trunk.name, (repo) =>
		repo.fork(name, { defaultBranchOnly, description: "regit spike fork" }),
	);
	await waitForRepo(ctx.artifacts, name);
	const write = { url: forked.remote, token: forked.token };
	// The fork is usable when a git client can list its refs.
	await listRemoteRefs(write);
	return { name, write, forkMs: Date.now() - started };
}

/**
 * Stand in for the verifier sandbox: build one commit on top of the trunk
 * head and leave it on a ref in the fork, using only a read token for trunk
 * and a write token for the fork.
 */
async function makeCandidate(
	trunk: Trunk,
	trunkRead: Remote,
	fork: Remote,
	id: string,
	base: string,
): Promise<{ oid: string; ref: string }> {
	const ws = await Workspace.create();
	await fetchRef(ws, trunkRead, `refs/heads/${trunk.branch}`, { depth: 1, remoteName: "trunk" });
	const oid = await commitFiles(ws, {
		parent: base,
		files: { [`regit-spike/${id}.txt`]: `candidate ${id}\n` },
		message: `Spike candidate ${id}`,
		author: { name: `agent-${id}`, email: `agent-${id}@regit.invalid` },
	});
	const ref = `refs/heads/regit/verified/${id}`;
	const pushed = await pushRef(ws, fork, oid, ref, { remoteName: "fork" });
	if (!pushed.ok) throw new Error(`could not push candidate to fork: ${pushed.detail}`);
	return { oid, ref };
}

type SpikeBody = (ctx: Context) => Promise<Omit<SpikeReport, "id" | "assumption" | "fallback" | "ms">>;

interface SpikeDefinition {
	id: string;
	assumption: string;
	fallback: string;
	run: SpikeBody;
}

const notesSpike: SpikeDefinition = {
	id: "notes",
	assumption: "Artifacts accepts a push to refs/notes/* and serves it back.",
	fallback: "Store notes as files on a separate `meta` branch in trunk, keyed by commit hash.",
	async run(ctx) {
		const trunk = await setupTrunk(ctx, "notes");
		const threads = JSON.stringify({ v: 1, threads: [{ agent: "spike", decision: "Notes round-trip" }] });
		const evidence = JSON.stringify({ v: 1, tests: { selected: 1, total: 1, result: "pass" } });

		const [heads, writeMs] = await timed(async () =>
			writeNotes(await Workspace.create(), trunk.write, trunk.head, [
				{ ref: NOTES_THREADS, body: threads },
				{ ref: NOTES_EVIDENCE, body: evidence },
			]),
		);
		const refs = await listRemoteRefs(trunk.write);
		const read = await remoteFor(ctx.artifacts, trunk.name, "read");
		const [readBack, readMs] = await timed(async () =>
			readNote(await Workspace.create(), read, NOTES_THREADS, trunk.head),
		);

		// Can the binding read a note directly? That would make `/why` cheaper.
		const bindingRead = await withRepo(ctx.artifacts, trunk.name, async (repo) => {
			const attempts: Record<string, string> = {};
			for (const ref of [NOTES_THREADS, heads[NOTES_THREADS]]) {
				try {
					const blob = await repo.readFile({ ref, path: trunk.head });
					attempts[ref === NOTES_THREADS ? "byRefName" : "byCommitId"] =
						blob === null ? "null" : (await blob.text()) === threads ? "matches" : "different content";
				} catch (error) {
					attempts[ref === NOTES_THREADS ? "byRefName" : "byCommitId"] = `error: ${String(error)}`;
				}
			}
			return attempts;
		});

		const advertised = refs.has(NOTES_THREADS) && refs.has(NOTES_EVIDENCE);
		const ok = advertised && readBack === threads;
		return {
			verdict: ok ? "pass" : "fail",
			summary: ok
				? `Notes pushed and read back in ${writeMs} ms write, ${readMs} ms read.`
				: "Notes did not round-trip.",
			details: { advertised, readBackMatches: readBack === threads, writeMs, readMs, bindingRead, refs: [...refs.keys()] },
		};
	},
};

const casSpike: SpikeDefinition = {
	id: "cas",
	assumption: "A push that is not a fast-forward of the current trunk head is rejected.",
	fallback: "The integrator stays the only writer and checks the head itself before each push.",
	async run(ctx) {
		const trunk = await setupTrunk(ctx, "cas");
		const ws = await Workspace.create();
		await fetchRef(ws, trunk.write, `refs/heads/${trunk.branch}`, { depth: 1 });
		const second = await commitFiles(ws, { parent: trunk.head, files: { "probe.txt": "2\n" }, message: "Probe" });
		const probe = "refs/heads/regit/probe";
		const created = await pushRef(ws, trunk.write, second, probe);
		if (!created.ok) throw new Error(`could not create probe branch: ${created.detail}`);

		// 1. Compare-and-swap: claim the ref holds a value it does not hold.
		const stale = await rawRefUpdate(trunk.write, { ref: probe, expectOid: trunk.head, newOid: trunk.head });
		const afterStale = (await listRemoteRefs(trunk.write)).get(probe);

		// 2. A forced push of an unrelated commit with the correct expectation.
		const unrelated = await commitFiles(ws, { files: { "other.txt": "x\n" }, message: "Unrelated root" });
		const forced = await pushRef(ws, trunk.write, unrelated, probe, { force: true });
		const afterForce = (await listRemoteRefs(trunk.write)).get(probe);

		// 3. The integrator's own client refuses a non-fast-forward before sending anything.
		const third = await commitFiles(ws, { files: { "third.txt": "3\n" }, message: "Another root" });
		const clientCheck = await pushRef(ws, trunk.write, third, probe);

		const casEnforced = !stale.accepted && afterStale === second;
		return {
			verdict: casEnforced ? "pass" : "fail",
			summary: casEnforced
				? "A ref update with a stale expected value was rejected, so two writers cannot overwrite each other."
				: "A ref update with a stale expected value was accepted. Trunk needs a single writer.",
			details: {
				staleUpdate: stale,
				refUnchangedAfterStaleUpdate: afterStale === second,
				forcePushOfUnrelatedCommitAccepted: forced.ok && afterForce === unrelated,
				clientRefusesNonFastForward: !clientCheck.ok,
			},
		};
	},
};

const landSpike: SpikeDefinition = {
	id: "land",
	assumption:
		"isomorphic-git in a Worker can fetch a commit from a fork and push it to trunk, within Worker memory.",
	fallback: "A second, trusted sandbox that runs no agent code does the trunk push with real git.",
	async run(ctx) {
		const trunk = await setupTrunk(ctx, "land");
		const trunkRead = await remoteFor(ctx.artifacts, trunk.name, "read");
		const fork = await forkTrunk(ctx, trunk, "land-fork-a", true);

		// A read token must not be able to push: agents and sandboxes only ever get this for trunk.
		let readTokenPushBlocked = false;
		let readTokenPushDetail = "";
		try {
			const probe = await Workspace.create();
			const oid = await commitFiles(probe, { files: { "nope.txt": "x\n" }, message: "Should be refused" });
			const outcome = await pushRef(probe, trunkRead, oid, "refs/heads/regit/read-token-probe");
			readTokenPushBlocked = !outcome.ok;
			readTokenPushDetail = outcome.ok ? "push succeeded" : outcome.detail;
		} catch (error) {
			readTokenPushBlocked = true;
			readTokenPushDetail = String(error);
		}

		const integrator = await Workspace.create();
		const first = await makeCandidate(trunk, trunkRead, fork.write, "a", trunk.head);
		const [firstResult, coldMs] = await timed(() =>
			land(integrator, {
				trunk: trunk.write,
				fork: fork.write,
				branch: trunk.branch,
				candidateRef: first.ref,
				expectOid: first.oid,
				expectBase: trunk.head,
			}),
		);
		const bytesAfterFirst = integrator.byteLength;

		// A second landing from the same workspace shows the steady-state cost.
		let warm: Record<string, unknown> = { skipped: "first landing did not succeed" };
		let secondLanded = false;
		if (firstResult.landed) {
			// Two candidates verified against the same base: only the first to land may land.
			const second = await makeCandidate(trunk, trunkRead, fork.write, "b", first.oid);
			const stale = await makeCandidate(trunk, trunkRead, fork.write, "stale", first.oid);
			const [secondResult, warmMs] = await timed(() =>
				land(integrator, {
					trunk: trunk.write,
					fork: fork.write,
					branch: trunk.branch,
					candidateRef: second.ref,
					expectOid: second.oid,
					expectBase: first.oid,
				}),
			);
			secondLanded = secondResult.landed;
			warm = { result: secondResult, warmMs, workspaceBytes: integrator.byteLength };

			// The other candidate was verified against a base that is no longer the head.
			warm.staleCandidate = await land(integrator, {
				trunk: trunk.write,
				fork: fork.write,
				branch: trunk.branch,
				candidateRef: stale.ref,
				expectOid: stale.oid,
				expectBase: first.oid,
			});
		}

		const log = await withRepo(ctx.artifacts, trunk.name, (repo) => repo.log({ ref: trunk.branch, limit: 3 }));
		const ok = firstResult.landed && secondLanded && readTokenPushBlocked;
		return {
			verdict: ok ? "pass" : "fail",
			summary: ok
				? `Landed from a fork in ${coldMs} ms cold and ${String(warm.warmMs)} ms warm, holding ${Math.round(bytesAfterFirst / 1024)} KB.`
				: "Landing from a fork did not work as designed. See details.",
			details: {
				trunkImported: trunk.imported,
				trunkSetupMs: trunk.setupMs,
				forkMs: fork.forkMs,
				cold: { result: firstResult, coldMs, workspaceBytes: bytesAfterFirst },
				warm,
				readTokenPushBlocked,
				readTokenPushDetail,
				trunkLog: log.map((commit) => ({ hash: commit.hash, message: commit.message.split("\n")[0] })),
			},
		};
	},
};

const forksSpike: SpikeDefinition = {
	id: "forks",
	assumption: "A fork completes in a few seconds and a git client can use it straight away.",
	fallback: "Pre-create a pool of forks before the demo run.",
	async run(ctx) {
		const trunk = await setupTrunk(ctx, "forks");
		await writeNotes(await Workspace.create(), trunk.write, trunk.head, [{ ref: NOTES_THREADS, body: "fork probe" }]);

		const [sequential, sequentialMs] = await timed(() => forkTrunk(ctx, trunk, "forks-seq", true));
		const [parallel, parallelMs] = await timed(() =>
			Promise.all([0, 1, 2, 3, 4].map((index) => forkTrunk(ctx, trunk, `forks-par-${index}`, true))),
		);

		// Notes live outside the default branch. Does a fork carry them?
		const allRefs = await forkTrunk(ctx, trunk, "forks-allrefs", false);
		const refsDefaultOnly = await listRemoteRefs(sequential.write);
		const refsAll = await listRemoteRefs(allRefs.write);

		const times = parallel.map((fork) => fork.forkMs);
		const slowest = Math.max(sequential.forkMs, ...times);
		const ok = slowest < 5_000;
		return {
			verdict: ok ? "pass" : "fail",
			summary: `One fork took ${sequentialMs} ms. Five in parallel took ${parallelMs} ms in total, slowest ${Math.max(...times)} ms.`,
			details: {
				trunkImported: trunk.imported,
				sequentialMs,
				parallelTotalMs: parallelMs,
				parallelEachMs: times,
				notesCarriedWithDefaultBranchOnly: refsDefaultOnly.has(NOTES_THREADS),
				notesCarriedWithAllRefs: refsAll.has(NOTES_THREADS),
				refsDefaultOnly: [...refsDefaultOnly.keys()],
				refsAll: [...refsAll.keys()],
			},
		};
	},
};

const sandboxSpike: SpikeDefinition = {
	id: "sandbox",
	assumption: "A sandbox can start, clone a repository, install and run tests in well under a minute.",
	fallback: "Bake dependencies into the container image, and keep one warm sandbox per worker slot.",
	async run(ctx) {
		const trunk = await setupTrunk(ctx, "sandbox");
		const read = await remoteFor(ctx.artifacts, trunk.name, "read");
		const stub = ctx.env.VERIFIER.getByName(`spike-${ctx.runId}`);
		const [result, totalMs] = await timed(() =>
			stub.spike({
				cloneUrl: authenticatedUrl(read),
				branch: trunk.branch,
				install: ctx.options.install,
				// The seeded repository's test needs no install step.
				test: ctx.options.test ?? (trunk.imported ? undefined : "node --test"),
			}),
		);

		const failed = result.steps.find((step) => step.exitCode !== 0);
		const cloned = result.steps.some((step) => step.step === "clone" && step.exitCode === 0);
		const ok = cloned && !failed && totalMs < 60_000;
		return {
			verdict: ok ? "pass" : "fail",
			summary: failed
				? `Step "${failed.step}" exited with code ${failed.exitCode}.`
				: `Sandbox started in ${result.bootMs} ms, then ${result.steps.map((step) => `${step.step} ${step.ms} ms`).join(", ")}. Total ${totalMs} ms.`,
			details: {
				trunkImported: trunk.imported,
				totalMs,
				bootMs: result.bootMs,
				gitPreinstalled: result.gitPreinstalled,
				steps: result.steps,
			},
		};
	},
};

const clefSpike: SpikeDefinition = {
	id: "clef",
	assumption: "Clef-flash gives sensible, repeatable risk tiers and catches bad thread records.",
	fallback: "Path rules decide the tier, and Clef only screens notes.",
	async run(ctx) {
		const rounds = 2;
		const risk: Array<Record<string, unknown>> = [];
		const latencies: number[] = [];
		let correct = 0;
		let unsafeMisses = 0;
		let disagreements = 0;

		for (const [index, fixture] of RISK_FIXTURES.entries()) {
			const decisions = [];
			for (let round = 0; round < rounds; round++) {
				const decision = await classifyRisk(ctx.env.AI, fixture.change);
				decisions.push(decision);
				latencies.push(decision.latencyMs);
			}
			const first = decisions[0];
			if (first.tier === fixture.label) correct++;
			// The unsafe direction: a risky change that would have been given only the targeted tests.
			if (fixture.label !== "routine" && first.scope === "targeted") unsafeMisses++;
			if (decisions.some((decision) => decision.tier !== first.tier)) disagreements++;
			risk.push({
				index,
				task: fixture.change.task,
				label: fixture.label,
				predicted: first.tier,
				scope: first.scope,
				probabilities: first.probabilities,
				repeatProbabilities: decisions[1]?.probabilities,
			});
		}

		const notes: Array<Record<string, unknown>> = [];
		let notesCorrect = 0;
		let injectionsMissed = 0;
		for (const fixture of NOTE_FIXTURES) {
			const screen = await screenNote(ctx.env.AI, fixture.record);
			if (screen.verdict === fixture.label) notesCorrect++;
			if (fixture.label === "quarantine" && screen.verdict !== "quarantine") injectionsMissed++;
			notes.push({ label: fixture.label, ...screen, decision: fixture.record.decision.slice(0, 80) });
		}

		latencies.sort((a, b) => a - b);
		const accuracy = correct / RISK_FIXTURES.length;
		const ok = accuracy >= 0.8 && unsafeMisses === 0 && disagreements === 0 && injectionsMissed === 0;
		return {
			verdict: ok ? "pass" : "fail",
			summary: `Risk tier: ${correct} of ${RISK_FIXTURES.length} correct, ${unsafeMisses} risky changes given targeted tests, ${disagreements} changed answer on repeat. Notes: ${notesCorrect} of ${NOTE_FIXTURES.length} correct, ${injectionsMissed} injections missed.`,
			details: {
				accuracy,
				unsafeMisses,
				disagreements,
				routineThreshold: ROUTINE_THRESHOLD,
				latencyMs: {
					median: latencies[Math.floor(latencies.length / 2)],
					max: latencies[latencies.length - 1],
				},
				notesCorrect,
				injectionsMissed,
				risk,
				notes,
			},
		};
	},
};

export const SPIKES: SpikeDefinition[] = [notesSpike, casSpike, landSpike, forksSpike, sandboxSpike, clefSpike];

export function describeSpikes(): Array<Pick<SpikeDefinition, "id" | "assumption" | "fallback">> {
	return SPIKES.map(({ id, assumption, fallback }) => ({ id, assumption, fallback }));
}

export async function runSpike(env: Env, id: string, options: SpikeOptions): Promise<SpikeReport | null> {
	const spike = SPIKES.find((candidate) => candidate.id === id);
	if (!spike) return null;
	const ctx: Context = {
		env,
		artifacts: artifactsOf(env),
		options,
		runId: crypto.randomUUID().slice(0, 8),
		repos: new Set(),
	};
	const started = Date.now();
	const base = { id: spike.id, assumption: spike.assumption, fallback: spike.fallback };
	try {
		const result = await spike.run(ctx);
		return { ...base, ...result, ms: Date.now() - started, details: { ...result.details, runId: ctx.runId } };
	} catch (error) {
		const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		return {
			...base,
			verdict: "error",
			summary: `The spike could not finish: ${message}`,
			ms: Date.now() - started,
			details: {
				runId: ctx.runId,
				error: message,
				code: (error as { code?: string })?.code,
				data: (error as { data?: unknown })?.data,
				stack: error instanceof Error ? error.stack?.split("\n").slice(0, 8) : undefined,
			},
		};
	} finally {
		if (!options.keep) await deleteRepos(ctx.artifacts, ctx.repos);
	}
}

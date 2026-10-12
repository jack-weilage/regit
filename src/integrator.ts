/**
 * The Integrator is the only thing that writes to trunk.
 *
 * There is one per trunk repository. It keeps the queue of candidates,
 * verifies several at once in sandboxes, and lands them one at a time. For
 * each candidate it decides how much testing the change needs, chooses the
 * tests from the import graph, and after landing writes the agent's thread
 * record and the evidence as git notes on the landed commit.
 *
 * Work is driven by an alarm so that it continues after the request that
 * queued it has returned.
 */
import { DurableObject } from "cloudflare:workers";
import { remoteFor, withRepo } from "./artifacts";
import { type ChangeSummary, type NoteScreen, type RiskAssessment, type ThreadRecord, assessRisk } from "./clef";
import { artifactsOf, clefOf, parallelismOf } from "./env";
import {
	type Identity,
	NOTES_EVIDENCE,
	NOTES_THREADS,
	REGIT_IDENTITY,
	type Remote,
	type TreeChange,
	Workspace,
	authenticatedUrl,
	changesToFiles,
	commitFiles,
	diffCommits,
	ensureTrunkCommit,
	fetchCandidate,
	listFiles,
	pushRef,
	readBlobText,
	trunkHead,
	writeNotes,
} from "./git/ops";
import { DEFAULT_TEST_MATCH, type Selection, type TargetConfig, TestTargeter, collision } from "./targeting";
import type { StepResult, TestResult } from "./verifier";

export type CandidateStatus = "queued" | "verifying" | "landed" | "rejected" | "error";

export interface TaskRow {
	id: string;
	agent: string;
	task: string;
	fork: string;
	base: string | null;
	createdAt: number;
}

export interface CandidateView {
	id: string;
	seq: number;
	taskId: string;
	agent: string;
	task: string;
	fork: string;
	ref: string;
	head: string;
	status: CandidateStatus;
	/** Why the candidate was rejected or errored. */
	reason: string | null;
	/** Everything known about the outcome: evidence when landed, the cause when rejected. */
	detail: Record<string, unknown> | null;
	attempts: number;
	/** The trunk commit this candidate landed as. */
	landed: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface EventView {
	seq: number;
	at: number;
	candidateId: string | null;
	kind: string;
	data: Record<string, unknown>;
}

export interface DecisionView {
	path: string;
	kind: "landed" | "rejected";
	candidateId: string;
	commit: string | null;
	at: number;
	record: Record<string, unknown>;
}

export interface SubmitInput {
	taskId: string;
	ref: string;
	head: string;
	thread: ThreadRecord;
	screen: NoteScreen | null;
}

/** How the trunk repository wants to be tested. Read from `regit.json` at the trunk head. */
interface RepoConfig extends TargetConfig {
	install: string;
	test: string;
}

type Verified = {
	kind: "verified";
	commit: string;
	base: string;
	changes: TreeChange[];
	message: string;
	author: Identity;
	risk: RiskAssessment;
	selection: Selection;
	tests: { ran: boolean; durationMs: number; steps: StepResult[] };
	bootMs: number;
};
type Outcome =
	| Verified
	| { kind: "rejected"; reason: string; detail: Record<string, unknown>; paths: string[] }
	| { kind: "retry"; reason: string; detail: Record<string, unknown> };

/**
 * The methods other parts of the Worker call on an Integrator. The generated
 * stub type cannot express results that contain open-ended JSON, so callers
 * use this view of it.
 */
export type IntegratorApi = Pick<
	Integrator,
	| "init"
	| "status"
	| "pause"
	| "resume"
	| "registerTask"
	| "authorizeTask"
	| "task"
	| "submit"
	| "candidate"
	| "candidates"
	| "events"
	| "why"
>;

/** How many times a candidate may fail for reasons other than trunk moving before it is given up on. */
const MAX_FAILURES = 3;
const WORKSPACE_LIMIT_BYTES = 64 * 1024 * 1024;
const PUMP_BUDGET_MS = 10 * 60_000;

function parseJson<T>(text: string | null): T | null {
	if (text === null) return null;
	try {
		return JSON.parse(text) as T;
	} catch {
		return null;
	}
}

/** The commit message for the single commit a candidate becomes. */
function commitMessage(candidateId: string, thread: ThreadRecord, screen: NoteScreen | null): string {
	const subject = thread.task.split("\n")[0].slice(0, 72) || "Change";
	// A record withheld from the notes must not reach later agents through the log either.
	const body = screen?.verdict === "quarantine" ? "" : `${thread.decision.trim()}\n\n`;
	return `${subject}\n\n${body}Regit-Agent: ${thread.agent}\nRegit-Candidate: ${candidateId}\n`;
}

function agentIdentity(agent: string): Identity {
	return { name: agent, email: `${agent}@agents.regit.invalid` };
}

/** What is needed to finish recording a landing, saved before the push that makes it. */
interface LandingRecord {
	candidateId: string;
	commit: string;
	changed: string[];
	evidence: Record<string, unknown>;
	threads: { threads: unknown[] } & Record<string, unknown>;
}

/**
 * Files that decide how a change is judged. A task may change them only when
 * the admin said so when creating it, because otherwise a change could
 * switch off its own tests, or everyone's.
 */
const PROTECTED = [/^regit\.json$/, /(^|\/)(vitest|jest|playwright|mocha)[^/]*\.config\.[cm]?[jt]s$/, /(^|\/)\.mocharc[^/]*$/, /^\.github\//];

export class Integrator extends DurableObject<Env> {
	private sql: SqlStorage;
	private workspace: Workspace | undefined;
	private targeter: TestTargeter | undefined;
	/** isomorphic-git operations on one workspace must not interleave. */
	private gitQueue: Promise<unknown> = Promise.resolve();
	private pumping = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS tasks (
				id TEXT PRIMARY KEY, agent TEXT NOT NULL, task TEXT NOT NULL, fork TEXT NOT NULL,
				token_hash TEXT NOT NULL, base TEXT, allow_protected INTEGER NOT NULL DEFAULT 0,
				created_at INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS candidates (
				id TEXT PRIMARY KEY, seq INTEGER NOT NULL, task_id TEXT NOT NULL, agent TEXT NOT NULL,
				task TEXT NOT NULL, fork TEXT NOT NULL, ref TEXT NOT NULL, head TEXT NOT NULL,
				thread TEXT NOT NULL, screen TEXT, status TEXT NOT NULL, reason TEXT, detail TEXT,
				attempts INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0, landed TEXT,
				created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
			CREATE INDEX IF NOT EXISTS candidates_status ON candidates(status, seq);
			CREATE TABLE IF NOT EXISTS decisions (
				id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL, kind TEXT NOT NULL,
				candidate_id TEXT NOT NULL, commit_oid TEXT, record TEXT NOT NULL, at INTEGER NOT NULL);
			CREATE INDEX IF NOT EXISTS decisions_path ON decisions(path, at);
			CREATE TABLE IF NOT EXISTS events (
				seq INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, candidate_id TEXT,
				kind TEXT NOT NULL, data TEXT NOT NULL);
		`);
	}

	// ── Configuration ───────────────────────────────────────────────────────

	private meta(key: string): string | null {
		const rows = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray();
		return rows[0]?.value ?? null;
	}

	private setMeta(key: string, value: string): void {
		this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
	}

	private get repo(): { name: string; branch: string } {
		const name = this.meta("name");
		const branch = this.meta("branch");
		if (!name || !branch) throw new Error("this repository has not been registered with regit");
		return { name, branch };
	}

	/** Register the trunk repository this integrator serves. */
	async init(input: { name: string; branch: string }): Promise<void> {
		this.setMeta("name", input.name);
		this.setMeta("branch", input.branch);
		this.event(null, "repo.registered", input);
	}

	async status(): Promise<Record<string, unknown> | null> {
		if (!this.meta("name")) return null;
		const { name, branch } = this.repo;
		const counts: Record<string, number> = {};
		for (const row of this.sql.exec<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM candidates GROUP BY status")) {
			counts[row.status] = row.n;
		}
		// The binding reads the head without minting a token.
		const log = await withRepo(artifactsOf(this.env), name, (repo) => repo.log({ ref: branch, limit: 1 }));
		return { name, branch, head: log[0]?.hash ?? null, paused: this.meta("paused") === "1", candidates: counts };
	}

	// ── Tasks and submissions ───────────────────────────────────────────────

	async registerTask(input: {
		id: string;
		agent: string;
		task: string;
		fork: string;
		tokenHash: string;
		base: string | null;
		allowProtected?: boolean;
	}): Promise<void> {
		this.sql.exec(
			"INSERT INTO tasks (id, agent, task, fork, token_hash, base, allow_protected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
			input.id,
			input.agent,
			input.task,
			input.fork,
			input.tokenHash,
			input.base,
			input.allowProtected ? 1 : 0,
			Date.now(),
		);
		this.event(null, "task.created", { task: input.id, agent: input.agent, title: input.task, fork: input.fork });
	}

	/** Look a task up by id, checking the hash of the task token presented with the request. */
	async authorizeTask(taskId: string, tokenHash: string): Promise<TaskRow | null> {
		const rows = this.sql
			.exec<{ id: string; agent: string; task: string; fork: string; token_hash: string; base: string | null; created_at: number }>(
				"SELECT * FROM tasks WHERE id = ?",
				taskId,
			)
			.toArray();
		const row = rows[0];
		if (!row || row.token_hash !== tokenHash) return null;
		return { id: row.id, agent: row.agent, task: row.task, fork: row.fork, base: row.base, createdAt: row.created_at };
	}

	async task(taskId: string): Promise<TaskRow | null> {
		const rows = this.sql
			.exec<{ id: string; agent: string; task: string; fork: string; base: string | null; created_at: number }>(
				"SELECT id, agent, task, fork, base, created_at FROM tasks WHERE id = ?",
				taskId,
			)
			.toArray();
		const row = rows[0];
		return row ? { id: row.id, agent: row.agent, task: row.task, fork: row.fork, base: row.base, createdAt: row.created_at } : null;
	}

	/** Queue a submission for verification and landing. */
	async submit(input: SubmitInput): Promise<CandidateView> {
		const task = await this.task(input.taskId);
		if (!task) throw new Error(`no task ${input.taskId}`);
		const id = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
		const next = this.sql.exec<{ n: number }>("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM candidates").one().n;
		const now = Date.now();
		this.sql.exec(
			`INSERT INTO candidates (id, seq, task_id, agent, task, fork, ref, head, thread, screen, status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
			id,
			next,
			task.id,
			task.agent,
			task.task,
			task.fork,
			input.ref,
			input.head,
			JSON.stringify(input.thread),
			input.screen ? JSON.stringify(input.screen) : null,
			now,
			now,
		);
		this.event(id, "candidate.queued", { agent: task.agent, title: task.task, head: input.head });
		await this.wake();
		return this.candidate(id) as Promise<CandidateView>;
	}

	// ── Reads ───────────────────────────────────────────────────────────────

	private toView(row: Record<string, unknown>): CandidateView {
		return {
			id: row.id as string,
			seq: row.seq as number,
			taskId: row.task_id as string,
			agent: row.agent as string,
			task: row.task as string,
			fork: row.fork as string,
			ref: row.ref as string,
			head: row.head as string,
			status: row.status as CandidateStatus,
			reason: (row.reason as string | null) ?? null,
			detail: parseJson(row.detail as string | null),
			attempts: row.attempts as number,
			landed: (row.landed as string | null) ?? null,
			createdAt: row.created_at as number,
			updatedAt: row.updated_at as number,
		};
	}

	async candidate(id: string): Promise<CandidateView | null> {
		const rows = this.sql.exec("SELECT * FROM candidates WHERE id = ?", id).toArray();
		return rows[0] ? this.toView(rows[0]) : null;
	}

	async candidates(limit = 100): Promise<CandidateView[]> {
		return this.sql
			.exec("SELECT * FROM candidates ORDER BY seq DESC LIMIT ?", Math.min(Math.max(limit, 1), 500))
			.toArray()
			.map((row) => this.toView(row));
	}

	async events(after = 0, limit = 500): Promise<EventView[]> {
		return this.sql
			.exec<{ seq: number; at: number; candidate_id: string | null; kind: string; data: string }>(
				"SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?",
				after,
				Math.min(Math.max(limit, 1), 1000),
			)
			.toArray()
			.map((row) => ({
				seq: row.seq,
				at: row.at,
				candidateId: row.candidate_id,
				kind: row.kind,
				data: parseJson<Record<string, unknown>>(row.data) ?? {},
			}));
	}

	/**
	 * The decisions recorded against some paths, newest first: what landed and
	 * why, and what was tried and rejected. A path matches itself and
	 * everything under it.
	 */
	async why(paths: string[], limit = 20): Promise<DecisionView[]> {
		const seen = new Set<string>();
		const out: DecisionView[] = [];
		for (const path of paths.slice(0, 20)) {
			const rows = this.sql
				.exec<{ path: string; kind: string; candidate_id: string; commit_oid: string | null; record: string; at: number }>(
					"SELECT path, kind, candidate_id, commit_oid, record, at FROM decisions WHERE path = ? OR path LIKE ? ESCAPE '\\' ORDER BY at DESC LIMIT ?",
					path,
					`${path.replace(/[\\%_]/g, "\\$&").replace(/\/$/, "")}/%`,
					limit,
				)
				.toArray();
			for (const row of rows) {
				const key = row.candidate_id;
				if (seen.has(key)) continue;
				seen.add(key);
				out.push({
					path: row.path,
					kind: row.kind as "landed" | "rejected",
					candidateId: row.candidate_id,
					commit: row.commit_oid,
					at: row.at,
					record: parseJson<Record<string, unknown>>(row.record) ?? {},
				});
			}
		}
		return out.sort((a, b) => b.at - a.at).slice(0, limit);
	}

	// ── Bookkeeping ─────────────────────────────────────────────────────────

	private event(candidateId: string | null, kind: string, data: Record<string, unknown>): void {
		this.sql.exec("INSERT INTO events (at, candidate_id, kind, data) VALUES (?, ?, ?, ?)", Date.now(), candidateId, kind, JSON.stringify(data));
	}

	private setStatus(id: string, status: CandidateStatus, fields: { reason?: string | null; detail?: unknown; landed?: string } = {}): void {
		this.sql.exec(
			"UPDATE candidates SET status = ?, reason = ?, detail = ?, landed = COALESCE(?, landed), updated_at = ? WHERE id = ?",
			status,
			fields.reason ?? null,
			fields.detail === undefined ? null : JSON.stringify(fields.detail),
			fields.landed ?? null,
			Date.now(),
			id,
		);
	}

	private index(kind: "landed" | "rejected", candidate: CandidateView, paths: string[], commit: string | null, record: Record<string, unknown>): void {
		const at = Date.now();
		for (const path of new Set(paths)) {
			this.sql.exec(
				"INSERT INTO decisions (path, kind, candidate_id, commit_oid, record, at) VALUES (?, ?, ?, ?, ?, ?)",
				path,
				kind,
				candidate.id,
				commit,
				JSON.stringify(record),
				at,
			);
		}
	}

	/** The thread record as it may be shown to later agents. A quarantined record is withheld. */
	private publicThread(thread: ThreadRecord, screen: NoteScreen | null): Record<string, unknown> {
		if (screen?.verdict === "quarantine") {
			return { agent: thread.agent, task: thread.task, quarantined: true };
		}
		return { ...thread };
	}

	// ── Git workspace ───────────────────────────────────────────────────────

	/** Run git work on the shared workspace, one piece at a time. */
	private git<T>(work: (ws: Workspace) => Promise<T>): Promise<T> {
		const run = this.gitQueue.then(async () => {
			this.workspace ??= await Workspace.create();
			return work(this.workspace);
		});
		this.gitQueue = run.catch(() => undefined);
		return run;
	}

	private getTargeter(): TestTargeter {
		// Import lists are cached by blob id, so the cache outlives any one workspace.
		this.targeter ??= new TestTargeter((oid) => this.git((ws) => readBlobText(ws, oid)));
		return this.targeter;
	}

	private async repoConfig(head: string): Promise<{ config: RepoConfig; files: Map<string, string> }> {
		const files = await this.git((ws) => listFiles(ws, head));
		let parsed: { install?: unknown; test?: unknown; testMatch?: unknown } = {};
		const blob = files.get("regit.json");
		if (blob) parsed = parseJson(await this.git((ws) => readBlobText(ws, blob))) ?? {};
		let testMatch = DEFAULT_TEST_MATCH;
		if (typeof parsed.testMatch === "string" && parsed.testMatch.length <= 200) {
			try {
				testMatch = new RegExp(parsed.testMatch);
			} catch {
				// Keep the default.
			}
		}
		return {
			files,
			config: {
				install: typeof parsed.install === "string" ? parsed.install : files.has("package-lock.json") ? "npm ci" : "",
				test: typeof parsed.test === "string" ? parsed.test : "npm test --",
				testMatch,
			},
		};
	}

	// ── The pump ────────────────────────────────────────────────────────────

	private async wake(): Promise<void> {
		if (this.meta("paused") === "1") return;
		if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now());
	}

	/** Stop starting new verification rounds. Submissions keep queueing. */
	async pause(): Promise<void> {
		this.setMeta("paused", "1");
		this.event(null, "repo.paused", {});
	}

	/** Start verifying and landing again. Everything queued meanwhile goes into the next round together. */
	async resume(): Promise<void> {
		this.setMeta("paused", "0");
		this.event(null, "repo.resumed", {});
		await this.wake();
	}

	async alarm(): Promise<void> {
		if (this.pumping) return;
		this.pumping = true;
		let failed = false;
		try {
			await this.pump();
			this.setMeta("pump_failures", "0");
		} catch (error) {
			failed = true;
			this.event(null, "pump.error", { message: error instanceof Error ? error.message : String(error) });
		} finally {
			this.pumping = false;
		}
		const waiting = this.sql
			.exec<{ n: number }>("SELECT COUNT(*) AS n FROM candidates WHERE status IN ('queued', 'verifying')")
			.one().n;
		if (waiting === 0 || this.meta("paused") === "1") return;
		let delay = 250;
		if (failed) {
			// Back off while whatever broke the round is still broken.
			const failures = Number(this.meta("pump_failures") ?? 0) + 1;
			this.setMeta("pump_failures", String(failures));
			delay = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
		}
		await this.ctx.storage.setAlarm(Date.now() + delay);
	}

	private queued(limit: number): CandidateView[] {
		return this.sql
			.exec("SELECT * FROM candidates WHERE status = 'queued' ORDER BY seq LIMIT ?", limit)
			.toArray()
			.map((row) => this.toView(row));
	}

	private async pump(): Promise<void> {
		await this.reconcileLanding();
		// A candidate left in `verifying` belongs to a round that did not finish.
		// It gets another try, but not an unlimited number of them.
		const now = Date.now();
		this.sql.exec(
			`UPDATE candidates SET
				failures = failures + 1,
				status = CASE WHEN failures + 1 >= ? THEN 'error' ELSE 'queued' END,
				reason = CASE WHEN failures + 1 >= ? THEN 'interrupted' ELSE reason END,
				updated_at = ?
			 WHERE status = 'verifying'`,
			MAX_FAILURES,
			MAX_FAILURES,
			now,
		);
		const deadline = now + PUMP_BUDGET_MS;
		while (Date.now() < deadline) {
			if (this.meta("paused") === "1") return;
			const batch = this.queued(parallelismOf(this.env));
			if (batch.length === 0) return;
			await this.round(batch);
		}
	}

	/** Verify a batch against the current trunk head, then land what passed, in order. */
	private async round(batch: CandidateView[]): Promise<void> {
		const { name, branch } = this.repo;
		const trunkRead = await remoteFor(artifactsOf(this.env), name, "read", 1800);
		const base = await trunkHead(trunkRead, branch);
		if (!base) {
			for (const candidate of batch) {
				this.setStatus(candidate.id, "error", { reason: "trunk-empty", detail: { message: "trunk has no commits" } });
			}
			return;
		}
		// Start from a fresh workspace when the old one has grown too large. This is
		// the only safe point: nothing in flight depends on objects it holds.
		await this.gitQueue;
		if (this.workspace && this.workspace.byteLength > WORKSPACE_LIMIT_BYTES) this.workspace = undefined;
		if (!(await this.git((ws) => ensureTrunkCommit(ws, trunkRead, branch, base)))) {
			throw new Error(`could not fetch trunk head ${base}`);
		}
		const { config, files: baseFiles } = await this.repoConfig(base);

		for (const candidate of batch) {
			this.sql.exec(
				"UPDATE candidates SET status = 'verifying', attempts = attempts + 1, updated_at = ? WHERE id = ?",
				Date.now(),
				candidate.id,
			);
			this.event(candidate.id, "candidate.verifying", { base, attempt: candidate.attempts + 1 });
		}

		const outcomes = await Promise.all(
			batch.map((candidate) =>
				this.verify(candidate, base, config, baseFiles, trunkRead).catch(
					(error): Outcome => ({
						kind: "retry",
						reason: "verifier-error",
						detail: { message: error instanceof Error ? error.message : String(error) },
					}),
				),
			),
		);

		// Land in submission order. `head` advances as candidates land, and is
		// emptied when this integrator can no longer be sure where trunk is.
		let head = base;
		const landedThisRound: Array<{ commit: string; changed: Set<string>; reach: Set<string> | null }> = [];
		for (const [index, candidate] of batch.entries()) {
			const outcome = outcomes[index];
			try {
				const { thread, screen } = this.record(candidate.id);

				if (outcome.kind === "rejected") {
					const related = outcome.paths.length > 0 ? await this.why(outcome.paths, 5) : [];
					const detail = { ...outcome.detail, related: related.filter((entry) => entry.kind === "landed") };
					this.setStatus(candidate.id, "rejected", { reason: outcome.reason, detail });
					this.index("rejected", candidate, outcome.paths, null, {
						...this.publicThread(thread, screen),
						reason: outcome.reason,
						summary: outcome.detail.message,
					});
					this.event(candidate.id, "candidate.rejected", { reason: outcome.reason, message: outcome.detail.message });
					continue;
				}
				if (outcome.kind === "retry") {
					this.requeue(candidate, outcome.reason, outcome.detail, true);
					continue;
				}

				const changed = new Set(outcome.changes.map((change) => change.path));
				const reach = outcome.selection.reach === null ? null : new Set(outcome.selection.reach);
				let commit = outcome.commit;
				let mode: "direct" | "replayed" = "direct";

				if (head !== outcome.base) {
					// Trunk moved while this candidate was being verified. Its result still
					// holds only if nothing that landed in between can affect it, and it
					// cannot affect anything that landed in between.
					const blocker = await this.replayBlocker(outcome, changed, reach, head, landedThisRound);
					if (blocker) {
						this.requeue(candidate, "trunk-moved", { message: blocker }, false);
						continue;
					}
					mode = "replayed";
					const onto = head;
					commit = await this.git((ws) =>
						commitFiles(ws, {
							parent: onto,
							files: changesToFiles(outcome.changes),
							message: outcome.message,
							author: outcome.author,
							committer: REGIT_IDENTITY,
						}),
					);
				}

				const landing: LandingRecord = {
					candidateId: candidate.id,
					commit,
					changed: [...changed].sort(),
					evidence: {
						v: 1,
						candidate: candidate.id,
						verified: { commit: outcome.commit, base: outcome.base },
						landing: {
							mode,
							onto: head,
							intervening: mode === "replayed" ? landedThisRound.map((entry) => entry.commit) : [],
						},
						risk: outcome.risk,
						changed: [...changed].sort(),
						tests: {
							mode: outcome.selection.mode,
							reason: outcome.selection.reason,
							selected: outcome.selection.mode === "full" ? outcome.selection.totalTests : outcome.selection.tests.length,
							total: outcome.selection.totalTests,
							files: outcome.selection.tests,
							result: outcome.tests.ran ? "pass" : "none needed",
							durationMs: outcome.tests.durationMs,
						},
						screen,
					},
					threads: {
						v: 1,
						candidate: candidate.id,
						landed_at: new Date().toISOString(),
						base: head,
						threads: [this.publicThread(thread, screen)],
					},
				};

				// Record the intent before pushing, so a crash after the push cannot
				// lose track of a change that is already on trunk.
				this.setMeta("landing", JSON.stringify(landing));
				const trunkWrite = await remoteFor(artifactsOf(this.env), name, "write", 900);
				const pushed = await this.git((ws) => pushRef(ws, trunkWrite, commit, `refs/heads/${branch}`, { remoteName: "trunk" }));
				if (!pushed.ok) {
					this.setMeta("landing", "");
					this.requeue(candidate, "push-rejected", { message: pushed.detail }, false);
					// Something else moved trunk. Stop landing from this round.
					head = "";
					continue;
				}

				head = commit;
				landedThisRound.push({ commit, changed, reach });
				await this.finishLanding(landing, trunkWrite);
			} catch (error) {
				// Unknown state: do not land anything else on top of it this round.
				head = "";
				const message = error instanceof Error ? error.message : String(error);
				const pending = parseJson<LandingRecord>(this.meta("landing"));
				if (pending?.candidateId === candidate.id) {
					// The push may have happened. The next pump checks trunk and settles it.
					this.event(candidate.id, "candidate.landing-interrupted", { message });
				} else {
					this.requeue(candidate, "integrator-error", { message }, true);
				}
			}
		}
	}

	private record(candidateId: string): { thread: ThreadRecord; screen: NoteScreen | null; allowProtected: boolean } {
		const row = this.sql
			.exec<{ thread: string; screen: string | null; task_id: string }>(
				"SELECT thread, screen, task_id FROM candidates WHERE id = ?",
				candidateId,
			)
			.one();
		const task = this.sql.exec<{ allow_protected: number }>("SELECT allow_protected FROM tasks WHERE id = ?", row.task_id).toArray();
		return {
			thread: parseJson<ThreadRecord>(row.thread) as ThreadRecord,
			screen: parseJson<NoteScreen>(row.screen),
			allowProtected: task[0]?.allow_protected === 1,
		};
	}

	/** Write the notes for a commit that is on trunk, and record that it landed. */
	private async finishLanding(landing: LandingRecord, trunkWrite: Remote): Promise<void> {
		const candidate = await this.candidate(landing.candidateId);
		let notes: Record<string, string> | { error: string };
		try {
			notes = await this.git((ws) =>
				writeNotes(
					ws,
					trunkWrite,
					landing.commit,
					[
						{ ref: NOTES_THREADS, body: `${JSON.stringify(landing.threads, null, 2)}\n` },
						{ ref: NOTES_EVIDENCE, body: `${JSON.stringify(landing.evidence, null, 2)}\n` },
					],
					{ remoteName: "trunk" },
				),
			);
		} catch (error) {
			// The change is on trunk. A missing note must not undo that.
			notes = { error: error instanceof Error ? error.message : String(error) };
		}
		this.setStatus(landing.candidateId, "landed", { landed: landing.commit, detail: { ...landing.evidence, notes } });
		if (candidate) {
			const thread = (landing.threads.threads as Array<Record<string, unknown>>)[0] ?? {};
			this.index("landed", candidate, landing.changed, landing.commit, thread);
		}
		const evidence = landing.evidence as { landing: { mode: string }; tests: unknown; risk: RiskAssessment };
		this.event(landing.candidateId, "candidate.landed", {
			commit: landing.commit,
			mode: evidence.landing.mode,
			tests: evidence.tests,
			risk: { tier: evidence.risk.tier, scope: evidence.risk.scope, reason: evidence.risk.reason },
			changed: landing.changed,
		});
		this.setMeta("landing", "");
	}

	/**
	 * Settle a landing that was interrupted between the push and the
	 * bookkeeping: if the commit is on trunk, finish recording it.
	 */
	private async reconcileLanding(): Promise<void> {
		const landing = parseJson<LandingRecord>(this.meta("landing"));
		if (!landing) return;
		const { name, branch } = this.repo;
		const artifacts = artifactsOf(this.env);
		const log = await withRepo(artifacts, name, (repo) => repo.log({ ref: branch, limit: 200 }));
		if (log.some((entry) => entry.hash === landing.commit)) {
			await this.finishLanding(landing, await remoteFor(artifacts, name, "write", 900));
			return;
		}
		// The push never happened. The candidate is verified again like any interrupted one.
		this.setMeta("landing", "");
	}

	/**
	 * Put a candidate back in the queue.
	 * @param failure true when something went wrong, as opposed to trunk simply
	 *   having moved. Only failures count towards giving up.
	 */
	private requeue(candidate: CandidateView, reason: string, detail: Record<string, unknown>, failure: boolean): void {
		if (failure) {
			this.sql.exec("UPDATE candidates SET failures = failures + 1 WHERE id = ?", candidate.id);
			const { failures } = this.sql.exec<{ failures: number }>("SELECT failures FROM candidates WHERE id = ?", candidate.id).one();
			if (failures >= MAX_FAILURES) {
				this.setStatus(candidate.id, "error", { reason, detail: { ...detail, failures } });
				this.event(candidate.id, "candidate.error", { reason, message: detail.message });
				return;
			}
		}
		this.setStatus(candidate.id, "queued", { reason, detail });
		this.event(candidate.id, "candidate.requeued", { reason, message: detail.message });
	}

	/**
	 * Decide whether a candidate verified against an older trunk head can land
	 * on the current one without being verified again.
	 * @returns null when it can, otherwise why not.
	 */
	private async replayBlocker(
		outcome: Verified,
		changed: Set<string>,
		reach: Set<string> | null,
		head: string,
		landed: Array<{ commit: string; changed: Set<string>; reach: Set<string> | null }>,
	): Promise<string | null> {
		if (!head) return "trunk was moved by something other than this integrator";
		if (reach === null) return "the full suite ran, so any change to trunk invalidates the result";
		const footprint = new Set([...changed, ...reach]);
		for (const other of landed) {
			if (other.reach === null) return `${other.commit.slice(0, 8)} landed with the full suite, which covers these files`;
			const theirs = collision(other.changed, footprint);
			if (theirs) return `${other.commit.slice(0, 8)} changed ${theirs}, which this change touches or its tests depend on`;
			const ours = collision(changed, new Set([...other.changed, ...other.reach]));
			if (ours) return `this change touches ${ours}, which the tests for ${other.commit.slice(0, 8)} depend on`;
		}
		// Check against git itself, not only against this round's bookkeeping.
		const between = await this.git((ws) => diffCommits(ws, outcome.base, head));
		const moved = collision(between.map((change) => change.path), footprint);
		if (moved) return `${moved} changed on trunk since this change was verified`;
		return null;
	}

	/**
	 * The first changed path that decides how changes are tested, if any. A
	 * package.json counts only when its scripts differ from trunk's.
	 */
	private async protectedChange(paths: string[], baseFiles: Map<string, string>, files: Map<string, string>): Promise<string | null> {
		for (const path of paths) {
			if (PROTECTED.some((pattern) => pattern.test(path))) return path;
			if (/(^|\/)package\.json$/.test(path)) {
				const scripts = async (oid: string | undefined) => {
					if (!oid) return "{}";
					const parsed = parseJson<{ scripts?: unknown }>(await this.git((ws) => readBlobText(ws, oid)));
					// A manifest that does not parse is treated as changed.
					return parsed ? JSON.stringify(parsed.scripts ?? {}) : `unparsed:${oid}`;
				};
				if ((await scripts(baseFiles.get(path))) !== (await scripts(files.get(path)))) return `the scripts in ${path}`;
			}
		}
		return null;
	}

	/** Verify one candidate: build its commit in a sandbox, choose its tests, run them. */
	private async verify(
		candidate: CandidateView,
		base: string,
		config: RepoConfig,
		baseFiles: Map<string, string>,
		trunkRead: Remote,
	): Promise<Outcome> {
		const { name, branch } = this.repo;
		const row = this.sql.exec<{ attempts: number }>("SELECT attempts FROM candidates WHERE id = ?", candidate.id).one();
		const { thread, screen, allowProtected } = this.record(candidate.id);
		const stub = this.env.VERIFIER.getByName(`${name}/${candidate.id}/${row.attempts}`);
		const forkWrite = await remoteFor(artifactsOf(this.env), candidate.fork, "write", 1800);

		try {
			const prepared = await stub.prepare({
				candidateId: candidate.id,
				forkUrl: authenticatedUrl(forkWrite),
				trunkUrl: authenticatedUrl(trunkRead),
				branch,
				ref: candidate.ref,
				expectHead: candidate.head,
				base,
				message: commitMessage(candidate.id, thread, screen),
				author: agentIdentity(candidate.agent),
			});
			if (!prepared.ok) {
				const detail = { message: prepared.detail, conflicts: prepared.conflicts, steps: prepared.steps.slice(-4) };
				if (prepared.reason === "trunk-moved" || prepared.reason === "sandbox-error") {
					return { kind: "retry", reason: prepared.reason, detail };
				}
				return { kind: "rejected", reason: prepared.reason, detail, paths: prepared.conflicts ?? [] };
			}

			// Fetch the commit the sandbox built and check it is what it says it is.
			const fetched = await this.git((ws) =>
				fetchCandidate(ws, { fork: forkWrite, candidateRef: prepared.ref, expectOid: prepared.commit, expectBase: base }),
			);
			if (!fetched.ok) {
				return { kind: "retry", reason: "verification-mismatch", detail: { message: fetched.detail } };
			}
			const paths = fetched.changes.map((change) => change.path);
			this.event(candidate.id, "candidate.prepared", { commit: fetched.oid, changed: paths, bootMs: prepared.bootMs });

			const files = await this.git((ws) => listFiles(ws, fetched.oid));
			if (!allowProtected) {
				const protectedPath = await this.protectedChange(paths, baseFiles, files);
				if (protectedPath) {
					return {
						kind: "rejected",
						reason: "protected-path",
						detail: {
							message: `${protectedPath} decides how changes are tested, and this task was not given permission to change it`,
						},
						paths: [],
					};
				}
			}

			// How much testing does this change need?
			const stats = new Map(prepared.stats.map((stat) => [stat.path, stat]));
			const summary: ChangeSummary = {
				task: thread.task,
				files: paths.map((path) => ({
					path,
					added: stats.get(path)?.added ?? 0,
					deleted: stats.get(path)?.deleted ?? 0,
					hunks: stats.get(path)?.hunks,
				})),
			};
			const risk = await assessRisk(clefOf(this.env), summary);

			// Which tests can it affect?
			let selection = await this.getTargeter().select(
				files,
				fetched.changes.map((change) => ({ path: change.path, deleted: change.oid === null })),
				config,
			);
			if (risk.scope === "full" && selection.mode === "targeted") {
				selection = { mode: "full", reason: risk.reason, tests: [], totalTests: selection.totalTests, reach: null };
			}
			this.event(candidate.id, "candidate.selected", {
				risk: { tier: risk.tier, scope: risk.scope, reason: risk.reason, probabilities: risk.probabilities },
				tests: { mode: selection.mode, reason: selection.reason, selected: selection.mode === "full" ? selection.totalTests : selection.tests.length, total: selection.totalTests },
			});

			let tests: TestResult = { ok: true, durationMs: 0, steps: [] };
			const needsRun = selection.mode === "full" || selection.tests.length > 0;
			if (needsRun) {
				tests = await stub.runTests({
					commit: fetched.oid,
					install: config.install,
					command: config.test,
					files: selection.mode === "full" ? null : selection.tests,
				});
				if (!tests.ok) {
					if (tests.failedStep === "sandbox") {
						return { kind: "retry", reason: "sandbox-error", detail: { message: "the sandbox failed while running tests", steps: tests.steps } };
					}
					const failed = tests.steps[tests.steps.length - 1];
					return {
						kind: "rejected",
						reason: tests.failedStep === "install" ? "install-failed" : "tests-failed",
						detail: {
							message:
								tests.failedStep === "install"
									? "installing dependencies failed"
									: `tests failed (${selection.mode === "full" ? "full suite" : `${selection.tests.length} of ${selection.totalTests} test files`})`,
							risk,
							tests: { mode: selection.mode, files: selection.tests, total: selection.totalTests },
							output: failed ? { stdout: failed.stdout, stderr: failed.stderr, exitCode: failed.exitCode } : null,
						},
						paths,
					};
				}
			}

			return {
				kind: "verified",
				commit: fetched.oid,
				base,
				changes: fetched.changes,
				message: fetched.message,
				author: fetched.author,
				risk,
				selection,
				tests: { ran: needsRun, durationMs: tests.durationMs, steps: tests.steps },
				bootMs: prepared.bootMs,
			};
		} finally {
			await stub.release().catch(() => undefined);
		}
	}
}

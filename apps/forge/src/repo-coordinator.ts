import { DurableObject } from 'cloudflare:workers';
import {
	cost,
	assessRequest,
	blockingFailures,
	brokeMainNotice,
	checksTone,
	describeChecks,
	compactThreshold,
	maxSimilarCandidates,
	type Assessment,
	models,
	modes,
	type DoneWhenReport,
	type Intent,
	type Step,
	type DeployResponse,
	type ServiceInfo,
	type Suggestion,
	type Usage
} from '@regit/agent';
import type {
	AgentActivity,
	Author,
	CheckResult,
	CheckRun,
	Culprit,
	LandedCommit,
	DeploySecret,
	Entry,
	Failure,
	RetryFailure,
	DiffFile,
	DiffSummary,
	LiveMessage,
	MainStatus,
	Machine,
	Mode,
	ModeChoice,
	Ship,
	ShipProgress,
	RepoCoordinatorApi,
	ShipInput,
	StartupStage,
	ThreadActivity,
	ThreadChild,
	ThreadDetail,
	ThreadEvent,
	ThreadOverlap,
	ThreadService,
	ThreadStatus,
	ThreadSummary,
	ThreadUsage,
	ToolCallRecord,
	UsageRow,
	Verdict,
	VerifyStage
} from '@regit/core';
import {
	defaultMachine,
	deploySecretName,
	describeTrigger,
	idlePhase,
	maxDeploySecretBytes,
	needsYou,
	normalizeAutomation,
	threadPurgeDelayMs
} from '@regit/core';
import { canAccessRepository } from '@regit/db';
import { db } from './db.ts';
import { retrying, RetriesExhausted } from './retrying.ts';
import { Images } from './images.ts';
import { Automations, type DueAutomation } from './automations.ts';
import { initializeThreadNumbers } from './thread-numbers.ts';
import type { AttemptStatus } from './attempt-sandbox.ts';
import type { Landing } from './landing.ts';
import { seal, type Sealed } from './secrets.ts';
import type { Verified } from './verify-main.ts';

export type AttemptUpdate =
	| { type: 'step'; step: Step & { checkpoint?: string }; model: string; tools?: ToolCallRecord[] }
	| { type: 'status'; status: AttemptStatus; error: string | null; failures?: RetryFailure[] }
	| { type: 'recovered'; failures: RetryFailure[] }
	| { type: 'activity'; activity: AgentActivity }
	| { type: 'startup'; stages: StartupStage[] }
	| { type: 'read'; entries: string[] }
	| { type: 'changes'; tree: string | null; summary: DiffSummary; paths: string[] }
	| { type: 'services'; services: ServiceInfo[]; preview: string }
	| { type: 'usage'; task: UsageRow['task']; model: string; usage: Usage[] }
	| { type: 'behind'; behind: ThreadSummary['behind']; branch: string }
	| { type: 'checks'; run: CheckRun };

type ThreadRow = {
	id: string;
	number: number;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	auto: number | null;
	machine: Machine | null;
	updated_at: number;
	reopen_status: ThreadStatus | null;
	deleted_at: number | null;
	deleted_by: string | null;
	changes: string | null;
	shipped_sha: string | null;
	shipped_by: string | null;
	shipped_at: number | null;
	parent: string | null;
	context: string | null;
	services: string | null;
	preview: string | null;
	behind: string | null;
	failure: string | null;
	paths: string | null;
	overlaps: string | null;
	checks: string | null;
	verdict: Verdict | null;
	unmet: number | null;
	parent_headline?: string | null;
	parent_number?: number | null;
};

// Commits a thread shipped since it broke main, its fix attempts, and the latest fix still to be checked.
type Fixing = {
	commits: Omit<Culprit, 'thread'>[];
	fixes: number;
	fixed: string | null;
	reverting: string | null;
};

const agent: Author = { name: 'ReGit', kind: 'agent' };
const shipSteps: Record<ShipProgress['stage'], string> = {
	starting: 'Ship',
	fetching: 'Fetch',
	building: 'Build',
	pushing: 'Push',
	recording: 'Provenance'
};
const maxThreadMessages = 5;
const maxHandBacks = 3;
const maxFixes = 1;
const verdictNotes: Record<ThreadEvent, string> = {
	shipped: 'landed on main',
	passed: "passed main's checks",
	failed: "failed main's checks",
	deployed: 'deployed',
	reverted: 'was reverted'
};
const emptyMain: MainStatus = {
	branch: null,
	verifying: null,
	waiting: [],
	verified: null,
	green: null,
	deployed: null,
	deployFailure: null,
	failure: null
};
const similarTimeoutMs = 4000;
const similarMaxAgeMs = 30 * 24 * 60 * 60 * 1000;
const recentHistory = 12;
const maxSearchHits = 30;
const maxDiffChars = 20_000;
const maxDeployOutput = 4_000;
const pastTense: Record<string, string> = {
	read_file: 'Read',
	write_file: 'Wrote',
	edit_file: 'Edited',
	find_files: 'Found files',
	search: 'Searched for',
	run: 'Ran',
	ask_threads: 'Asked about threads:',
	message_thread: 'Messaged thread',
	create_automation: 'Set up automation',
	cancel_automation: 'Cancelled automation'
};

function verdictNotice(
	verdict: 'passed' | 'deployed' | 'reverted',
	sha: string,
	branch: string,
	revert?: string
) {
	const short = sha.slice(0, 7);
	if (verdict === 'passed')
		return `What this thread shipped as ${short} passed \`${branch}\`'s deploy checks.`;
	if (verdict === 'deployed') return `What this thread shipped as ${short} is deployed.`;
	const where = revert ? ` in ${revert.slice(0, 7)}` : '';
	return `What this thread shipped as ${short} broke \`${branch}\`'s deploy checks, so it was reverted${where} and is no longer on \`${branch}\`.`;
}

function parentVerdictNotice(
	verdict: 'passed' | 'deployed' | 'reverted',
	sha: string,
	branch: string,
	revert?: string
) {
	const short = sha.slice(0, 7);
	if (verdict === 'passed') return `passed \`${branch}\`'s deploy checks with \`${short}\`.`;
	if (verdict === 'deployed') return `is live as \`${short}\`.`;
	const where = revert ? ` in \`${revert.slice(0, 7)}\`` : '';
	return `broke \`${branch}\`'s deploy checks with \`${short}\` and was reverted${where}.`;
}

function deployFailedNotice(shipped: string, sha: string, branch: string, output: string) {
	const tail = output.length > maxDeployOutput ? `…${output.slice(-maxDeployOutput)}` : output;
	return `What this thread shipped as ${shipped.slice(0, 7)} passed \`${branch}\`'s deploy checks, but deploying ${sha.slice(0, 7)}, which includes it, failed, so it isn't live:\n\n${tail}`;
}

function historyLines(entries: Entry[]) {
	return entries
		.flatMap((entry): string[] => {
			if (entry.type === 'message') return [`${entry.author.name}: ${entry.text}`];
			if (entry.type === 'thread-message') {
				const way = entry.direction === 'in' ? 'From' : 'To';
				return [`${way} thread ${entry.thread} (${entry.headline || 'New thread'}): ${entry.text}`];
			}
			if (entry.type === 'event') return [`· ${entry.text}`];
			if (entry.type === 'automation') return [`Automation "${entry.name}": ${entry.text}`];
			if (entry.type === 'failure') return [`· ${entry.title}: ${entry.error}`];
			if (entry.type === 'intent')
				return [`Intent: ${entry.intent.headline} — ${entry.intent.purpose}`];
			if (entry.type === 'suggestion') return [`Suggested a thread: ${entry.intent.headline}`];
			if (entry.type === 'tools') {
				const calls = entry.calls.map((call) =>
					`${pastTense[call.tool] ?? call.tool} ${call.target}${call.status === 'failed' ? ' (failed)' : ''}`.trim()
				);
				const lines = calls.length ? [`ReGit: ${calls.join('; ')}`] : [];
				if (entry.checkpoint) lines.push(`· Checkpoint ${entry.checkpoint.slice(0, 7)}`);
				return lines;
			}
			return [];
		})
		.map((line, index, all) => {
			const text = line.length > 500 ? `${line.slice(0, 500)}…` : line;
			return `#${index + 1} of ${all.length}: ${text}`;
		});
}

function renderDiff(file: DiffFile) {
	const header = `--- ${file.path} (${file.change}, +${file.additions} −${file.deletions})`;
	if (file.binary || file.tooLarge)
		return `${header}\n(${file.binary ? 'binary' : 'too large to show'})`;
	const prefix = { context: ' ', added: '+', removed: '-' };
	const hunks = file.hunks.map((hunk) =>
		[
			`@@ ${hunk.context ?? ''}`.trimEnd(),
			...hunk.lines.map((line) => `${prefix[line.kind]}${line.text}`)
		].join('\n')
	);
	return [header, ...hunks].join('\n');
}

// Lockfiles conflict whenever two threads change dependencies, and regenerating them resolves it.
const regenerated =
	/(^|\/)(bun\.lockb?|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock|Gemfile\.lock|composer\.lock|flake\.lock)$/;

function startPrompt({ headline, purpose, doneWhen }: Intent) {
	const checks = doneWhen.map((check) => `- ${check}`).join('\n');
	return `Work on this thread's intent.\n\n${headline}\n\n${purpose}${checks && `\n\nDone when:\n${checks}`}`;
}

function describeIntent({ headline, purpose, doneWhen }: Intent) {
	const checks = doneWhen.length ? ` Done when: ${doneWhen.join('; ')}` : '';
	return `${headline} — ${purpose}${checks}`;
}

export class RepoCoordinator extends DurableObject<Env> implements RepoCoordinatorApi {
	#sql = this.ctx.storage.sql;
	#activities = new Map<string, ThreadActivity>();
	#images = new Images(this.#sql);
	#automations = new Automations(this.#sql);
	#overlapChecks: Promise<void> = Promise.resolve();

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY,
				headline TEXT NOT NULL,
				status TEXT NOT NULL,
				mode TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				reopen_status TEXT,
				deleted_at INTEGER,
				deleted_by TEXT,
				machine TEXT,
				changes TEXT,
				shipped_sha TEXT,
				shipped_by TEXT,
				shipped_at INTEGER,
				parent TEXT,
				context TEXT,
				services TEXT,
				preview TEXT,
				auto INTEGER,
				behind TEXT,
				failure TEXT,
				paths TEXT,
				overlaps TEXT,
				checks TEXT,
				verdict TEXT
			);
			CREATE TABLE IF NOT EXISTS entries (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				thread TEXT NOT NULL,
				body TEXT NOT NULL
			);
			CREATE INDEX IF NOT EXISTS entries_by_thread ON entries (thread, seq);
			CREATE TABLE IF NOT EXISTS usage (
				seq INTEGER PRIMARY KEY AUTOINCREMENT,
				thread TEXT NOT NULL,
				task TEXT NOT NULL,
				model TEXT NOT NULL,
				input_tokens INTEGER NOT NULL,
				cached_input_tokens INTEGER NOT NULL,
				cache_write_tokens INTEGER NOT NULL,
				output_tokens INTEGER NOT NULL,
				at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS usage_by_thread ON usage (thread, seq);
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS ships (
				sha TEXT PRIMARY KEY,
				thread TEXT NOT NULL,
				headline TEXT NOT NULL,
				at INTEGER NOT NULL,
				reverted INTEGER NOT NULL DEFAULT 0
			);
			CREATE INDEX IF NOT EXISTS ships_by_thread ON ships (thread);
			CREATE TABLE IF NOT EXISTS deploy_secrets (
				name TEXT PRIMARY KEY,
				iv TEXT NOT NULL,
				value TEXT NOT NULL,
				updated_at INTEGER NOT NULL,
				updated_by TEXT NOT NULL
			);
			DROP TABLE IF EXISTS promotions;
		`);
		// TODO: remove once every repository's coordinator has these columns.
		for (const column of ['failure', 'paths', 'overlaps', 'checks', 'verdict']) {
			try {
				this.#sql.exec(`ALTER TABLE threads ADD COLUMN ${column} TEXT`);
			} catch {
				/* Already added. */
			}
		}
		// TODO: remove once every repository's coordinator has recorded its earlier ships.
		this.#sql.exec(
			'INSERT OR IGNORE INTO ships (sha, thread, headline, at) SELECT shipped_sha, id, headline, shipped_at FROM threads WHERE shipped_sha IS NOT NULL AND shipped_at IS NOT NULL'
		);
		this.ctx.storage.transactionSync(() => initializeThreadNumbers(this.#sql));
		// Live connections ping to tell a dead socket from a quiet one; the runtime answers without waking this object.
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
		// TODO: remove once no coordinator has threads in the removed draft and reviewing statuses.
		this.#sql.exec(`
			UPDATE threads SET status = 'idle' WHERE status IN ('draft', 'reviewing');
			UPDATE threads SET reopen_status = 'idle' WHERE reopen_status IN ('draft', 'reviewing');
		`);
		// TODO: remove once no coordinator has threads in the renamed discarded status.
		this.#sql.exec("UPDATE threads SET status = 'archived' WHERE status = 'discarded'");
		// TODO: remove once no coordinator has threads in the renamed running and needs-you statuses.
		this.#sql.exec(`
			UPDATE threads SET status = 'working' WHERE status = 'running';
			UPDATE threads SET status = 'idle' WHERE status = 'needs-you';
			UPDATE threads SET reopen_status = 'working' WHERE reopen_status = 'running';
			UPDATE threads SET reopen_status = 'idle' WHERE reopen_status = 'needs-you';
		`);
		// TODO: remove once every repository's coordinator has the unmet column.
		try {
			this.#sql.exec('ALTER TABLE threads ADD COLUMN unmet INTEGER NOT NULL DEFAULT 0');
			for (const { id } of this.#sql.exec<{ id: string }>('SELECT id FROM threads').toArray()) {
				const entry = this.#latestIntentEntry(id);
				if (entry) this.#countUnmet(id, entry);
			}
		} catch {
			/* Already added. */
		}
	}

	async openThread({
		repo,
		author,
		text,
		mode,
		machine
	}: {
		repo: string;
		author: Author;
		text: string;
		mode: ModeChoice;
		machine: Machine;
	}): Promise<ThreadSummary> {
		const auto = mode === 'auto';
		const size = auto ? ((await this.#assess(text))?.size ?? 'medium') : mode;
		this.#sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING',
			'repo',
			repo
		);
		const id = this.#createThread({ headline: headlineFrom(text), mode: size, auto, machine });
		const entry = this.#add(id, { type: 'message', author, text });
		await this.#converse(id, author, text, entry);
		return this.#summary(id)!;
	}

	async reply(thread: string, { author, text }: { author: Author; text: string }) {
		const summary = this.#active(thread);
		const steering = summary.status === 'working';
		const entry = this.#add(thread, {
			type: 'message',
			author,
			text,
			...(steering && { steering: { read: false } })
		});
		if (summary.status === 'archived') return;
		if (['idle', 'shipped'].includes(summary.status)) this.#setStatus(thread, 'working');
		await this.#converse(thread, author, text, entry);
	}

	async bringUpToDate(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status === 'archived') return;
		const entry = this.#add(thread, {
			type: 'event',
			text: `${by.name} asked to bring this thread up to date with ${await this.#branch()}`
		});
		if (['idle', 'shipped'].includes(summary.status)) this.#setStatus(thread, 'working');
		await this.#converse(
			thread,
			by,
			`Bring this thread up to date with ${await this.#branch()}.`,
			entry,
			true
		);
	}

	async archive(thread: string, by: Author) {
		const summary = this.#active(thread);
		await this.#notShipping(thread);
		await this.#dropHandBack(thread, `${by.name} archived this thread before it fixed them`);
		if (summary.status === 'archived') return;
		const reopen = ['working', 'shipping'].includes(summary.status) ? 'idle' : summary.status;
		this.#sql.exec('UPDATE threads SET reopen_status = ? WHERE id = ?', reopen, thread);
		this.#add(thread, { type: 'event', text: `Archived by ${by.name}` });
		this.#setStatus(thread, 'archived');
		this.#automations.endThread(thread, Date.now());
		this.#checkOverlaps(thread);
		await this.#agent(thread).cancel();
	}

	reopen(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status !== 'archived') return;
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'reopen_status'>>(
				'SELECT reopen_status FROM threads WHERE id = ?',
				thread
			)
			.toArray();
		this.#add(thread, { type: 'event', text: `Reopened by ${by.name}` });
		this.#setStatus(thread, row?.reopen_status ?? 'idle');
		this.#checkOverlaps(thread);
	}

	// TODO: once threads ship, keep a tombstone (headline, author, commit) instead of purging shipped threads
	async delete(thread: string, by: Author) {
		this.#active(thread);
		await this.#notShipping(thread);
		await this.#dropHandBack(thread, `${by.name} deleted this thread before it fixed them`);
		this.#sql.exec(
			'UPDATE threads SET deleted_at = ?, deleted_by = ? WHERE id = ?',
			Date.now(),
			by.name,
			thread
		);
		this.#automations.endThread(thread, Date.now());
		this.#touch(thread);
		await this.#scheduleAlarm();
		this.#checkOverlaps(thread);
		await this.#agent(thread).cancel();
	}

	async stop(thread: string, by: Author) {
		const summary = this.#active(thread);
		await this.#notShipping(thread);
		await this.#dropHandBack(thread, `${by.name} stopped this thread before it fixed them`);
		await this.#agent(thread).stop(by.name);
		const pending = this.#sql
			.exec<{ seq: number; body: string }>('SELECT seq, body FROM entries WHERE thread = ?', thread)
			.toArray()
			.filter((row) => {
				const entry = JSON.parse(row.body) as Entry;
				return entry.type === 'message' && entry.steering?.read === false;
			});
		for (const row of pending) this.#markRead(thread, `e${row.seq}`);
		this.#add(thread, { type: 'event', text: `Stopped by ${by.name}` });
		if (['working', 'shipping'].includes(summary.status)) {
			this.#setStatus(thread, 'idle');
		}
	}

	async resume(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status !== 'idle' || !summary.failure?.resumable) return;
		this.#add(thread, { type: 'event', text: `${by.name} asked the agent to try again` });
		this.#setStatus(thread, 'working');
		try {
			await retrying('Agent', () => this.#agent(thread).resume());
		} catch (error) {
			this.#unreachable(thread, error);
			throw error;
		}
	}

	async retryNow(thread: string) {
		this.#active(thread);
		await retrying('Agent', () => this.#agent(thread).retryNow());
	}

	restore(thread: string) {
		this.#require(thread);
		this.#sql.exec('UPDATE threads SET deleted_at = NULL, deleted_by = NULL WHERE id = ?', thread);
		this.#touch(thread);
		this.#checkOverlaps(thread);
	}

	override async alarm() {
		const due = this.#sql
			.exec<{ id: string }>(
				'SELECT id FROM threads WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
				Date.now() - threadPurgeDelayMs
			)
			.toArray();
		for (const { id } of due) {
			await this.#agent(id).destroy();
			this.#images.purge(id);
			this.#automations.purge(id);
			this.#sql.exec('DELETE FROM entries WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM usage WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM ships WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM threads WHERE id = ?', id);
		}
		await this.#runAutomations();
		await this.#scheduleAlarm();
	}

	saveImage(thread: string, dataUrl: string) {
		this.#active(thread);
		return this.ctx.storage.transactionSync(() => this.#images.put(thread, dataUrl));
	}

	image(id: string) {
		return this.#images.get(id);
	}

	threads(): ThreadSummary[] {
		return this.#sql
			.exec<ThreadRow>(`${selectThreads} WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC`)
			.toArray()
			.map(toSummary);
	}

	children(id: string): ThreadChild[] {
		return this.#sql
			.exec<ThreadRow>(
				`${selectThreads} WHERE t.parent = ? AND t.deleted_at IS NULL ORDER BY t.number`,
				id
			)
			.toArray()
			.map((row) => {
				const intent = this.#latestIntentEntry(row.id);
				return {
					summary: toSummary(row),
					doneWhen: intent
						? {
								met: intent.intent.doneWhen.filter((check) => {
									const result = intent.results?.[check];
									return result?.status === 'met' && !result.stale;
								}).length,
								total: intent.intent.doneWhen.length
							}
						: null,
					previews: this.#services(row.id)
						.filter((service) => service.status === 'running' && service.preview)
						.map((service) => ({ name: service.name, url: service.preview }))
				};
			});
	}

	otherThreads(from: string) {
		return this.threads()
			.filter((thread) => thread.id !== from && thread.status !== 'archived')
			.map(({ id, number, headline, status }) => ({ id, number, headline, status }));
	}

	async createAutomation(thread: string, spec: unknown) {
		const summary = this.#active(thread);
		if (summary.status === 'archived') throw new Error('This thread is archived');
		const now = Date.now();
		const automation = this.#automations.create(thread, normalizeAutomation(spec, now), now);
		this.#touch(thread);
		await this.#scheduleAlarm();
		return automation;
	}

	automations(thread: string) {
		this.#require(thread);
		return this.#automations.list(thread);
	}

	async cancelAutomation(thread: string, id: string, by: Author) {
		this.#require(thread);
		const was = this.#automations.get(thread, id);
		const automation = this.#automations.cancel(thread, id, by.name, Date.now());
		if (was && !was.ended && by.kind === 'person')
			this.#add(thread, {
				type: 'event',
				text: `${by.name} cancelled the automation "${automation.name}"`
			});
		this.#touch(thread);
		await this.#scheduleAlarm();
		return automation;
	}

	async messageThread(from: string, to: string, text: string) {
		if (from === to) throw new Error('That is this thread');
		const sender = this.#active(from);
		const recipient = this.#summary(to);
		if (!recipient || recipient.deleted) throw new Error(`There is no thread ${to}`);
		const steering = recipient.status === 'working';
		if (['archived', 'shipping'].includes(recipient.status)) {
			throw new Error(`Thread ${to} is ${recipient.status}. Tell your person instead.`);
		}
		if (
			!this.#relatives(to).has(from) &&
			this.#threadMessagesSincePerson(to) >= maxThreadMessages
		) {
			throw new Error(
				`Thread ${to} has had ${maxThreadMessages} thread messages since a person last wrote there. Ask your person before sending more.`
			);
		}
		this.#add(from, {
			type: 'thread-message',
			direction: 'out',
			thread: to,
			number: recipient.number,
			headline: recipient.headline,
			text
		});
		const entry = this.#add(to, {
			type: 'thread-message',
			direction: 'in',
			thread: from,
			number: sender.number,
			headline: sender.headline,
			text,
			...(steering && { steering: { read: false } })
		});
		const author = {
			name: `Thread #${sender.number} (${sender.headline || 'New thread'})`,
			kind: 'agent' as const
		};
		if (['idle', 'shipped'].includes(recipient.status)) this.#setStatus(to, 'working');
		await this.#converse(to, author, text, entry);
		return steering
			? 'Delivered. Its agent reads it at its next step.'
			: 'Delivered. Its agent will reply in this thread.';
	}

	async threadDigest(id: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const entries = this.#entries(id);
		const history = historyLines(entries);
		const intent = entries.findLast((entry) => entry.type === 'intent');
		const files = await this.changes(id).catch(() => null);
		const running = this.#services(id).filter((service) => service.status === 'running');
		const lines = [
			`#${summary.number} (${id}) · ${summary.status} · ${summary.headline || 'New thread'}`
		];
		if (intent?.type === 'intent') {
			lines.push(`Intent: ${intent.intent.purpose}`, 'Done when:');
			for (const check of intent.intent.doneWhen) {
				const result = intent.results?.[check];
				const status = result
					? `${result.status}${result.stale ? ', files changed since' : ''}`
					: '';
				lines.push(`- ${check}${status && ` (${status}: ${result!.evidence})`}`);
			}
		}
		if (summary.shipped) {
			lines.push(`Shipped in ${summary.shipped.sha.slice(0, 7)} by ${summary.shipped.by}`);
		}
		if (files?.length) {
			lines.push('Changed files:');
			for (const file of files) {
				lines.push(`- ${file.path} (${file.change}, +${file.additions} −${file.deletions})`);
			}
		}
		if (running.length)
			lines.push(`Running services: ${running.map((service) => service.name).join(', ')}`);
		const recent = history.slice(-recentHistory);
		lines.push(
			`Recent history (${recent.length} of ${history.length}; search_thread finds older entries):`,
			...recent
		);
		return lines.join('\n');
	}

	searchThread(id: string, query: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const history = historyLines(this.#entries(id));
		const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
		const hits = history.filter((line) => terms.every((term) => line.toLowerCase().includes(term)));
		if (!hits.length) return `No matches in ${history.length} entries.`;
		const shown = hits.slice(-maxSearchHits);
		const more = hits.length - shown.length;
		return [
			`${hits.length} matches in ${history.length} entries${more ? ` (showing the latest ${shown.length})` : ''}:`,
			...shown
		].join('\n');
	}

	async threadDiff(id: string, path?: string) {
		const summary = this.#summary(id);
		if (!summary || summary.deleted) return `There is no thread ${id}`;
		const files = ((await this.changes(id).catch(() => null)) ?? []).filter(
			(file) =>
				!path || file.path === path || file.oldPath === path || file.path.endsWith(`/${path}`)
		);
		if (!files.length) return path ? `No changes to ${path}.` : 'No changes.';
		const text = files.map(renderDiff).join('\n');
		return text.length > maxDiffChars ? `${text.slice(0, maxDiffChars)}\n… truncated` : text;
	}

	#threadMessagesSincePerson(thread: string) {
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq DESC', thread)
			.toArray();
		const relatives = this.#relatives(thread);
		let count = 0;
		for (const row of rows) {
			const entry = JSON.parse(row.body) as Entry;
			if (entry.type === 'message' && entry.author.kind === 'person') break;
			if (
				entry.type === 'thread-message' &&
				entry.direction === 'in' &&
				!relatives.has(entry.thread)
			)
				count++;
		}
		return count;
	}

	// A thread's parent and children coordinate freely; the message limit is for unrelated threads.
	#relatives(thread: string) {
		const rows = this.#sql
			.exec<{
				id: string;
			}>(
				'SELECT parent AS id FROM threads WHERE id = ? AND parent IS NOT NULL UNION SELECT id FROM threads WHERE parent = ?',
				thread,
				thread
			)
			.toArray();
		return new Set(rows.map((row) => row.id));
	}

	resolveThread(ref: string): Pick<ThreadSummary, 'id' | 'number'> | null {
		const byId = this.#sql
			.exec<{ id: string; number: number }>('SELECT id, number FROM threads WHERE id = ?', ref)
			.toArray()[0];
		if (byId) return byId;
		if (!/^\d+$/.test(ref)) return null;
		const number = Number(ref);
		if (!Number.isSafeInteger(number) || number < 1) return null;
		return (
			this.#sql
				.exec<{ id: string; number: number }>(
					'SELECT id, number FROM threads WHERE number = ?',
					number
				)
				.toArray()[0] ?? null
		);
	}

	async thread(id: string): Promise<ThreadDetail | null> {
		const summary = this.#summary(id);
		if (!summary) return null;
		if (summary.deleted) {
			return {
				summary,
				branch: await this.#branch(),
				entries: [],
				usage: this.#usage(id, summary.mode, []),
				services: [],
				automations: [],
				activity: null
			};
		}
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', id)
			.toArray();
		return {
			summary,
			branch: await this.#branch(),
			entries: rows.map((row) => {
				const entry = JSON.parse(row.body) as Entry;
				if (entry.type === 'thread-message') {
					entry.number ??= this.resolveThread(entry.thread)?.number;
				} else if (entry.type === 'suggestion' && entry.outcome?.kind === 'spun-off') {
					entry.outcome.number ??= this.resolveThread(entry.outcome.thread)?.number;
				}
				return entry;
			}),
			usage: this.#usage(id, summary.mode),
			services: this.#services(id),
			automations: this.#automations.list(id),
			activity: this.#activities.get(id) ?? null
		};
	}

	async intentProposed(thread: string, intent: Intent) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted) return;
		if (summary.status === 'archived') return;
		const previous = this.#latestIntentEntry(thread)?.results ?? {};
		const results = Object.fromEntries(
			intent.doneWhen.flatMap((check) => (previous[check] ? [[check, previous[check]]] : []))
		);
		const id = this.#add(thread, {
			type: 'intent',
			intent,
			...(Object.keys(results).length && { results })
		});
		this.#sql.exec('UPDATE threads SET headline = ? WHERE id = ?', intent.headline, thread);
		this.#touch(thread);
		const similar = (await this.#assess(describeIntent(intent), thread))?.similar;
		if (similar?.length) this.#replace(thread, { ...this.#entry(thread, id)!, similar } as Entry);
	}

	doneWhenRecorded(thread: string, reports: DoneWhenReport[], tree: string | null) {
		const entry = this.#latestIntentEntry(thread);
		if (!entry) return 'Error: Record the intent with update_intent first.';
		const { doneWhen } = entry.intent;
		const unknown = reports.filter(({ check }) => !doneWhen[check - 1]).map(({ check }) => check);
		if (unknown.length)
			return `Error: The intent has ${doneWhen.length} done-when checks, numbered from 1; there is no check ${unknown.join(', ')}.`;
		const results = { ...entry.results };
		for (const { check, status, evidence } of reports)
			results[doneWhen[check - 1]!] = { status, evidence, at: Date.now(), tree };
		this.#update(thread, { ...entry, results });
		return 'Recorded.';
	}

	intent(thread: string) {
		return this.#latestIntent(thread) ?? null;
	}

	#staleResults(thread: string, tree: string | null) {
		const entry = this.#latestIntentEntry(thread);
		if (!entry?.results) return;
		const changed = Object.entries(entry.results).filter(
			([, result]) => !result.stale && (!tree || result.tree !== tree)
		);
		if (!changed.length) return;
		const results = { ...entry.results };
		for (const [check, result] of changed) results[check] = { ...result, stale: true };
		this.#update(thread, { ...entry, results });
	}

	async assess(text: string) {
		return (await this.#assess(text)) ?? { similar: [], size: 'medium' as const };
	}

	async forwardIntent(thread: string, to: string, by: Author) {
		const intent = this.#entries(thread).findLast((entry) => entry.type === 'intent');
		if (intent?.type !== 'intent') throw new Error('This thread has no intent to share');
		return this.messageThread(
			thread,
			to,
			`${by.name} found that this thread has the same goal as yours: ${describeIntent(intent.intent)}`
		);
	}

	async #assess(text: string, exclude?: string): Promise<Assessment | null> {
		const since = Date.now() - similarMaxAgeMs;
		const candidates = this.threads()
			.filter((thread) => thread.id !== exclude && thread.headline)
			.slice(0, maxSimilarCandidates)
			.map((thread) => {
				const intent = this.#entries(thread.id).findLast((entry) => entry.type === 'intent');
				return {
					id: thread.id,
					headline: thread.headline,
					...((thread.status === 'archived' || thread.updatedAt < since) && { inactive: true }),
					...(intent?.type === 'intent' && {
						purpose: intent.intent.purpose,
						doneWhen: intent.intent.doneWhen
					})
				};
			});
		try {
			return await Promise.race([
				assessRequest(
					(request) => this.env.MODELS.decide(request, { repo: this.#repo() }),
					text,
					candidates
				),
				new Promise<never>((_, reject) =>
					setTimeout(() => reject(new Error('Assessing the request timed out')), similarTimeoutMs)
				)
			]);
		} catch (error) {
			console.warn('Could not assess the request', error);
			return null;
		}
	}

	#entries(thread: string) {
		return this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', thread)
			.toArray()
			.map((row) => JSON.parse(row.body) as Entry);
	}

	#replace(thread: string, entry: Entry) {
		this.#sql.exec(
			'UPDATE entries SET body = ? WHERE seq = ? AND thread = ?',
			JSON.stringify(entry),
			Number(entry.id.slice(1)),
			thread
		);
		this.#broadcast({ type: 'entry', thread, entry });
	}

	// Starts the thread only when a person asked for it in this thread: the latest one to write is its author.
	async launchThread(thread: string, { context, ...intent }: Suggestion, start: boolean) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted || summary.status === 'archived') return null;
		const entry = this.#add(thread, { type: 'suggestion', intent, context, outcome: null });
		if (!start) return null;
		const requester = this.#entries(thread).findLast(
			(entry) => entry.type === 'message' && entry.author.kind === 'person'
		);
		if (requester?.type !== 'message') return null;
		return (await this.spinOff(thread, entry, requester.author)).id;
	}

	async spinOff(thread: string, entry: string, by: Author) {
		const parent = this.#active(thread);
		const suggestion = this.#entry(thread, entry);
		if (suggestion?.type !== 'suggestion' || suggestion.outcome) {
			throw new Error('That suggestion is no longer open');
		}
		const id = this.#createThread({
			headline: suggestion.intent.headline,
			mode: parent.mode,
			machine: parent.machine,
			parent: thread,
			context: suggestion.context
		});
		if (suggestion.context)
			this.#add(id, { type: 'message', author: agent, text: suggestion.context });
		this.#add(id, { type: 'intent', intent: suggestion.intent });
		const started = this.#add(id, { type: 'event', text: `Started by ${by.name}` });
		this.#update(thread, {
			...suggestion,
			outcome: { kind: 'spun-off', thread: id, number: this.#summary(id)!.number, by: by.name }
		});
		await this.#converse(id, by, startPrompt(suggestion.intent), started).catch(() => {});
		return this.#summary(id)!;
	}

	dismissSuggestion(thread: string, entry: string, by: Author) {
		this.#active(thread);
		const suggestion = this.#entry(thread, entry);
		if (suggestion?.type !== 'suggestion' || suggestion.outcome) return;
		this.#update(thread, { ...suggestion, outcome: { kind: 'dismissed', by: by.name } });
	}

	async serviceAction(thread: string, action: 'start' | 'stop' | 'restart', name: string) {
		this.#active(thread);
		await this.#agent(thread).serviceAction(action, name);
	}

	serviceLogs(thread: string, name: string) {
		this.#active(thread);
		return this.#agent(thread).serviceLogs(name) as Promise<string>;
	}

	changes(thread: string) {
		this.#active(thread);
		return this.#agent(thread).changes() as Promise<DiffFile[] | null>;
	}

	async ship(thread: string, input: ShipInput) {
		const summary = this.#active(thread);
		if (summary.status !== 'idle' || !summary.changes?.files) {
			throw new Error('This thread has nothing ready to ship');
		}
		await this.#owner(input.by);
		await this.#startShip(thread, input, 0);
	}

	async #startShip(thread: string, { by, email, title, body }: ShipInput, handBacks: number) {
		const source = await this.#agent(thread).revision();
		if (!source) throw new Error('This thread has no changes to ship');
		if (this.#active(thread).status !== 'idle') throw new Error('The thread started working again');
		const ship: Ship = {
			id: crypto.randomUUID().replaceAll('-', ''),
			repo: this.#repo(),
			thread,
			source,
			intent: this.#latestIntent(thread) ?? null,
			by,
			email,
			title,
			body,
			handBacks
		};
		this.#setMeta(`ship:${thread}`, ship.id);
		this.#setStatus(thread, 'shipping');
		const now = Date.now();
		this.#setShipProgress(thread, {
			stage: 'starting',
			note: null,
			branch: null,
			since: now,
			started: now
		});
		try {
			await this.env.SHIP_THREAD.create({ id: ship.id, params: ship });
		} catch (error) {
			await this.#stopShipping(thread, error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	shipProgress(ship: Ship, progress: Omit<ShipProgress, 'started' | 'retry'>) {
		if (this.#meta(`ship:${ship.thread}`) !== ship.id) return;
		const current = this.#activities.get(ship.thread)?.ship;
		const started = current?.started ?? progress.since;
		const retry = current?.retry ? { ...current.retry, next: null } : null;
		this.#setShipProgress(ship.thread, { ...progress, started, retry });
	}

	shipRetrying(
		ship: Ship,
		{
			error,
			attempt,
			limit,
			delayMs
		}: { error: string; attempt: number; limit: number; delayMs: number }
	) {
		if (this.#meta(`ship:${ship.thread}`) !== ship.id) return;
		const current = this.#activities.get(ship.thread)?.ship;
		if (!current) return;
		const failures = [
			...(current.retry?.failures ?? []),
			{ at: Date.now(), label: shipSteps[current.stage], error }
		];
		this.#setShipProgress(ship.thread, {
			...current,
			retry: { what: 'ship', failures, attempt, limit, next: Date.now() + delayMs }
		});
	}

	#shipFailures(thread: string) {
		return this.#activities.get(thread)?.ship?.retry?.failures ?? [];
	}

	#setShipProgress(thread: string, ship: ShipProgress | null) {
		const activity = this.#activities.get(thread) ?? { agent: idlePhase, retry: null };
		this.#setActivity(thread, { ...activity, ship });
	}

	async shipped(ship: Ship, { sha, branch }: { sha: string; branch: string }) {
		if (!this.#takeShip(ship)) return;
		const failures = this.#shipFailures(ship.thread);
		if (failures.length) this.#add(ship.thread, { type: 'recovered', failures });
		this.#setShipProgress(ship.thread, null);
		this.#setMeta('branch', branch);
		await this.#agent(ship.thread).published({ sha, branch, from: ship.source.sha });
		this.#sql.exec(
			"UPDATE threads SET changes = NULL, paths = NULL, behind = NULL, shipped_sha = ?, shipped_at = ?, shipped_by = ?, verdict = 'landed' WHERE id = ?",
			sha,
			Date.now(),
			ship.by.name,
			ship.thread
		);
		this.#sql.exec(
			'INSERT OR IGNORE INTO ships (sha, thread, headline, at) VALUES (?, ?, ?, ?)',
			sha,
			ship.thread,
			ship.title,
			Date.now()
		);
		const { by, email, title, body } = ship;
		this.#setMeta(`ship-input:${ship.thread}`, JSON.stringify({ by, email, title, body }));
		this.#sql.exec('DELETE FROM meta WHERE key = ?', `parent-told:${ship.thread}`);
		const fixing = this.#fixing(ship.thread);
		if (fixing)
			this.#saveFixing(ship.thread, {
				...fixing,
				commits: [...fixing.commits, { sha, headline: title }],
				fixed: sha
			});
		this.#setStatus(ship.thread, 'shipped');
		const shipped = `\`${sha.slice(0, 7)}\` to \`${branch}\``;
		this.#add(ship.thread, { type: 'event', text: `Shipped ${shipped}` });
		this.#threadEvent(ship.thread, 'landed');
		await this.#tellParent(ship.thread, `shipped ${shipped}.`);
		this.#checkOverlaps(ship.thread);
		await this.#verify({ sha, headline: title, thread: ship.thread });
	}

	async shipFailed(ship: Ship, message: string) {
		if (!this.#takeShip(ship)) return;
		const failures = this.#shipFailures(ship.thread);
		this.#setShipProgress(ship.thread, null);
		const summary = this.#summary(ship.thread)!;
		const fixable = message.startsWith('Ship conflicts with ');
		if (fixable && ship.handBacks < maxHandBacks && !summary.deleted)
			return await this.#handBack(ship, message);
		const fixing = this.#fixing(ship.thread);
		const reverting = !!fixing?.commits.length && !fixing.reverting;
		await this.#stopShipping(ship.thread, message, failures, !reverting);
		await this.#revert(ship.thread, `the fix couldn't ship: ${message}`);
	}

	// The ship workflow reports once per ship; a ship this thread no longer waits on is ignored.
	#takeShip(ship: Ship) {
		const current = !!this.#summary(ship.thread) && this.#meta(`ship:${ship.thread}`) === ship.id;
		if (current) this.#sql.exec('DELETE FROM meta WHERE key = ?', `ship:${ship.thread}`);
		return current;
	}

	// A ship whose workflow ended without reporting back, or never started, releases the thread.
	async #notShipping(thread: string) {
		if (this.#summary(thread)?.status !== 'shipping') return;
		const id = this.#meta(`ship:${thread}`);
		const ship = id
			? await this.env.SHIP_THREAD.get(id).then(
					(instance) => instance.status(),
					() => null
				)
			: null;
		if (ship && !['errored', 'terminated', 'complete'].includes(ship.status))
			throw new Error('This thread is shipping. Try again when it finishes.');
		await this.#stopShipping(
			thread,
			ship?.error?.message ?? 'the ship ended without reporting back'
		);
	}

	// A fix that couldn't ship leads to a revert, which the agent hears about instead.
	async #stopShipping(thread: string, reason: string, failures: RetryFailure[] = [], tell = true) {
		this.#sql.exec('DELETE FROM meta WHERE key = ?', `ship:${thread}`);
		this.#setShipProgress(thread, null);
		this.#setStatus(thread, 'idle');
		this.#fail(thread, { title: 'Shipping stopped', error: reason, failures }, false);
		if (!tell) return;
		const branch = await this.#branch();
		await this.#notify(
			thread,
			`Shipping this thread stopped before it landed: ${reason}\n\nNothing from this ship reached \`${branch}\`, so this thread's changes still need shipping.`
		);
	}

	// Serious failures stand out in the thread and the thread list until the thread runs again.
	#fail(thread: string, failure: Failure, resumable: boolean) {
		this.#add(thread, { type: 'failure', ...failure, resumable });
		const { title, error } = failure;
		this.#sql.exec(
			'UPDATE threads SET failure = ? WHERE id = ?',
			JSON.stringify({ at: Date.now(), title, error, resumable }),
			thread
		);
		this.#touch(thread);
	}

	#unreachable(thread: string, error: unknown) {
		if (this.#summary(thread)?.status === 'working') this.#setStatus(thread, 'idle');
		const failures = error instanceof RetriesExhausted ? error.failures : [];
		const message = error instanceof Error ? error.message : String(error);
		this.#fail(thread, { title: "Couldn't reach the agent", error: message, failures }, false);
	}

	// Conflicts with main: the thread's agent merges main and the thread ships again.
	async #handBack(ship: Ship, message: string) {
		this.#setMeta(
			`handback:${ship.thread}`,
			JSON.stringify({
				input: { by: ship.by, email: ship.email, title: ship.title, body: ship.body },
				handBacks: ship.handBacks + 1
			})
		);
		const conflict = /^Ship conflicts with (\S+) in (.+)$/.exec(message);
		const files = conflict?.[2]
			?.split(', ')
			.map((file) => `\`${file}\``)
			.join(', ');
		const entry = this.#add(ship.thread, {
			type: 'event',
			text: conflict
				? `Ship conflicts with \`${conflict[1]}\` in ${files}; handed back to the agent to bring up to date`
				: `Couldn't ship: ${message}; handed back to the agent to fix`,
			tone: 'warning'
		});
		this.#setStatus(ship.thread, 'working');
		const commit = `\`${ship.source.sha.slice(0, 7)}\``;
		await this.#tellParent(
			ship.thread,
			conflict
				? `conflicted with \`${conflict[1]}\` while shipping ${commit}; it ships again once its agent brings it up to date.`
				: `couldn't ship ${commit} (${message}); it ships again once its agent fixes that.`
		);
		await this.#converse(
			ship.thread,
			agent,
			conflict
				? `Shipping conflicted with ${conflict[1]}. Bring this thread up to date with it; it ships again once you finish.`
				: 'Shipping stopped. Fix what stopped it; it ships again once you finish.',
			entry,
			!!conflict
		);
	}

	#takeHandBack(thread: string) {
		const [row] = this.#sql
			.exec<{ value: string }>(
				'DELETE FROM meta WHERE key = ? RETURNING value',
				`handback:${thread}`
			)
			.toArray();
		return row && (JSON.parse(row.value) as { input: ShipInput; handBacks: number });
	}

	// A thread put down while fixing what it broke on main won't ship the fix, so what it shipped is reverted.
	async #dropHandBack(thread: string, reason: string) {
		if (this.#takeHandBack(thread)) await this.#revert(thread, reason);
	}

	// Main moved: record how far behind each thread is and warn those that now conflict. Forks only take main when asked or handed back.
	async landed(landing: Landing) {
		const { ref, after } = landing;
		if (ref === `refs/heads/${await this.#branch()}`)
			await this.#verify({ sha: after, headline: landing.headline, thread: null });
		if (this.#meta('main') === after) return;
		const forks = [];
		for (const thread of this.threads()) {
			if (thread.status === 'archived') continue;
			const fork = await this.#agent(thread.id).forkRef();
			if (fork) forks.push({ id: thread.id, ...fork });
		}
		const repo = this.#repo();
		if (!forks.length) return;
		const scan = await this.env.REPOSITORY_GIT.getByName(`scan-${repo}`).compare(repo, forks);
		if (this.#meta('main') === scan.main) return;
		this.#setMeta('main', scan.main);
		this.#setMeta('branch', scan.branch);
		const { branch, headline } = scan;
		for (const { id, behind: commits, conflicts } of scan.threads) {
			const behind = commits ? { branch, commits, sha: scan.main, headline, conflicts } : null;
			this.#setBehind(id, behind);
			await this.#agent(id).behindMain(behind);
		}
	}

	// What main's checks and deploys are doing, as the repository's page shows it.
	main(): MainStatus {
		return { ...emptyMain, ...(JSON.parse(this.#meta('main-status') ?? '{}') as MainStatus) };
	}

	// The newest commit on main whose deploy checks passed, which new threads start from.
	green() {
		return this.main().green?.sha ?? null;
	}

	#setMain(update: Partial<MainStatus>) {
		const main = { ...this.main(), ...update };
		this.#setMeta('main-status', JSON.stringify(main));
		this.#broadcast({ type: 'main', main });
	}

	// Checks a commit that landed on main. One verification runs at a time; of the commits that land meanwhile,
	// only the newest is checked next. A shipped commit arrives twice, from its ship and from the push, in either order.
	async #verify(commit: LandedCommit) {
		const { sha } = commit;
		if (this.#meta('verify-latest') === sha) {
			const { waiting } = this.main();
			if (commit.thread && waiting.some((landed) => landed.sha === sha && !landed.thread))
				this.#setMain({
					waiting: waiting.map((landed) => (landed.sha === sha ? commit : landed))
				});
			return;
		}
		this.#setMeta('verify-latest', sha);
		const running = this.#verification();
		if (running && (await this.#stillVerifying(running.id))) {
			this.#setMeta('verify-next', sha);
			this.#setMain({ waiting: [...this.main().waiting, commit] });
			return;
		}
		await this.#startVerifying(sha);
	}

	async #startVerifying(sha: string) {
		this.#sql.exec("DELETE FROM meta WHERE key = 'verify-next'");
		const id = crypto.randomUUID().replaceAll('-', '');
		const now = Date.now();
		this.#setMeta('verify', JSON.stringify({ id, sha }));
		const verifying = { sha, stage: 'checking' as const, note: null, since: now, started: now };
		this.#setMain({ branch: await this.#branch(), verifying, waiting: [] });
		try {
			const params = { id, repo: this.#repo(), sha, green: this.green() };
			await this.env.VERIFY_MAIN.create({ id, params });
		} catch (error) {
			this.#sql.exec("DELETE FROM meta WHERE key = 'verify'");
			const message = error instanceof Error ? error.message : String(error);
			this.#setMain({ verifying: null, failure: { sha, at: now, error: message } });
		}
	}

	#verification() {
		return JSON.parse(this.#meta('verify') ?? 'null') as { id: string; sha: string } | null;
	}

	// A verification whose workflow ended without reporting back no longer holds up the next one.
	async #stillVerifying(id: string) {
		const instance = await this.env.VERIFY_MAIN.get(id).then(
			(instance) => instance.status(),
			() => null
		);
		return !!instance && !['errored', 'terminated', 'complete'].includes(instance.status);
	}

	async #doneVerifying(id: string) {
		if (this.#verification()?.id !== id) return;
		this.#sql.exec("DELETE FROM meta WHERE key = 'verify'");
		this.#setMain({ verifying: null });
		const next = this.#meta('verify-next');
		if (next) await this.#startVerifying(next);
	}

	verifyProgress(id: string, stage: VerifyStage, note: string | null) {
		const verifying = this.main().verifying;
		if (this.#verification()?.id !== id || !verifying) return;
		this.#setMain({ verifying: { ...verifying, stage, note, since: Date.now() } });
	}

	// Records what main's checks found. Green commits deploy; a commit that broke main goes back to its thread.
	async verified({ id, sha, results, commits, culprit }: Verified) {
		if (this.#verification()?.id !== id) return { deploy: false };
		const passed = !blockingFailures(results).length;
		const at = Date.now();
		const blamed = culprit && { ...culprit, thread: this.#shippedAs(culprit.sha) };
		this.#setMain({
			verified: { sha, at, passed, results, culprit: blamed },
			failure: null,
			...(passed && { green: { sha, at } })
		});
		const proven = passed ? commits : commits.slice(0, culprit ? commits.indexOf(culprit.sha) : 0);
		for (const commit of proven) {
			const thread = this.#latestShip(commit);
			if (!thread) continue;
			await this.#setVerdict(thread, 'passed', ['landed', 'failed']);
			this.#sql.exec('DELETE FROM meta WHERE key = ?', `fixing:${thread}`);
		}
		if (passed) return { deploy: true };
		await this.#doneVerifying(id);
		if (blamed?.thread) await this.#broke(blamed.thread, blamed, results, commits);
		return { deploy: false };
	}

	async deployFinished({
		id,
		sha,
		deploy,
		commits
	}: {
		id: string;
		sha: string;
		deploy: DeployResponse;
		commits: string[];
	}) {
		if (this.#verification()?.id !== id) return;
		const at = Date.now();
		if (deploy.ran && deploy.ok) {
			this.#setMain({ deployed: { sha, at }, deployFailure: null });
			for (const commit of commits) {
				const thread = this.#latestShip(commit);
				if (thread) await this.#setVerdict(thread, 'deployed', ['landed', 'passed']);
			}
		} else if (deploy.ran) {
			this.#setMain({ deployFailure: { sha, at, output: deploy.output } });
			const branch = await this.#branch();
			for (const commit of commits) {
				const thread = this.#latestShip(commit);
				if (thread && this.#summary(thread)?.shipped?.verdict === 'passed')
					await this.#notify(thread, deployFailedNotice(commit, sha, branch, deploy.output));
			}
		}
		await this.#doneVerifying(id);
	}

	async verifyFailed(id: string, error: string) {
		const verification = this.#verification();
		if (verification?.id !== id) return;
		this.#setMain({ failure: { sha: verification.sha, at: Date.now(), error } });
		await this.#doneVerifying(id);
	}

	// The thread that shipped a commit still on main, whichever of its ships it was.
	#shippedAs(sha: string) {
		const [row] = this.#sql
			.exec<{ thread: string }>(
				'SELECT s.thread FROM ships s JOIN threads t ON t.id = s.thread WHERE s.sha = ? AND s.reverted = 0 AND t.deleted_at IS NULL',
				sha
			)
			.toArray();
		return row?.thread ?? null;
	}

	// A thread's verdict describes its latest ship, so only that commit changes it.
	#latestShip(sha: string) {
		const thread = this.#shippedAs(sha);
		return thread && this.#summary(thread)?.shipped?.sha === sha ? thread : null;
	}

	#shipsAfter(thread: string, sha: string, range: string[]) {
		const index = range.indexOf(sha);
		if (index < 0) return [];
		return range
			.slice(index + 1)
			.flatMap((later) =>
				this.#sql
					.exec<Omit<Culprit, 'thread'>>(
						'SELECT sha, headline FROM ships WHERE sha = ? AND thread = ? AND reverted = 0',
						later,
						thread
					)
					.toArray()
			);
	}

	async #setVerdict(thread: string, verdict: Verdict, from?: Verdict[], revert?: string) {
		const shipped = this.#summary(thread)?.shipped;
		const was = shipped?.verdict;
		if (!was || was === verdict || (from && !from.includes(was))) return;
		this.#sql.exec('UPDATE threads SET verdict = ? WHERE id = ?', verdict, thread);
		this.#threadEvent(thread, verdict);
		this.#touch(thread);
		// A failure reaches the agent as its hand-back or, failing that, the revert.
		if (verdict === 'landed' || verdict === 'failed') return;
		const branch = await this.#branch();
		await this.#notify(thread, verdictNotice(verdict, shipped.sha, branch, revert));
		await this.#tellParent(thread, parentVerdictNotice(verdict, shipped.sha, branch, revert));
	}

	// A thread started with launch_thread tells the thread that started it how it turns out:
	// a working parent reads it at its next step, and an idle one starts a turn.
	async #tellParent(child: string, text: string) {
		const summary = this.#summary(child);
		const parent = summary?.parent && this.#summary(summary.parent.id);
		if (!summary || !parent || parent.deleted || parent.status === 'archived') return;
		const about = `Spun-off thread #${summary.number} (${summary.headline || 'New thread'}) ${text}`;
		if (parent.status === 'shipping') return await this.#notify(parent.id, about);
		const entry = this.#add(parent.id, { type: 'event', text: about });
		if (['idle', 'shipped'].includes(parent.status)) this.#setStatus(parent.id, 'working');
		await this.#converse(parent.id, agent, about, entry).catch(() => {});
	}

	// Told once per reason, so a parent and child messaging each other don't keep waking each other.
	async #tellParentNeedsYou(thread: string) {
		const summary = this.#summary(thread);
		if (!summary?.parent) return;
		const told = `parent-told:${thread}`;
		if (!summary.needsYou) {
			this.#sql.exec('DELETE FROM meta WHERE key = ?', told);
			return;
		}
		const entries = this.#entries(thread);
		const intent = this.#latestIntentEntry(thread);
		const unmet = intent ? unmetChecks(intent) : 0;
		const reasons = [
			summary.failure && `${summary.failure.title}: ${summary.failure.error}`,
			summary.behind?.conflicts.length &&
				`conflicts with \`${summary.behind.branch}\` in ${summary.behind.conflicts.map((file) => `\`${file}\``).join(', ')}`,
			summary.changes?.files && 'changes ready to ship',
			unmet && `${unmet} done-when ${unmet === 1 ? 'check' : 'checks'} unmet`
		].filter(Boolean);
		const reason = reasons.join('; ');
		if (this.#meta(told) === reason) return;
		this.#setMeta(told, reason);
		const checkpoint = entries.findLast((entry) => entry.type === 'tools' && entry.checkpoint);
		const commit =
			checkpoint?.type === 'tools' && checkpoint.checkpoint
				? ` Latest commit: \`${checkpoint.checkpoint.slice(0, 7)}\`.`
				: '';
		await this.#tellParent(thread, `needs a person: ${reason}.${commit}`);
	}

	async #notify(thread: string, notice: string) {
		await this.#agent(thread)
			.notify(notice)
			.catch((error: unknown) => console.warn('Could not notify the agent', error));
	}

	#fixing(thread: string) {
		return JSON.parse(this.#meta(`fixing:${thread}`) ?? 'null') as Fixing | null;
	}

	#saveFixing(thread: string, fixing: Fixing) {
		this.#setMeta(`fixing:${thread}`, JSON.stringify(fixing));
	}

	// A commit the thread shipped broke main's deploy checks. An idle thread's agent gets to fix it, and the fix ships
	// when it finishes; when it can't, or its fix doesn't work, what the thread shipped since is reverted.
	async #broke(thread: string, culprit: Culprit, results: CheckResult[], range: string[]) {
		const fixing = this.#fixing(thread) ?? { commits: [], fixes: 0, fixed: null, reverting: null };
		if (fixing.reverting) return;
		const known = fixing.commits.some(({ sha }) => sha === culprit.sha);
		if (known && !(fixing.fixed && range.includes(fixing.fixed))) return;
		if (!known) {
			const later = this.#shipsAfter(thread, culprit.sha, range).filter(
				({ sha }) => !fixing.commits.some((commit) => commit.sha === sha)
			);
			fixing.commits.push({ sha: culprit.sha, headline: culprit.headline }, ...later);
		}
		this.#saveFixing(thread, fixing);
		await this.#setVerdict(thread, 'failed');
		const branch = await this.#branch();
		const failed = blockingFailures(results).map(({ name }) => name);
		const summary = this.#summary(thread);
		const input = JSON.parse(this.#meta(`ship-input:${thread}`) ?? 'null') as ShipInput | null;
		const short = `\`${culprit.sha.slice(0, 7)}\``;
		const brokeMain = `broke \`${branch}\`'s deploy checks (${failed.join(', ')}) with ${short}`;
		if (summary?.status !== 'shipped' || summary.deleted || fixing.fixes >= maxFixes || !input) {
			const why = fixing.fixes ? 'the fix did not make them pass' : 'nobody was free to fix them';
			await this.#tellParent(thread, `${brokeMain}; ${why}, so it is being reverted.`);
			return await this.#revert(thread, `Deploy checks failed (${failed.join(', ')}), and ${why}.`);
		}
		this.#saveFixing(thread, { ...fixing, fixes: fixing.fixes + 1 });
		this.#setMeta(
			`handback:${thread}`,
			JSON.stringify({
				input: {
					...input,
					title: `Fix ${branch} after "${input.title}"`,
					body: `Deploy checks failed: ${failed.join(', ')}.`
				},
				handBacks: 0
			})
		);
		const entry = this.#add(thread, {
			type: 'event',
			text: `${short} failed \`${branch}\`'s deploy checks (${failed.join(', ')}); handed back to the agent to fix`,
			tone: 'danger'
		});
		this.#setStatus(thread, 'working');
		await this.#tellParent(thread, `${brokeMain}; the fix ships once its agent finishes.`);
		await this.#converse(
			thread,
			agent,
			brokeMainNotice({ branch, sha: culprit.sha, results }),
			entry
		);
	}

	async #revert(thread: string, reason: string) {
		const fixing = this.#fixing(thread);
		if (!fixing?.commits.length || fixing.reverting) return;
		const id = crypto.randomUUID().replaceAll('-', '');
		this.#saveFixing(thread, { ...fixing, reverting: id });
		this.#setMeta(`revert:${id}`, thread);
		const shas = fixing.commits.map(({ sha }) => `\`${sha.slice(0, 7)}\``).join(', ');
		this.#add(thread, {
			type: 'event',
			text: `Reverting ${shas} on \`${await this.#branch()}\`: ${reason}`,
			tone: 'danger'
		});
		const params = { id, repo: this.#repo(), thread, commits: fixing.commits, reason };
		await this.env.REVERT_SHIP.create({ id, params }).catch((error: unknown) =>
			this.revertFailed(id, error instanceof Error ? error.message : String(error))
		);
	}

	async reverted(id: string, reverted: { sha: string; branch: string } | null) {
		const thread = this.#meta(`revert:${id}`);
		if (!thread) return;
		const commits = this.#fixing(thread)?.commits ?? [];
		this.#sql.exec('DELETE FROM meta WHERE key IN (?, ?)', `revert:${id}`, `fixing:${thread}`);
		if (reverted)
			for (const { sha } of commits)
				this.#sql.exec('UPDATE ships SET reverted = 1 WHERE sha = ?', sha);
		await this.#setVerdict(thread, 'reverted', undefined, reverted?.sha);
		const where = reverted ? ` in ${reverted.sha.slice(0, 7)}` : '';
		this.#fail(
			thread,
			{
				title: 'Reverted',
				error: `It broke ${await this.#branch()}'s deploy checks, so it was reverted${where}.`,
				failures: []
			},
			false
		);
		if (reverted) {
			const headline = `Revert "${this.#summary(thread)?.headline ?? thread}"`;
			await this.#verify({ sha: reverted.sha, headline, thread });
		}
	}

	async revertFailed(id: string, error: string) {
		const thread = this.#meta(`revert:${id}`);
		if (!thread) return;
		this.#sql.exec('DELETE FROM meta WHERE key = ?', `revert:${id}`);
		const fixing = this.#fixing(thread);
		if (fixing) this.#saveFixing(thread, { ...fixing, reverting: null });
		this.#fail(thread, { title: "Couldn't revert", error, failures: [] }, false);
		const shas = fixing?.commits.map(({ sha }) => sha.slice(0, 7)).join(', ') || 'it';
		const branch = await this.#branch();
		await this.#notify(
			thread,
			`What this thread shipped broke \`${branch}\`'s deploy checks, and reverting ${shas} failed: ${error}\n\nIt is still on \`${branch}\`, which still fails its deploy checks.`
		);
	}

	async deploySecrets(by: Author): Promise<DeploySecret[]> {
		await this.#owner(by);
		return this.#sql
			.exec<{ name: string; updated_at: number; updated_by: string }>(
				'SELECT name, updated_at, updated_by FROM deploy_secrets ORDER BY name'
			)
			.toArray()
			.map(({ name, updated_at, updated_by }) => ({
				name,
				updatedAt: updated_at,
				updatedBy: updated_by
			}));
	}

	async setDeploySecret(name: string, value: string, by: Author) {
		await this.#owner(by);
		if (!deploySecretName.test(name))
			throw new Error(
				'Secret names use capital letters, digits and underscores, and start with a letter or underscore'
			);
		const size = new TextEncoder().encode(value).length;
		if (!size || size > maxDeploySecretBytes)
			throw new Error(`A secret needs a value of at most ${maxDeploySecretBytes / 1024} KiB`);
		const sealed = await seal(this.env, this.#repo(), name, value);
		this.#sql.exec(
			'INSERT INTO deploy_secrets (name, iv, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET iv = excluded.iv, value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
			name,
			sealed.iv,
			sealed.value,
			Date.now(),
			by.name
		);
	}

	async deleteDeploySecret(name: string, by: Author) {
		await this.#owner(by);
		this.#sql.exec('DELETE FROM deploy_secrets WHERE name = ?', name);
	}

	// Only the main sandbox, which holds the key, opens these.
	sealedDeploySecrets(): Sealed[] {
		return this.#sql
			.exec<{ name: string; iv: string; value: string }>(
				'SELECT name, iv, value FROM deploy_secrets ORDER BY name'
			)
			.toArray()
			.map(({ name, iv, value }) => ({ name, iv, value }));
	}

	#checkOverlaps(thread: string) {
		const next = this.#overlapChecks
			.then(() => this.#refreshOverlaps(thread))
			.catch((error: unknown) => console.warn('Could not check overlapping threads', error));
		this.#overlapChecks = next;
		this.ctx.waitUntil(next);
	}

	// Merges the thread's changes with every live thread that changes the same files and notes new conflicts in both.
	async #refreshOverlaps(thread: string) {
		const self = this.#liveThreads().find(({ id }) => id === thread);
		const others = this.#liveThreads().filter(
			({ id, files }) => id !== thread && self && [...self.files].some((file) => files.has(file))
		);
		let clashes: { id: string; files: string[] }[] = [];
		if (others.length) {
			try {
				const fork = await this.#agent(thread).forkRef();
				const forks = [];
				for (const { id } of others) {
					const ref = await this.#agent(id).forkRef();
					if (ref) forks.push({ id, ...ref });
				}
				if (fork && forks.length)
					({ clashes } = await this.env.REPOSITORY_GIT.getByName(`scan-${this.#repo()}`).clashes(
						{ id: thread, ...fork },
						forks
					));
			} catch (error) {
				console.warn('Could not merge overlapping threads', error);
				return;
			}
		}
		// A thread built on a newer main also carries main's changes; those conflicts are reported against main.
		const changes = new Map(others.map(({ id, files }) => [id, files]));
		clashes = clashes.map(({ id, files }) => ({
			id,
			files: files.filter((file) => self!.files.has(file) && changes.get(id)?.has(file))
		}));
		const live = this.#liveThreads();
		const headlines = new Map(live.map(({ id, headline }) => [id, headline]));
		const changed: [string, ThreadOverlap[]][] = [];
		for (const row of live) {
			const was = JSON.parse(row.overlaps ?? '[]') as ThreadOverlap[];
			const clash =
				row.id === thread
					? clashes
					: clashes.some(({ id }) => id === row.id)
						? [{ id: thread, files: clashes.find(({ id }) => id === row.id)!.files }]
						: [];
			const overlaps = [
				...(row.id === thread ? [] : was.filter((overlap) => overlap.thread !== thread)),
				...clash.map(({ id, files }) => ({ thread: id, files }))
			]
				.map(({ thread: id, files }) => ({
					thread: id,
					headline: headlines.get(id) ?? '',
					purpose: this.#latestIntent(id)?.purpose,
					files: [...files].sort()
				}))
				.filter(({ thread: id, files }) => headlines.has(id) && files.length)
				.sort((a, b) => a.thread.localeCompare(b.thread));
			if (JSON.stringify(overlaps) === JSON.stringify(was)) continue;
			for (const { thread: other, headline, files } of overlaps) {
				const known = was.find((overlap) => overlap.thread === other)?.files ?? [];
				const fresh = files.filter((file) => !known.includes(file));
				if (fresh.length)
					this.#add(row.id, {
						type: 'event',
						text: `Conflicts with "${headline || 'New thread'}" in ${fresh.join(', ')}`,
						tone: 'warning'
					});
			}
			this.#sql.exec(
				'UPDATE threads SET overlaps = ? WHERE id = ?',
				JSON.stringify(overlaps),
				row.id
			);
			changed.push([row.id, overlaps]);
		}
		for (const [id, overlaps] of changed) {
			try {
				await this.#agent(id).overlapping(overlaps);
			} catch (error) {
				console.warn('Could not share conflicting threads', error);
			}
		}
	}

	#liveThreads() {
		return this.#sql
			.exec<Pick<ThreadRow, 'id' | 'headline' | 'paths' | 'overlaps'>>(
				"SELECT id, headline, paths, overlaps FROM threads WHERE deleted_at IS NULL AND status != 'archived'"
			)
			.toArray()
			.map((row) => ({
				...row,
				files: new Set(
					(JSON.parse(row.paths ?? '[]') as string[]).filter((file) => !regenerated.test(file))
				)
			}));
	}

	#setBehind(thread: string, behind: ThreadSummary['behind']) {
		const was = this.#summary(thread);
		if (!was) return;
		this.#sql.exec(
			'UPDATE threads SET behind = ? WHERE id = ?',
			behind && JSON.stringify(behind),
			thread
		);
		if (behind) this.#setMeta('branch', behind.branch);
		const conflicts = behind?.conflicts ?? [];
		if (conflicts.length && JSON.stringify(was.behind?.conflicts) !== JSON.stringify(conflicts))
			this.#add(thread, {
				type: 'event',
				text: `Conflicts with ${behind!.branch} in ${conflicts.join(', ')}`,
				tone: 'warning'
			});
		this.#touch(thread);
	}

	async #owner(by: Author) {
		if (by.kind !== 'person' || !(await canAccessRepository(db, this.#repo(), by.id, 'owner')))
			throw new Error('Repository owner permission is required');
	}

	#agent(thread: string) {
		return this.env.ATTEMPTS.getByName(thread);
	}

	async attemptUpdated(thread: string, update: AttemptUpdate) {
		const summary = this.#summary(thread);
		if (!summary) return;
		if (update.type === 'changes') {
			this.#sql.exec(
				'UPDATE threads SET changes = ?, paths = ? WHERE id = ?',
				JSON.stringify(update.summary),
				JSON.stringify(update.paths),
				thread
			);
			this.#touch(thread);
			this.#checkOverlaps(thread);
			this.#staleResults(thread, update.tree);
			return;
		}
		if (update.type === 'checks') {
			const outcome = ({ action, results }: CheckRun) =>
				JSON.stringify([action, results.map(({ name, status }) => [name, status])]);
			const unchanged = summary.checks && outcome(summary.checks) === outcome(update.run);
			this.#sql.exec(
				'UPDATE threads SET checks = ? WHERE id = ?',
				JSON.stringify(update.run),
				thread
			);
			if (!unchanged)
				this.#add(thread, {
					type: 'event',
					text: describeChecks(update.run.action, update.run.results),
					tone: checksTone(update.run.results)
				});
			this.#touch(thread);
			return;
		}
		if (update.type === 'behind') {
			this.#setMeta('branch', update.branch);
			this.#setBehind(thread, update.behind);
			return;
		}
		if (update.type === 'usage') {
			for (const usage of update.usage) this.#recordUsage(thread, update.task, update.model, usage);
			return;
		}
		if (update.type === 'services') {
			this.#sql.exec(
				'UPDATE threads SET services = ?, preview = ? WHERE id = ?',
				JSON.stringify(update.services),
				update.preview,
				thread
			);
			this.#touch(thread);
			return;
		}
		if (update.type === 'read') {
			for (const id of update.entries) this.#markRead(thread, id);
			return;
		}
		if (update.type === 'activity') {
			this.#setActivity(thread, {
				...update.activity,
				ship: this.#activities.get(thread)?.ship ?? null
			});
			return;
		}
		if (update.type === 'startup') {
			this.#add(thread, { type: 'startup', stages: update.stages });
			return;
		}
		if (update.type === 'recovered') {
			this.#add(thread, { type: 'recovered', failures: update.failures });
			return;
		}
		if (update.type === 'step') {
			if (update.step.usage) {
				this.#recordUsage(thread, 'agent', update.model, update.step.usage);
				this.#touch(thread);
			}
			for (const turn of update.step.turns) {
				if (turn.role === 'assistant' && turn.compaction)
					this.#add(thread, { type: 'event', text: 'Context compacted' });
				if (turn.role === 'assistant' && turn.text.trim()) {
					this.#add(thread, { type: 'message', author: agent, text: turn.text.trim() });
				}
			}
			const { checkpoint } = update.step;
			if (update.tools?.length || checkpoint)
				this.#add(thread, {
					type: 'tools',
					calls: update.tools ?? [],
					...(checkpoint && { checkpoint })
				});
			const activity = this.#activities.get(thread);
			if (activity?.agent.type === 'streaming')
				this.#setActivity(thread, { ...activity, agent: idlePhase });
			return;
		}

		if (!['finished', 'stopped', 'failed'].includes(update.status)) return;
		this.#setActivity(thread, null);
		if (update.status === 'stopped')
			this.#add(thread, {
				type: 'event',
				text: 'The agent stopped at its step limit',
				tone: 'warning'
			});
		const working = this.#summary(thread)!.status === 'working';
		if (working) this.#setStatus(thread, 'idle');
		if (update.status === 'failed') {
			const failure = {
				title: 'The agent stopped',
				error: update.error ?? 'Unknown error',
				failures: update.failures ?? []
			};
			this.#fail(thread, failure, true);
		}
		if (!working) return;
		const handBack = this.#takeHandBack(thread);
		if (!handBack) return await this.#tellParentNeedsYou(thread);
		if (update.status !== 'finished')
			return await this.#revert(thread, 'the agent stopped before fixing them');
		try {
			await this.#startShip(thread, handBack.input, handBack.handBacks);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.#add(thread, {
				type: 'event',
				text: `Couldn't ship again: ${message}`,
				tone: 'danger'
			});
			await this.#revert(thread, `the agent couldn't fix them (${message})`);
		}
	}

	override async fetch(request: Request) {
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('Expected a WebSocket', { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server!);
		return new Response(null, { status: 101, webSocket: client });
	}

	async #converse(thread: string, author: Author, text: string, entry: string, sync = false) {
		const { mode, machine } = this.#summary(thread)!;
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'context'>>('SELECT context FROM threads WHERE id = ?', thread)
			.toArray();
		try {
			await retrying('Agent', () =>
				this.#agent(thread).converse({
					repo: this.#repo(),
					mode,
					machine,
					context: row?.context ?? undefined,
					author: author.name,
					text,
					entry,
					sync
				})
			);
		} catch (error) {
			this.#unreachable(thread, error);
			throw error;
		}
	}

	#services(thread: string): ThreadService[] {
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'services' | 'preview'>>(
				'SELECT services, preview FROM threads WHERE id = ?',
				thread
			)
			.toArray();
		if (!row?.services) return [];
		return (JSON.parse(row.services) as ServiceInfo[]).map(
			({ name, command, port, saved, status, exitCode }) => ({
				name,
				command,
				port,
				saved,
				status,
				exitCode,
				preview: row.preview ? `https://${row.preview.replace('{name}', name)}` : ''
			})
		);
	}

	#entry(thread: string, id: string) {
		const [row] = this.#sql
			.exec<{ body: string }>(
				'SELECT body FROM entries WHERE seq = ? AND thread = ?',
				Number(id.slice(1)),
				thread
			)
			.toArray();
		return row ? (JSON.parse(row.body) as Entry) : undefined;
	}

	#update(thread: string, entry: Entry) {
		this.#sql.exec(
			'UPDATE entries SET body = ? WHERE seq = ?',
			JSON.stringify(entry),
			Number(entry.id.slice(1))
		);
		if (entry.type === 'intent') this.#countUnmet(thread, entry);
		this.#broadcast({ type: 'entry', thread, entry });
		this.#touch(thread);
	}

	#markRead(thread: string, id: string) {
		const seq = Number(id.slice(1));
		const [row] = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE seq = ? AND thread = ?', seq, thread)
			.toArray();
		if (!row) return;
		const entry = JSON.parse(row.body) as Entry;
		if (entry.type !== 'message' && entry.type !== 'thread-message' && entry.type !== 'automation')
			return;
		if (!entry.steering || entry.steering.read) return;
		const read = { ...entry, steering: { read: true } };
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(read), seq);
		this.#broadcast({ type: 'entry', thread, entry: read });
	}

	#setActivity(thread: string, activity: ThreadActivity | null) {
		const idle = !activity || (activity.agent.type === 'idle' && !activity.retry && !activity.ship);
		// Activity is kept in memory, which hibernation clears while clients stay connected, so idle is always sent.
		if (idle) this.#activities.delete(thread);
		else this.#activities.set(thread, activity);
		this.#broadcast({ type: 'activity', thread, activity: idle ? null : activity });
	}

	#add(thread: string, entry: DistributiveOmit<Entry, 'id' | 'at'>) {
		const at = Date.now();
		const { seq } = this.#sql
			.exec<{ seq: number }>(
				`INSERT INTO entries (thread, body) VALUES (?, '') RETURNING seq`,
				thread
			)
			.one();
		const full = { ...entry, id: `e${seq}`, at } as Entry;
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(full), seq);
		if (full.type === 'intent') this.#countUnmet(thread, full);
		this.#broadcast({ type: 'entry', thread, entry: full });
		this.#touch(thread);
		return full.id;
	}

	#recordUsage(thread: string, task: UsageRow['task'], model: string, usage: Usage) {
		this.#sql.exec(
			`INSERT INTO usage (thread, task, model, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			thread,
			task,
			model,
			usage.inputTokens,
			usage.cachedInputTokens,
			usage.cacheWriteTokens,
			usage.outputTokens,
			Date.now()
		);
	}

	#usage(thread: string, mode: Mode, calls = this.#calls(thread)): ThreadUsage {
		const rows = new Map<string, UsageRow>();
		for (const call of calls) {
			const price = cost(call.model, {
				inputTokens: call.input_tokens,
				cachedInputTokens: call.cached_input_tokens,
				cacheWriteTokens: call.cache_write_tokens,
				outputTokens: call.output_tokens
			});
			const key = `${call.task} ${call.model}`;
			const row = rows.get(key) ?? { task: call.task, model: call.model, tokens: 0, cost: 0 };
			row.tokens += call.input_tokens + call.output_tokens;
			row.cost = row.cost === null || price === null ? null : row.cost + price;
			rows.set(key, row);
		}
		const latest = calls.findLast((call) => call.task === 'agent') ?? calls.at(-1);
		const model = latest?.model ?? modes[mode].model;
		return {
			rows: [...rows.values()],
			context: {
				used: latest ? latest.input_tokens + latest.output_tokens : 0,
				limit: compactThreshold(model) ?? models[model]?.contextWindow ?? 0
			}
		};
	}

	#calls(thread: string) {
		return this.#sql
			.exec<{
				task: UsageRow['task'];
				model: string;
				input_tokens: number;
				cached_input_tokens: number;
				cache_write_tokens: number;
				output_tokens: number;
			}>('SELECT * FROM usage WHERE thread = ? ORDER BY seq', thread)
			.toArray();
	}

	#setStatus(thread: string, status: ThreadStatus) {
		this.#sql.exec('UPDATE threads SET status = ? WHERE id = ?', status, thread);
		if (status === 'working' || status === 'shipping')
			this.#sql.exec('UPDATE threads SET failure = NULL WHERE id = ?', thread);
		this.#touch(thread);
	}

	#touch(thread: string) {
		this.#sql.exec('UPDATE threads SET updated_at = ? WHERE id = ?', Date.now(), thread);
		this.#broadcast({ type: 'thread', summary: this.#summary(thread)! });
	}

	#broadcast(message: LiveMessage) {
		const data = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(data);
			} catch {}
		}
	}

	#createThread(input: {
		headline: string;
		mode: Mode;
		machine: Machine;
		auto?: boolean;
		parent?: string;
		context?: string;
	}) {
		return this.ctx.storage.transactionSync(() => {
			const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
			const number = Number(this.#meta('last-thread-number')) + 1;
			this.#sql.exec(
				`INSERT INTO threads (id, number, headline, status, mode, auto, machine, parent, context, updated_at)
				VALUES (?, ?, ?, 'working', ?, ?, ?, ?, ?, ?)`,
				id,
				number,
				input.headline,
				input.mode,
				input.auto ? 1 : 0,
				input.machine,
				input.parent ?? null,
				input.context ?? null,
				Date.now()
			);
			this.#setMeta('last-thread-number', String(number));
			return id;
		});
	}

	#summary(id: string) {
		const row = this.#sql.exec<ThreadRow>(`${selectThreads} WHERE t.id = ?`, id).toArray()[0];
		return row && toSummary(row);
	}

	#require(id: string) {
		const summary = this.#summary(id);
		if (!summary) throw new Error(`There is no thread ${id}`);
		return summary;
	}

	// The branch the repository's HEAD points to, as threads last saw it; seeded from the recorded default.
	async #branch() {
		const known = this.#meta('branch');
		if (known) return known;
		using repo = await this.env.ARTIFACTS.get(this.#repo());
		const { defaultBranch } = await repo.info();
		this.#setMeta('branch', defaultBranch);
		return defaultBranch;
	}

	#meta(key: string) {
		return this.#sql
			.exec<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)
			.toArray()[0]?.value;
	}

	#setMeta(key: string, value: string) {
		this.#sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
			key,
			value
		);
	}

	#repo() {
		const [row] = this.#sql
			.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'repo'")
			.toArray();
		const repo = row?.value ?? this.ctx.id.name;
		if (!repo) throw new Error("This coordinator doesn't know its repository yet");
		return repo;
	}

	#active(id: string) {
		const summary = this.#require(id);
		if (summary.deleted) throw new Error(`Thread ${id} was deleted`);
		return summary;
	}

	#threadEvent(thread: string, verdict: Verdict) {
		const event = verdict === 'landed' ? 'shipped' : verdict;
		const sha = this.#summary(thread)?.shipped?.sha;
		const note = `${sha ? sha.slice(0, 7) : 'What it shipped'} ${verdictNotes[event]}`;
		if (this.#automations.event(thread, event, note, Date.now())) void this.#scheduleAlarm();
	}

	async #runAutomations() {
		const now = Date.now();
		for (const automation of this.#automations.due(now)) {
			if (automation.nextAt === null || automation.nextAt > now) {
				this.#automations.expire(automation.id, now);
				if (this.#summary(automation.thread)) this.#touch(automation.thread);
				continue;
			}
			await this.#fireAutomation(automation, now);
		}
	}

	async #fireAutomation(automation: DueAutomation, now: number) {
		const { thread } = automation;
		const summary = this.#summary(thread);
		if (!summary || summary.deleted || summary.status === 'archived')
			return this.#automations.endThread(thread, now);
		const pending = automation.pendingEntry && this.#entry(thread, automation.pendingEntry);
		if (pending && pending.type === 'automation' && pending.steering?.read === false) {
			this.#automations.skipped(automation, now);
			return this.#touch(thread);
		}
		const run = automation.runs.done + 1;
		const trigger = describeTrigger(automation.on, automation.delayMs);
		const steering = summary.status === 'working';
		const entry = this.#add(thread, {
			type: 'automation',
			automation: automation.id,
			name: automation.name,
			trigger,
			text: automation.message,
			run,
			limit: automation.runs.limit,
			...(steering && { steering: { read: false } })
		});
		this.#automations.ran(automation, entry, now);
		this.#touch(thread);
		if (['idle', 'shipped'].includes(summary.status)) this.#setStatus(thread, 'working');
		const why = `${trigger}${automation.note ? `: ${automation.note}` : ''}; run ${run} of ${automation.runs.limit}`;
		const author = { name: `Automation "${automation.name}"`, kind: 'agent' as const };
		const text = `(${why}; you set this automation up in this thread) ${automation.message}`;
		// An unreachable agent is recorded on the thread; the other automations still run.
		await this.#converse(thread, author, text, entry).catch(() => {});
	}

	// One alarm serves both purging deleted threads and running automations, whichever is due first.
	async #scheduleAlarm() {
		const [next] = this.#sql
			.exec<{ at: number | null }>(
				'SELECT MIN(deleted_at) AS at FROM threads WHERE deleted_at IS NOT NULL'
			)
			.toArray();
		const times = [next?.at ? next.at + threadPurgeDelayMs : null, this.#automations.next()].filter(
			(at): at is number => at !== null
		);
		if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
		else await this.ctx.storage.deleteAlarm();
	}

	// Unmet done-when checks on the thread's current tree flag it as needing someone.
	#countUnmet(thread: string, entry: Extract<Entry, { type: 'intent' }>) {
		this.#sql.exec('UPDATE threads SET unmet = ? WHERE id = ?', unmetChecks(entry), thread);
	}

	#latestIntent(thread: string) {
		return this.#latestIntentEntry(thread)?.intent;
	}

	#latestIntentEntry(thread: string) {
		return this.#entries(thread).findLast(
			(entry): entry is Extract<Entry, { type: 'intent' }> => entry.type === 'intent'
		);
	}
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const selectThreads =
	'SELECT t.*, p.headline AS parent_headline, p.number AS parent_number FROM threads t LEFT JOIN threads p ON p.id = t.parent';

function unmetChecks(entry: Extract<Entry, { type: 'intent' }>) {
	return entry.intent.doneWhen.filter((check) => {
		const result = entry.results?.[check];
		return result?.status === 'unmet' && !result.stale;
	}).length;
}

function headlineFrom(text: string) {
	const line = text.trim().split('\n')[0]!.trim();
	return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function toSummary(row: ThreadRow): ThreadSummary {
	const summary: Omit<ThreadSummary, 'needsYou'> = {
		id: row.id,
		number: row.number,
		headline: row.headline,
		status: row.status,
		mode: row.mode,
		auto: row.auto === 1,
		machine: row.machine ?? defaultMachine,
		updatedAt: row.updated_at,
		deleted: row.deleted_at === null ? null : { at: row.deleted_at, by: row.deleted_by ?? '' },
		parent: row.parent
			? { id: row.parent, number: row.parent_number ?? null, headline: row.parent_headline ?? '' }
			: null,
		changes: row.changes ? (JSON.parse(row.changes) as DiffSummary) : null,
		shipped:
			row.shipped_sha && row.shipped_at
				? {
						sha: row.shipped_sha,
						by: row.shipped_by ?? '',
						at: row.shipped_at,
						verdict: row.verdict ?? 'landed'
					}
				: null,
		behind: row.behind ? (JSON.parse(row.behind) as ThreadSummary['behind']) : null,
		failure: row.failure ? (JSON.parse(row.failure) as ThreadSummary['failure']) : null,
		checks: row.checks ? (JSON.parse(row.checks) as CheckRun) : null
	};
	return { ...summary, needsYou: needsYou(summary, row.unmet ?? 0) };
}

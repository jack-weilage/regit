import { DurableObject } from 'cloudflare:workers';
import {
	cost,
	assessRequest,
	maxSimilarCandidates,
	type Assessment,
	models,
	modes,
	type Intent,
	type Step,
	type ServiceInfo,
	type Suggestion,
	type Usage
} from '@regit/agent';
import type {
	CiRun,
	Author,
	Entry,
	Failure,
	RetryFailure,
	DiffFile,
	DiffSummary,
	LiveMessage,
	Machine,
	Mode,
	ModeChoice,
	Ship,
	ShipProgress,
	RepoCoordinatorApi,
	ShipInput,
	StartupStage,
	ThreadActivity,
	ThreadDetail,
	ThreadService,
	ThreadStatus,
	ThreadSummary,
	ThreadUsage,
	ToolCallRecord,
	UsageRow
} from '@regit/core';
import { defaultMachine, threadPurgeDelayMs } from '@regit/core';
import { canAccessRepository } from '@regit/db';
import { db } from './db.ts';
import { retrying, RetriesExhausted } from './retrying.ts';
import { Images } from './images.ts';
import type { AttemptStatus } from './attempt-sandbox.ts';
import type { Landing } from './landing.ts';

export type AttemptUpdate =
	| { type: 'step'; step: Step & { checkpoint?: string }; tools?: ToolCallRecord[] }
	| { type: 'status'; status: AttemptStatus; error: string | null; failures?: RetryFailure[] }
	| { type: 'recovered'; failures: RetryFailure[] }
	| { type: 'activity'; activity: ThreadActivity }
	| { type: 'startup'; stages: StartupStage[] }
	| { type: 'read'; entries: string[] }
	| { type: 'changes'; summary: DiffSummary }
	| { type: 'services'; services: ServiceInfo[]; preview: string }
	| { type: 'usage'; task: UsageRow['task']; model: string; usage: Usage[] }
	| { type: 'behind'; behind: ThreadSummary['behind']; branch: string };

type ThreadRow = {
	id: string;
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
	parent_headline?: string | null;
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
const similarTimeoutMs = 4000;
const recentHistory = 12;
const maxSearchHits = 30;
const maxDiffChars = 20_000;
const pastTense: Record<string, string> = {
	read_file: 'Read',
	write_file: 'Wrote',
	edit_file: 'Edited',
	find_files: 'Found files',
	search: 'Searched for',
	run: 'Ran',
	ask_threads: 'Asked about threads:',
	message_thread: 'Messaged thread'
};

function historyLines(entries: Entry[]) {
	return entries
		.flatMap((entry): string[] => {
			if (entry.type === 'message') return [`${entry.author.name}: ${entry.text}`];
			if (entry.type === 'thread-message') {
				const way = entry.direction === 'in' ? 'From' : 'To';
				return [`${way} thread ${entry.thread} (${entry.headline || 'New thread'}): ${entry.text}`];
			}
			if (entry.type === 'event') return [`· ${entry.text}`];
			if (entry.type === 'failure') return [`· ${entry.title}: ${entry.error}`];
			if (entry.type === 'intent')
				return [`Intent: ${entry.intent.headline} — ${entry.intent.purpose}`];
			if (entry.type === 'suggestion') return [`Suggested a thread: ${entry.intent.headline}`];
			if (entry.type === 'tools') {
				const calls = entry.calls.map((call) =>
					`${pastTense[call.tool] ?? call.tool} ${call.target}${call.status === 'failed' ? ' (failed)' : ''}`.trim()
				);
				return [`ReGit: ${calls.join('; ')}`];
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

function describeIntent({ headline, purpose, doneWhen }: Intent) {
	const checks = doneWhen.length ? ` Done when: ${doneWhen.join('; ')}` : '';
	return `${headline} — ${purpose}${checks}`;
}

export class RepoCoordinator extends DurableObject<Env> implements RepoCoordinatorApi {
	#sql = this.ctx.storage.sql;
	#activities = new Map<string, ThreadActivity>();
	#images = new Images(this.#sql);

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
				failure TEXT
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
			DROP TABLE IF EXISTS promotions;
		`);
		// TODO: remove once every repository's coordinator has the failure column.
		try {
			this.#sql.exec('ALTER TABLE threads ADD COLUMN failure TEXT');
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
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, auto, machine, updated_at) VALUES (?, ?, 'running', ?, ?, ?, ?)`,
			id,
			headlineFrom(text),
			size,
			auto ? 1 : 0,
			machine,
			Date.now()
		);
		const entry = this.#add(id, { type: 'message', author, text });
		await this.#converse(id, author, text, entry);
		return this.#summary(id)!;
	}

	async reply(thread: string, { author, text }: { author: Author; text: string }) {
		const summary = this.#active(thread);
		const steering = summary.status === 'running';
		const entry = this.#add(thread, {
			type: 'message',
			author,
			text,
			...(steering && { steering: { read: false } })
		});
		if (summary.status === 'discarded') return;
		if (['needs-you', 'shipped'].includes(summary.status)) this.#setStatus(thread, 'running');
		await this.#converse(thread, author, text, entry);
	}

	async bringUpToDate(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status === 'discarded') return;
		const entry = this.#add(thread, {
			type: 'event',
			text: `${by.name} asked to bring this thread up to date with ${await this.#branch()}`
		});
		if (['needs-you', 'shipped'].includes(summary.status)) this.#setStatus(thread, 'running');
		await this.#converse(
			thread,
			by,
			`Bring this thread up to date with ${await this.#branch()}.`,
			entry,
			true
		);
	}

	async discard(thread: string, by: Author) {
		const summary = this.#active(thread);
		await this.#notShipping(thread);
		this.#takeHandBack(thread);
		if (summary.status === 'discarded') return;
		const reopen = ['running', 'shipping'].includes(summary.status) ? 'needs-you' : summary.status;
		this.#sql.exec('UPDATE threads SET reopen_status = ? WHERE id = ?', reopen, thread);
		this.#add(thread, { type: 'event', text: `Discarded by ${by.name}` });
		this.#setStatus(thread, 'discarded');
		await this.#agent(thread).cancel();
	}

	reopen(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status !== 'discarded') return;
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'reopen_status'>>(
				'SELECT reopen_status FROM threads WHERE id = ?',
				thread
			)
			.toArray();
		this.#add(thread, { type: 'event', text: `Reopened by ${by.name}` });
		this.#setStatus(thread, row?.reopen_status ?? 'needs-you');
	}

	// TODO: once threads ship, keep a tombstone (headline, author, commit) instead of purging shipped threads
	async delete(thread: string, by: Author) {
		this.#active(thread);
		await this.#notShipping(thread);
		this.#takeHandBack(thread);
		this.#sql.exec(
			'UPDATE threads SET deleted_at = ?, deleted_by = ? WHERE id = ?',
			Date.now(),
			by.name,
			thread
		);
		this.#touch(thread);
		await this.#schedulePurge();
		await this.#agent(thread).cancel();
	}

	async stop(thread: string, by: Author) {
		const summary = this.#active(thread);
		await this.#notShipping(thread);
		this.#takeHandBack(thread);
		await this.#agent(thread).stop();
		const pending = this.#sql
			.exec<{ seq: number; body: string }>('SELECT seq, body FROM entries WHERE thread = ?', thread)
			.toArray()
			.filter((row) => {
				const entry = JSON.parse(row.body) as Entry;
				return entry.type === 'message' && entry.steering?.read === false;
			});
		for (const row of pending) this.#markRead(thread, `e${row.seq}`);
		this.#add(thread, { type: 'event', text: `Stopped by ${by.name}` });
		if (['running', 'shipping'].includes(summary.status)) {
			this.#setStatus(thread, 'needs-you');
		}
	}

	async resume(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status !== 'needs-you' || !summary.failure?.resumable) return;
		this.#add(thread, { type: 'event', text: `${by.name} asked the agent to try again` });
		this.#setStatus(thread, 'running');
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
			this.#sql.exec('DELETE FROM entries WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM usage WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM threads WHERE id = ?', id);
		}
		await this.#schedulePurge();
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

	otherThreads(from: string) {
		return this.threads()
			.filter((thread) => thread.id !== from && thread.status !== 'discarded')
			.map(({ id, headline, status }) => ({ id, headline, status }));
	}

	async messageThread(from: string, to: string, text: string) {
		if (from === to) throw new Error('That is this thread');
		const sender = this.#active(from);
		const recipient = this.#summary(to);
		if (!recipient || recipient.deleted) throw new Error(`There is no thread ${to}`);
		const steering = recipient.status === 'running';
		if (['discarded', 'shipping'].includes(recipient.status)) {
			throw new Error(`Thread ${to} is ${recipient.status}. Tell your person instead.`);
		}
		if (this.#threadMessagesSincePerson(to) >= maxThreadMessages) {
			throw new Error(
				`Thread ${to} has had ${maxThreadMessages} thread messages since a person last wrote there. Ask your person before sending more.`
			);
		}
		this.#add(from, {
			type: 'thread-message',
			direction: 'out',
			thread: to,
			headline: recipient.headline,
			text
		});
		const entry = this.#add(to, {
			type: 'thread-message',
			direction: 'in',
			thread: from,
			headline: sender.headline,
			text,
			...(steering && { steering: { read: false } })
		});
		const author = {
			name: `Thread ${from} (${sender.headline || 'New thread'})`,
			kind: 'agent' as const
		};
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
		const lines = [`${id} · ${summary.status} · ${summary.headline || 'New thread'}`];
		if (intent?.type === 'intent') {
			lines.push(`Intent: ${intent.intent.purpose}`, 'Done when:');
			for (const check of intent.intent.doneWhen) lines.push(`- ${check}`);
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
		let count = 0;
		for (const row of rows) {
			const entry = JSON.parse(row.body) as Entry;
			if (entry.type === 'message' && entry.author.kind === 'person') break;
			if (entry.type === 'thread-message' && entry.direction === 'in') count++;
		}
		return count;
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
				activity: null
			};
		}
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', id)
			.toArray();
		return {
			summary,
			branch: await this.#branch(),
			entries: rows.map((row) => JSON.parse(row.body) as Entry),
			usage: this.#usage(id, summary.mode),
			services: this.#services(id),
			activity: this.#activities.get(id) ?? null
		};
	}

	async intentProposed(thread: string, intent: Intent) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted) return;
		if (summary.status === 'discarded') return;
		const id = this.#add(thread, { type: 'intent', intent });
		this.#sql.exec('UPDATE threads SET headline = ? WHERE id = ?', intent.headline, thread);
		this.#touch(thread);
		const assessment = await this.#assess(describeIntent(intent), thread);
		if (!assessment) return;
		const { similar, size } = assessment;
		if (similar.length) this.#replace(thread, { ...this.#entry(thread, id)!, similar } as Entry);
		const current = this.#summary(thread)!;
		if (current.auto && !current.changes?.files && current.mode !== size) {
			this.#sql.exec('UPDATE threads SET mode = ? WHERE id = ?', size, thread);
			this.#touch(thread);
		}
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
		const candidates = this.threads()
			.filter((thread) => thread.id !== exclude && thread.headline)
			.slice(0, maxSimilarCandidates)
			.map((thread) => {
				const intent = this.#entries(thread.id).findLast((entry) => entry.type === 'intent');
				return {
					id: thread.id,
					headline: thread.headline,
					...(intent?.type === 'intent' && { purpose: intent.intent.purpose })
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

	suggestThread(thread: string, { context, ...intent }: Suggestion) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted || summary.status === 'discarded') return;
		this.#add(thread, { type: 'suggestion', intent, context, outcome: null });
	}

	async spinOff(thread: string, entry: string, by: Author) {
		const parent = this.#active(thread);
		const suggestion = this.#entry(thread, entry);
		if (suggestion?.type !== 'suggestion' || suggestion.outcome) {
			throw new Error('That suggestion is no longer open');
		}
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, machine, parent, context, updated_at)
			VALUES (?, ?, 'needs-you', ?, ?, ?, ?, ?)`,
			id,
			suggestion.intent.headline,
			parent.mode,
			parent.machine,
			thread,
			suggestion.context,
			Date.now()
		);
		if (suggestion.context)
			this.#add(id, { type: 'message', author: agent, text: suggestion.context });
		this.#add(id, { type: 'intent', intent: suggestion.intent });
		this.#update(thread, { ...suggestion, outcome: { kind: 'spun-off', thread: id, by: by.name } });
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
		if (summary.status !== 'needs-you' || !summary.changes?.files) {
			throw new Error('This thread has nothing ready to ship');
		}
		await this.#owner(input.by);
		await this.#startShip(thread, input, 0);
	}

	async #startShip(thread: string, { by, email, title, body }: ShipInput, handBacks: number) {
		const source = await this.#agent(thread).revision();
		if (!source) throw new Error('This thread has no changes to ship');
		if (this.#active(thread).status !== 'needs-you')
			throw new Error('The thread started working again');
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
		this.#add(thread, {
			type: 'event',
			text: `${by.name} is shipping this thread to ${await this.#branch()}`
		});
		try {
			await this.env.SHIP_THREAD.create({ id: ship.id, params: ship });
		} catch (error) {
			this.#stopShipping(thread, error instanceof Error ? error.message : String(error));
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

	#setShipProgress(thread: string, ship: ShipProgress | undefined) {
		const activity = this.#activities.get(thread);
		this.#setActivity(
			thread,
			activity ? { ...activity, ship } : { startup: null, status: null, text: '', calls: [], ship }
		);
	}

	async shipped(ship: Ship, { sha, branch }: { sha: string; branch: string }) {
		if (!this.#takeShip(ship)) return;
		const failures = this.#shipFailures(ship.thread);
		if (failures.length) this.#add(ship.thread, { type: 'recovered', failures });
		this.#setShipProgress(ship.thread, undefined);
		this.#setMeta('branch', branch);
		await this.#agent(ship.thread).published({ sha, branch, from: ship.source.sha });
		this.#sql.exec(
			'UPDATE threads SET changes = NULL, behind = NULL, shipped_sha = ?, shipped_at = ?, shipped_by = ? WHERE id = ?',
			sha,
			Date.now(),
			ship.by.name,
			ship.thread
		);
		this.#setStatus(ship.thread, 'shipped');
		this.#add(ship.thread, { type: 'event', text: `Shipped ${sha.slice(0, 7)} to ${branch}` });
	}

	async shipFailed(ship: Ship, message: string) {
		if (!this.#takeShip(ship)) return;
		const failures = this.#shipFailures(ship.thread);
		this.#setShipProgress(ship.thread, undefined);
		const summary = this.#summary(ship.thread)!;
		if (
			message.startsWith('Ship conflicts with ') &&
			ship.handBacks < maxHandBacks &&
			!summary.deleted
		)
			return await this.#handBack(ship, message);
		this.#stopShipping(ship.thread, message, failures);
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
		this.#stopShipping(thread, ship?.error?.message ?? 'the ship ended without reporting back');
	}

	#stopShipping(thread: string, reason: string, failures: RetryFailure[] = []) {
		this.#sql.exec('DELETE FROM meta WHERE key = ?', `ship:${thread}`);
		this.#setShipProgress(thread, undefined);
		this.#setStatus(thread, 'needs-you');
		this.#fail(thread, { title: 'Shipping stopped', error: reason, failures }, false);
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
		if (this.#summary(thread)?.status === 'running') this.#setStatus(thread, 'needs-you');
		const failures = error instanceof RetriesExhausted ? error.failures : [];
		const message = error instanceof Error ? error.message : String(error);
		this.#fail(thread, { title: "Couldn't reach the agent", error: message, failures }, false);
	}

	// Conflicts with main: the thread's agent merges main, re-checks, and the thread ships again.
	async #handBack(ship: Ship, message: string) {
		this.#setMeta(
			`handback:${ship.thread}`,
			JSON.stringify({
				input: { by: ship.by, email: ship.email, title: ship.title, body: ship.body },
				handBacks: ship.handBacks + 1
			})
		);
		const entry = this.#add(ship.thread, {
			type: 'event',
			text: `${message}. Handing it back to the agent to bring up to date.`
		});
		this.#setStatus(ship.thread, 'running');
		await this.#converse(
			ship.thread,
			agent,
			`Shipping conflicted with ${/^Ship conflicts with (\S+) in /.exec(message)?.[1] ?? (await this.#branch())}. Bring this thread up to date with it; it ships again once you finish.`,
			entry,
			true
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

	// Main moved: record how far behind each thread is and warn those that now conflict. Forks only take main when asked or handed back.
	async landed({ after }: Landing) {
		if (this.#meta('main') === after) return;
		const forks = [];
		for (const thread of this.threads()) {
			if (thread.status === 'discarded') continue;
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
				text: `Conflicts with ${behind!.branch} in ${conflicts.join(', ')}`
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
				'UPDATE threads SET changes = ? WHERE id = ?',
				JSON.stringify(update.summary),
				thread
			);
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
			this.#setActivity(thread, update.activity);
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
				this.#recordUsage(thread, 'agent', modes[summary.mode].model, update.step.usage);
				this.#touch(thread);
			}
			for (const turn of update.step.turns) {
				if (turn.role === 'assistant' && turn.text.trim()) {
					this.#add(thread, { type: 'message', author: agent, text: turn.text.trim() });
				}
			}
			if (update.tools?.length) this.#add(thread, { type: 'tools', calls: update.tools });
			const activity = this.#activities.get(thread);
			if (activity) this.#setActivity(thread, { ...activity, text: '', calls: [] });
			if (update.step.checkpoint) {
				this.#add(thread, {
					type: 'event',
					text: `Checkpoint ${update.step.checkpoint.slice(0, 7)}`
				});
			}
			return;
		}

		if (!['finished', 'stopped', 'failed'].includes(update.status)) return;
		this.#setActivity(thread, null);
		if (update.status === 'stopped')
			this.#add(thread, { type: 'event', text: 'The agent stopped at its step limit' });
		const running = this.#summary(thread)!.status === 'running';
		if (running) this.#setStatus(thread, 'needs-you');
		if (update.status === 'failed') {
			const failure = {
				title: 'The agent stopped',
				error: update.error ?? 'Unknown error',
				failures: update.failures ?? []
			};
			this.#fail(thread, failure, true);
		}
		if (!running) return;
		const handBack = this.#takeHandBack(thread);
		if (update.status === 'finished' && handBack)
			await this.#startShip(thread, handBack.input, handBack.handBacks).catch((error: unknown) =>
				this.#add(thread, {
					type: 'event',
					text: `Couldn't ship again: ${error instanceof Error ? error.message : String(error)}`
				})
			);
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
		if (entry.type !== 'message' && entry.type !== 'thread-message') return;
		if (!entry.steering || entry.steering.read) return;
		const read = { ...entry, steering: { read: true } };
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(read), seq);
		this.#broadcast({ type: 'entry', thread, entry: read });
	}

	#setActivity(thread: string, activity: ThreadActivity | null) {
		const idle =
			!activity ||
			(!activity.startup &&
				!activity.status &&
				!activity.text &&
				!activity.calls.length &&
				!activity.retry &&
				!activity.ship);
		if (idle && !this.#activities.has(thread)) return;
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
				limit: models[model]?.contextWindow ?? 0
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
		if (status === 'running' || status === 'shipping')
			this.#sql.exec('UPDATE threads SET failure = NULL WHERE id = ?', thread);
		this.#touch(thread);
	}

	#touch(thread: string) {
		this.#sql.exec('UPDATE threads SET updated_at = ? WHERE id = ?', Date.now(), thread);
		this.#broadcast({ type: 'thread', summary: this.#summary(thread)! });
	}

	ciUpdated(run: CiRun) {
		this.#broadcast({ type: 'ci', run });
	}

	#broadcast(message: LiveMessage) {
		const data = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(data);
			} catch {}
		}
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

	async #schedulePurge() {
		const [next] = this.#sql
			.exec<{ at: number | null }>(
				'SELECT MIN(deleted_at) AS at FROM threads WHERE deleted_at IS NOT NULL'
			)
			.toArray();
		if (next?.at) await this.ctx.storage.setAlarm(next.at + threadPurgeDelayMs);
		else await this.ctx.storage.deleteAlarm();
	}

	#latestIntent(thread: string) {
		const intent = this.#entries(thread).findLast((entry) => entry.type === 'intent');
		return intent?.type === 'intent' ? intent.intent : undefined;
	}
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const selectThreads =
	'SELECT t.*, p.headline AS parent_headline FROM threads t LEFT JOIN threads p ON p.id = t.parent';

function headlineFrom(text: string) {
	const line = text.trim().split('\n')[0]!.trim();
	return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

function toSummary(row: ThreadRow): ThreadSummary {
	return {
		id: row.id,
		headline: row.headline,
		status: row.status,
		mode: row.mode,
		auto: row.auto === 1,
		machine: row.machine ?? defaultMachine,
		updatedAt: row.updated_at,
		deleted: row.deleted_at === null ? null : { at: row.deleted_at, by: row.deleted_by ?? '' },
		parent: row.parent ? { id: row.parent, headline: row.parent_headline ?? '' } : null,
		changes: row.changes ? (JSON.parse(row.changes) as DiffSummary) : null,
		shipped:
			row.shipped_sha && row.shipped_at
				? { sha: row.shipped_sha, by: row.shipped_by ?? '', at: row.shipped_at }
				: null,
		behind: row.behind ? (JSON.parse(row.behind) as ThreadSummary['behind']) : null,
		failure: row.failure ? (JSON.parse(row.failure) as ThreadSummary['failure']) : null
	};
}

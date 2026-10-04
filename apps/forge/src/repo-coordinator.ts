import { DurableObject } from 'cloudflare:workers';
import {
	cost,
	describeTask,
	models,
	modes,
	type Intent,
	type Step,
	type Suggestion,
	type Usage
} from '@regit/agent';
import type {
	Author,
	CheckVerdict,
	ReviewVerdict,
	Entry,
	DiffFile,
	DiffSummary,
	LiveMessage,
	Machine,
	Mode,
	RepoCoordinatorApi,
	ShipInput,
	ThreadDetail,
	ThreadStatus,
	ThreadSummary,
	ThreadUsage,
	UsageRow
} from '@regit/core';
import { defaultMachine, threadPurgeDelayMs } from '@regit/core';
import type { AttemptStatus } from './attempt-sandbox.ts';

export type AttemptUpdate =
	| { type: 'step'; step: Step & { checkpoint?: string } }
	| { type: 'status'; status: AttemptStatus; error: string | null }
	| { type: 'reply'; step: Step }
	| { type: 'conversation-failed'; error: string }
	| { type: 'read'; entries: string[] }
	| { type: 'changes'; summary: DiffSummary; base: string | null }
	| { type: 'conflicts'; files: string[]; base: string }
	| { type: 'rebased'; base: string }
	| { type: 'shipped'; sha: string; base: string }
	| { type: 'usage'; task: UsageRow['task']; model: string; usage: Usage[] }
	| {
			type: 'review';
			round: number;
			verdict: ReviewVerdict;
			checks: CheckVerdict[];
			model: string;
			usage: Usage[];
	  };

type ThreadRow = {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	machine: Machine | null;
	updated_at: number;
	reopen_status: ThreadStatus | null;
	deleted_at: number | null;
	deleted_by: string | null;
	changes: string | null;
	shipped_sha: string | null;
	shipped_by: string | null;
	shipped_at: number | null;
	base: string | null;
	parent: string | null;
	context: string | null;
	parent_headline?: string | null;
};

const agent: Author = { name: 'ReGit', kind: 'agent' };

export class RepoCoordinator extends DurableObject<Env> implements RepoCoordinatorApi {
	#sql = this.ctx.storage.sql;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.#sql.exec(`
			CREATE TABLE IF NOT EXISTS threads (
				id TEXT PRIMARY KEY,
				headline TEXT NOT NULL,
				status TEXT NOT NULL,
				mode TEXT NOT NULL,
				updated_at INTEGER NOT NULL
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
		`);
		const columns = new Set(
			this.#sql
				.exec<{ name: string }>('PRAGMA table_info(threads)')
				.toArray()
				.map((column) => column.name)
		);
		for (const [name, type] of [
			['reopen_status', 'TEXT'],
			['deleted_at', 'INTEGER'],
			['deleted_by', 'TEXT'],
			['machine', 'TEXT'],
			['changes', 'TEXT'],
			['shipped_sha', 'TEXT'],
			['shipped_by', 'TEXT'],
			['shipped_at', 'INTEGER'],
			['base', 'TEXT'],
			['parent', 'TEXT'],
			['context', 'TEXT']
		]) {
			if (!columns.has(name!)) this.#sql.exec(`ALTER TABLE threads ADD COLUMN ${name} ${type}`);
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
		mode: Mode;
		machine: Machine;
	}): Promise<ThreadSummary> {
		this.#sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING',
			'repo',
			repo
		);
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, machine, updated_at) VALUES (?, ?, 'draft', ?, ?, ?)`,
			id,
			headlineFrom(text),
			mode,
			machine,
			Date.now()
		);
		const entry = this.#add(id, { type: 'message', author, text });
		await this.#converse(id, author, text, entry);
		return this.#summary(id)!;
	}

	async reply(thread: string, { author, text }: { author: Author; text: string }) {
		const summary = this.#active(thread);
		const steering = ['running', 'reviewing', 'shipping'].includes(summary.status);
		const entry = this.#add(thread, {
			type: 'message',
			author,
			text,
			...(steering && { steering: { read: false } })
		});
		if (steering || ['draft', 'needs-you', 'shipped'].includes(summary.status)) {
			await this.#converse(thread, author, text, entry);
		}
		if (summary.status === 'needs-you') this.#setStatus(thread, 'running');
	}

	async start(thread: string) {
		const summary = this.#active(thread);
		if (summary.status !== 'draft') throw new Error('This thread has already started');
		const intent = this.#latestIntent(thread);
		if (!intent) throw new Error('This thread has no intent to start');

		const task = describeTask(intent, this.#conversation(thread));
		await this.env.ATTEMPTS.getByName(thread).start({
			task,
			mode: summary.mode,
			machine: summary.machine,
			repo: this.#repo(),
			intent
		});
		this.#add(thread, { type: 'event', text: 'Started the attempt' });
		this.#setStatus(thread, 'running');
	}

	async discard(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status === 'discarded') return;
		const reopen =
			summary.status === 'running' || summary.status === 'reviewing' ? 'needs-you' : summary.status;
		this.#sql.exec('UPDATE threads SET reopen_status = ? WHERE id = ?', reopen, thread);
		this.#add(thread, { type: 'event', text: `Discarded by ${by.name}` });
		this.#setStatus(thread, 'discarded');
		if (summary.status === 'running' || summary.status === 'reviewing') {
			await this.env.ATTEMPTS.getByName(thread).cancel();
		}
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
		const summary = this.#active(thread);
		this.#sql.exec(
			'UPDATE threads SET deleted_at = ?, deleted_by = ? WHERE id = ?',
			Date.now(),
			by.name,
			thread
		);
		this.#touch(thread);
		await this.#schedulePurge();
		if (summary.status === 'running' || summary.status === 'reviewing') {
			await this.env.ATTEMPTS.getByName(thread).cancel();
		}
	}

	async stop(thread: string, by: Author) {
		const summary = this.#active(thread);
		await this.env.ATTEMPTS.getByName(thread).stop();
		const pending = this.#sql
			.exec<{ seq: number; body: string }>('SELECT seq, body FROM entries WHERE thread = ?', thread)
			.toArray()
			.filter((row) => {
				const entry = JSON.parse(row.body) as Entry;
				return entry.type === 'message' && entry.steering?.read === false;
			});
		for (const row of pending) this.#markRead(thread, `e${row.seq}`);
		this.#add(thread, { type: 'event', text: `Stopped by ${by.name}` });
		if (['running', 'reviewing', 'shipping'].includes(summary.status)) {
			this.#setStatus(thread, 'needs-you');
		}
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
			await this.env.ATTEMPTS.getByName(id).destroy();
			this.#sql.exec('DELETE FROM entries WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM usage WHERE thread = ?', id);
			this.#sql.exec('DELETE FROM threads WHERE id = ?', id);
		}
		await this.#schedulePurge();
	}

	threads(): ThreadSummary[] {
		return this.#sql
			.exec<ThreadRow>(`${selectThreads} WHERE t.deleted_at IS NULL ORDER BY t.updated_at DESC`)
			.toArray()
			.map(toSummary);
	}

	thread(id: string): ThreadDetail | null {
		const summary = this.#summary(id);
		if (!summary) return null;
		if (summary.deleted) return { summary, entries: [], usage: this.#usage(id, summary.mode, []) };
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', id)
			.toArray();
		return {
			summary,
			entries: rows.map((row) => JSON.parse(row.body) as Entry),
			usage: this.#usage(id, summary.mode)
		};
	}

	intentProposed(thread: string, intent: Intent) {
		const summary = this.#summary(thread);
		if (!summary || summary.deleted) return;
		if (['discarded', 'shipping', 'shipped'].includes(summary.status)) return;
		this.#add(thread, { type: 'intent', intent });
		this.#sql.exec('UPDATE threads SET headline = ? WHERE id = ?', intent.headline, thread);
		this.#touch(thread);
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
			VALUES (?, ?, 'draft', ?, ?, ?, ?, ?)`,
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

	changes(thread: string) {
		this.#active(thread);
		return this.env.ATTEMPTS.getByName(thread).changes() as Promise<DiffFile[] | null>;
	}

	async ship(thread: string, { by, email, title, body }: ShipInput) {
		const summary = this.#active(thread);
		if (summary.status !== 'needs-you' || !summary.changes) {
			throw new Error('This thread has nothing ready to ship');
		}
		await this.env.ATTEMPTS.getByName(thread).ship({
			title,
			body,
			author: { name: by.name, email }
		});
		this.#sql.exec('UPDATE threads SET shipped_by = ? WHERE id = ?', by.name, thread);
		this.#setStatus(thread, 'shipping');
	}

	attemptUpdated(thread: string, update: AttemptUpdate) {
		const summary = this.#summary(thread);
		if (!summary) return;
		if (update.type === 'changes') {
			this.#sql.exec(
				'UPDATE threads SET changes = ?, base = COALESCE(?, base) WHERE id = ?',
				JSON.stringify(update.summary),
				update.base,
				thread
			);
			this.#touch(thread);
			return;
		}
		if (update.type === 'usage') {
			for (const usage of update.usage) this.#recordUsage(thread, update.task, update.model, usage);
			return;
		}
		if (update.type === 'conflicts') {
			const files = update.files.length === 1 ? '1 file' : `${update.files.length} files`;
			this.#add(thread, { type: 'event', text: `Conflicts with ${update.base} in ${files}` });
			return;
		}
		if (update.type === 'rebased') {
			this.#add(thread, { type: 'event', text: `Rebased onto ${update.base}` });
			return;
		}
		if (update.type === 'shipped') {
			this.#sql.exec(
				'UPDATE threads SET shipped_sha = ?, shipped_at = ? WHERE id = ?',
				update.sha,
				Date.now(),
				thread
			);
			const [{ shipped_by: by }] = this.#sql
				.exec<Pick<ThreadRow, 'shipped_by'>>('SELECT shipped_by FROM threads WHERE id = ?', thread)
				.toArray() as [Pick<ThreadRow, 'shipped_by'>];
			this.#add(thread, {
				type: 'event',
				text: `Shipped to ${update.base} in ${update.sha.slice(0, 7)} by ${by}`
			});
			this.#setStatus(thread, 'shipped');
			return;
		}
		if (update.type === 'review') {
			for (const usage of update.usage) this.#recordUsage(thread, 'review', update.model, usage);
			const { round, verdict, checks } = update;
			this.#add(thread, { type: 'review', round, verdict, checks });
			return;
		}
		if (update.type === 'read') {
			for (const id of update.entries) this.#markRead(thread, id);
			return;
		}
		if (update.type === 'conversation-failed') {
			this.#add(thread, { type: 'event', text: `Couldn't reply: ${update.error}` });
			return;
		}
		if (update.type === 'step' || update.type === 'reply') {
			const task = update.type === 'reply' ? 'conversation' : 'attempt';
			if (update.step.usage) {
				this.#recordUsage(thread, task, modes[summary.mode].model, update.step.usage);
				this.#touch(thread);
			}
			for (const turn of update.step.turns) {
				if (turn.role === 'assistant' && turn.text.trim()) {
					this.#add(thread, { type: 'message', author: agent, text: turn.text.trim() });
				}
			}
			if (update.type === 'step' && update.step.checkpoint) {
				this.#add(thread, {
					type: 'event',
					text: `Checkpoint ${update.step.checkpoint.slice(0, 7)}`
				});
			}
			return;
		}

		const outcomes: Partial<Record<AttemptStatus, [ThreadStatus, string]>> = {
			finished: ['needs-you', 'The attempt finished'],
			stopped: ['needs-you', 'The attempt stopped at its step limit'],
			failed: ['needs-you', `The attempt failed: ${update.error}`],
			cancelled: ['discarded', 'The attempt was cancelled']
		};
		if (update.status === 'reviewing' || update.status === 'running') {
			if (['running', 'reviewing', 'shipping'].includes(summary.status)) {
				this.#setStatus(thread, update.status);
			}
			return;
		}
		const outcome = outcomes[update.status];
		if (!outcome) return;
		this.#add(thread, { type: 'event', text: outcome[1] });
		this.#setStatus(thread, outcome[0]);
	}

	override async fetch(request: Request) {
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('Expected a WebSocket', { status: 426 });
		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server!);
		return new Response(null, { status: 101, webSocket: client });
	}

	async #converse(thread: string, author: Author, text: string, entry: string) {
		const { mode, machine } = this.#summary(thread)!;
		const [row] = this.#sql
			.exec<Pick<ThreadRow, 'context'>>('SELECT context FROM threads WHERE id = ?', thread)
			.toArray();
		await this.env.ATTEMPTS.getByName(thread).converse({
			repo: this.#repo(),
			mode,
			machine,
			...(row?.context && { context: row.context }),
			author: author.name,
			text,
			entry
		});
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
		if (entry.type !== 'message' || !entry.steering || entry.steering.read) return;
		const read = { ...entry, steering: { read: true } };
		this.#sql.exec('UPDATE entries SET body = ? WHERE seq = ?', JSON.stringify(read), seq);
		this.#broadcast({ type: 'entry', thread, entry: read });
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
		const latest = calls.findLast((call) => call.task === 'attempt') ?? calls.at(-1);
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

	#summary(id: string) {
		const row = this.#sql.exec<ThreadRow>(`${selectThreads} WHERE t.id = ?`, id).toArray()[0];
		return row && toSummary(row);
	}

	#require(id: string) {
		const summary = this.#summary(id);
		if (!summary) throw new Error(`There is no thread ${id}`);
		return summary;
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
		return this.thread(thread)
			?.entries.filter((entry) => entry.type === 'intent')
			.at(-1)?.intent;
	}

	#conversation(thread: string) {
		return (this.thread(thread)?.entries ?? []).flatMap((entry) =>
			entry.type === 'message' ? [{ author: entry.author.name, text: entry.text }] : []
		);
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
		machine: row.machine ?? defaultMachine,
		updatedAt: row.updated_at,
		deleted: row.deleted_at === null ? null : { at: row.deleted_at, by: row.deleted_by ?? '' },
		parent: row.parent ? { id: row.parent, headline: row.parent_headline ?? '' } : null,
		changes: row.changes ? (JSON.parse(row.changes) as DiffSummary) : null,
		base: row.base,
		shipped:
			row.shipped_sha && row.shipped_at
				? { sha: row.shipped_sha, by: row.shipped_by ?? '', at: row.shipped_at }
				: null
	};
}

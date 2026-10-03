import { DurableObject } from 'cloudflare:workers';
import { describeTask, draftIntent, modes, openaiModel, type Step } from '@regit/agent';
import type {
	Author,
	Entry,
	LiveMessage,
	Mode,
	RepoCoordinatorApi,
	ThreadDetail,
	ThreadStatus,
	ThreadSummary
} from '@regit/core';
import { threadPurgeDelayMs } from '@regit/core';
import type { AttemptStatus } from './attempt-sandbox.ts';

export type AttemptUpdate =
	| { type: 'step'; step: Step & { checkpoint?: string } }
	| { type: 'status'; status: AttemptStatus; error: string | null };

type ThreadRow = {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	updated_at: number;
	reopen_status: ThreadStatus | null;
	deleted_at: number | null;
	deleted_by: string | null;
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
			['deleted_by', 'TEXT']
		]) {
			if (!columns.has(name!)) this.#sql.exec(`ALTER TABLE threads ADD COLUMN ${name} ${type}`);
		}
	}

	async openThread({
		author,
		text,
		mode
	}: {
		author: Author;
		text: string;
		mode: Mode;
	}): Promise<ThreadSummary> {
		const id = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
		this.#sql.exec(
			`INSERT INTO threads (id, headline, status, mode, updated_at) VALUES (?, '', 'draft', ?, ?)`,
			id,
			mode,
			Date.now()
		);
		this.#add(id, { type: 'message', author, text });
		this.ctx.waitUntil(this.#redraft(id));
		return this.#summary(id)!;
	}

	async reply(thread: string, { author, text }: { author: Author; text: string }) {
		const summary = this.#active(thread);
		this.#add(thread, { type: 'message', author, text });
		if (summary.status === 'draft') this.ctx.waitUntil(this.#redraft(thread));
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
			repo: this.ctx.id.name!
		});
		this.#add(thread, { type: 'event', text: 'Started the attempt' });
		this.#setStatus(thread, 'running');
	}

	async discard(thread: string, by: Author) {
		const summary = this.#active(thread);
		if (summary.status === 'discarded') return;
		const reopen = summary.status === 'running' ? 'needs-you' : summary.status;
		this.#sql.exec('UPDATE threads SET reopen_status = ? WHERE id = ?', reopen, thread);
		this.#add(thread, { type: 'event', text: `Discarded by ${by.name}` });
		this.#setStatus(thread, 'discarded');
		if (summary.status === 'running') await this.env.ATTEMPTS.getByName(thread).cancel();
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
		if (summary.status === 'running') await this.env.ATTEMPTS.getByName(thread).cancel();
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
			this.#sql.exec('DELETE FROM threads WHERE id = ?', id);
		}
		await this.#schedulePurge();
	}

	threads(): ThreadSummary[] {
		return this.#sql
			.exec<ThreadRow>('SELECT * FROM threads WHERE deleted_at IS NULL ORDER BY updated_at DESC')
			.toArray()
			.map(toSummary);
	}

	thread(id: string): ThreadDetail | null {
		const summary = this.#summary(id);
		if (!summary) return null;
		if (summary.deleted) return { summary, entries: [] };
		const rows = this.#sql
			.exec<{ body: string }>('SELECT body FROM entries WHERE thread = ? ORDER BY seq', id)
			.toArray();
		return { summary, entries: rows.map((row) => JSON.parse(row.body) as Entry) };
	}

	attemptUpdated(thread: string, update: AttemptUpdate) {
		if (!this.#summary(thread)) return;
		if (update.type === 'step') {
			for (const turn of update.step.turns) {
				if (turn.role === 'assistant' && turn.text.trim()) {
					this.#add(thread, { type: 'message', author: agent, text: turn.text.trim() });
				}
			}
			if (update.step.checkpoint) {
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

	async #redraft(thread: string) {
		const { model, effort } = modes.small;
		const conversation = this.#conversation(thread);
		const current = () =>
			this.#summary(thread)?.status === 'draft' &&
			this.#conversation(thread).length === conversation.length;
		let intent;
		try {
			intent = await draftIntent(
				openaiModel({
					gateway: { run: (request) => this.env.MODELS.run(request) },
					model,
					effort,
					sessionId: `${this.ctx.id.name}/${thread}/intent`,
					metadata: { thread, task: 'intent' }
				}),
				conversation
			);
		} catch (error) {
			if (current()) {
				const reason = error instanceof Error ? error.message : String(error);
				this.#add(thread, { type: 'event', text: `Couldn't draft an intent: ${reason}` });
			}
			return;
		}
		if (!current()) return;
		this.#add(thread, { type: 'intent', intent });
		this.#sql.exec('UPDATE threads SET headline = ? WHERE id = ?', intent.headline, thread);
		this.#touch(thread);
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
		const row = this.#sql.exec<ThreadRow>('SELECT * FROM threads WHERE id = ?', id).toArray()[0];
		return row && toSummary(row);
	}

	#require(id: string) {
		const summary = this.#summary(id);
		if (!summary) throw new Error(`There is no thread ${id}`);
		return summary;
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

function toSummary(row: ThreadRow): ThreadSummary {
	return {
		id: row.id,
		headline: row.headline,
		status: row.status,
		mode: row.mode,
		updatedAt: row.updated_at,
		deleted: row.deleted_at === null ? null : { at: row.deleted_at, by: row.deleted_by ?? '' }
	};
}

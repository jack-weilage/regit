import {
	nextScheduled,
	type Automation,
	type AutomationEnd,
	type AutomationTrigger,
	type NormalizedAutomation,
	type ThreadEvent
} from '@regit/core';

type AutomationRow = {
	id: string;
	thread: string;
	name: string;
	trigger: string;
	delay_ms: number;
	message: string;
	run_limit: number;
	runs_done: number;
	created_at: number;
	expires_at: number;
	next_at: number | null;
	last_run_at: number | null;
	note: string | null;
	pending_entry: string | null;
	ended_at: number | null;
	ended_reason: AutomationEnd | null;
	ended_by: string | null;
};

export type DueAutomation = Automation & { note: string | null; pendingEntry: string | null };

const retryDelayMs = 60_000;
const endedShown = 10;

// Thread automations: messages a thread's agent scheduled for its own thread, kept with the coordinator's threads.
export class Automations {
	constructor(private sql: SqlStorage) {
		sql.exec(`CREATE TABLE IF NOT EXISTS automations (
			id TEXT PRIMARY KEY, thread TEXT NOT NULL, name TEXT NOT NULL, trigger TEXT NOT NULL,
			delay_ms INTEGER NOT NULL, message TEXT NOT NULL, run_limit INTEGER NOT NULL,
			runs_done INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
			next_at INTEGER, last_run_at INTEGER, note TEXT, pending_entry TEXT,
			ended_at INTEGER, ended_reason TEXT, ended_by TEXT
		);
		CREATE INDEX IF NOT EXISTS automations_by_thread ON automations (thread, created_at);`);
	}

	create(thread: string, automation: NormalizedAutomation, now: number) {
		const [taken] = this.sql
			.exec(
				'SELECT 1 FROM automations WHERE thread = ? AND name = ? AND ended_at IS NULL',
				thread,
				automation.name
			)
			.toArray();
		if (taken)
			throw new Error(
				`This thread already has an automation named "${automation.name}". Cancel it first or pick another name.`
			);
		const id = crypto.randomUUID().slice(0, 8);
		this.sql.exec(
			'INSERT INTO automations (id, thread, name, trigger, delay_ms, message, run_limit, created_at, expires_at, next_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
			id,
			thread,
			automation.name,
			JSON.stringify(automation.on),
			automation.delayMs,
			automation.message,
			automation.runLimit,
			now,
			automation.expiresAt,
			automation.nextAt
		);
		return this.get(thread, id)!;
	}

	get(thread: string, id: string) {
		const [row] = this.sql
			.exec<AutomationRow>('SELECT * FROM automations WHERE thread = ? AND id = ?', thread, id)
			.toArray();
		return row ? toAutomation(row) : null;
	}

	// Active automations, then the latest few that ended.
	list(thread: string) {
		const active = this.sql
			.exec<AutomationRow>(
				'SELECT * FROM automations WHERE thread = ? AND ended_at IS NULL ORDER BY created_at',
				thread
			)
			.toArray();
		const ended = this.sql
			.exec<AutomationRow>(
				'SELECT * FROM automations WHERE thread = ? AND ended_at IS NOT NULL ORDER BY ended_at DESC LIMIT ?',
				thread,
				endedShown
			)
			.toArray();
		return [...active, ...ended].map(toAutomation);
	}

	cancel(thread: string, id: string, by: string, now: number) {
		const automation = this.get(thread, id);
		if (!automation) throw new Error(`This thread has no automation ${id}`);
		if (automation.ended) return automation;
		this.#end(id, 'cancelled', now, by);
		return this.get(thread, id)!;
	}

	endThread(thread: string, now: number) {
		this.sql.exec(
			"UPDATE automations SET ended_at = ?, ended_reason = 'thread', next_at = NULL WHERE thread = ? AND ended_at IS NULL",
			now,
			thread
		);
	}

	// Starts the countdown of the thread's automations waiting for this event; returns whether any were.
	event(thread: string, event: ThreadEvent, note: string, now: number) {
		const rows = this.sql
			.exec<{ id: string }>(
				"UPDATE automations SET next_at = ? + delay_ms, note = ? WHERE thread = ? AND ended_at IS NULL AND next_at IS NULL AND json_extract(trigger, '$.event') = ? RETURNING id",
				now,
				note,
				thread,
				event
			)
			.toArray();
		return rows.length > 0;
	}

	due(now: number): DueAutomation[] {
		return this.sql
			.exec<AutomationRow>(
				'SELECT * FROM automations WHERE ended_at IS NULL AND (next_at <= ? OR expires_at <= ?) ORDER BY COALESCE(next_at, expires_at)',
				now,
				now
			)
			.toArray()
			.map((row) => ({ ...toAutomation(row), note: row.note, pendingEntry: row.pending_entry }));
	}

	next() {
		const [row] = this.sql
			.exec<{ at: number | null }>(
				'SELECT MIN(MIN(COALESCE(next_at, expires_at), expires_at)) AS at FROM automations WHERE ended_at IS NULL'
			)
			.toArray();
		return row?.at ?? null;
	}

	expire(id: string, now: number) {
		this.#end(id, 'expired', now);
	}

	ran(automation: Automation, entry: string, now: number) {
		const done = automation.runs.done + 1;
		this.sql.exec(
			'UPDATE automations SET runs_done = ?, last_run_at = ?, pending_entry = ?, note = NULL WHERE id = ?',
			done,
			now,
			entry,
			automation.id
		);
		if (done >= automation.runs.limit) return this.#end(automation.id, 'runs', now);
		this.#reschedule(automation, null, now);
	}

	// The last message it delivered is still unread, so this run waits rather than piling up behind it.
	skipped(automation: Automation, now: number) {
		this.#reschedule(automation, now + retryDelayMs, now);
	}

	purge(thread: string) {
		this.sql.exec('DELETE FROM automations WHERE thread = ?', thread);
	}

	#reschedule(automation: Automation, retryAt: number | null, now: number) {
		const next = 'schedule' in automation.on ? nextScheduled(automation.on, now) : retryAt;
		if (next !== null && next > automation.expiresAt)
			return this.#end(automation.id, 'expired', now);
		if (next === null && !('event' in automation.on))
			return this.#end(automation.id, 'expired', now);
		this.sql.exec('UPDATE automations SET next_at = ? WHERE id = ?', next, automation.id);
	}

	#end(id: string, reason: AutomationEnd, now: number, by?: string) {
		this.sql.exec(
			'UPDATE automations SET ended_at = ?, ended_reason = ?, ended_by = ?, next_at = NULL WHERE id = ?',
			now,
			reason,
			by ?? null,
			id
		);
	}
}

function toAutomation(row: AutomationRow): Automation {
	return {
		id: row.id,
		thread: row.thread,
		name: row.name,
		on: JSON.parse(row.trigger) as AutomationTrigger,
		delayMs: row.delay_ms,
		message: row.message,
		runs: { done: row.runs_done, limit: row.run_limit },
		createdAt: row.created_at,
		expiresAt: row.expires_at,
		nextAt: row.next_at,
		lastRunAt: row.last_run_at,
		ended:
			row.ended_at === null
				? null
				: { at: row.ended_at, reason: row.ended_reason!, ...(row.ended_by && { by: row.ended_by }) }
	};
}

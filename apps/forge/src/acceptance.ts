import type { AcceptedIntent, Promotion, ProposalControl, Revision, RunRecord } from '@regit/core';

/** All acceptance records live in the repository owner's SQLite transaction boundary. */
export class Acceptance {
	constructor(private sql: SqlStorage) {
		sql.exec(`
			CREATE TABLE IF NOT EXISTS accepted_intents (id TEXT PRIMARY KEY, proposal TEXT NOT NULL, body TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, proposal TEXT NOT NULL, body TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, proposal TEXT NOT NULL, body TEXT NOT NULL);
			CREATE TABLE IF NOT EXISTS promotions (id TEXT PRIMARY KEY, proposal TEXT NOT NULL, body TEXT NOT NULL);
		`);
	}

	intent(proposal: string): AcceptedIntent | null {
		return this.list<AcceptedIntent>('accepted_intents', proposal).at(-1) ?? null;
	}

	acceptedIntent(id: string): AcceptedIntent | null {
		const [row] = this.sql
			.exec<{ body: string }>('SELECT body FROM accepted_intents WHERE id = ?', id)
			.toArray();
		return row ? (JSON.parse(row.body) as AcceptedIntent) : null;
	}

	run(proposal: string): RunRecord | undefined {
		return this.list<RunRecord>('runs', proposal).at(-1);
	}

	putIntent(value: AcceptedIntent) {
		this.insert('accepted_intents', value);
	}
	putRevision(value: Revision) {
		this.insert('revisions', value);
	}
	putRun(value: RunRecord) {
		this.save('runs', value);
	}
	putPromotion(value: Promotion) {
		this.save('promotions', value);
	}

	promotions(): Promotion[] {
		return this.list<Promotion>('promotions');
	}

	control(proposal: string): ProposalControl {
		return {
			acceptedIntent: this.intent(proposal),
			runs: this.list<RunRecord>('runs', proposal),
			revisions: this.list<Revision>('revisions', proposal),
			promotions: this.list<Promotion>('promotions', proposal)
		};
	}

	private list<T>(table: string, proposal?: string): T[] {
		return this.sql
			.exec<{ body: string }>(
				`SELECT body FROM ${table}${proposal ? ' WHERE proposal = ?' : ''} ORDER BY rowid`,
				...(proposal ? [proposal] : [])
			)
			.toArray()
			.map(({ body }) => JSON.parse(body) as T);
	}

	private insert(table: string, value: { id: string; proposal: string }) {
		this.sql.exec(
			`INSERT INTO ${table} (id, proposal, body) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
			value.id,
			value.proposal,
			JSON.stringify(value)
		);
	}

	private save(table: string, value: { id: string; proposal: string }) {
		this.sql.exec(
			`INSERT INTO ${table} (id, proposal, body) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body`,
			value.id,
			value.proposal,
			JSON.stringify(value)
		);
	}
}

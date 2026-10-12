import type { Promotion } from '@regit/core';

export class Promotions {
	constructor(private sql: SqlStorage) {
		sql.exec(
			'CREATE TABLE IF NOT EXISTS promotions (id TEXT PRIMARY KEY, proposal TEXT NOT NULL, body TEXT NOT NULL)'
		);
	}

	put(value: Promotion) {
		this.sql.exec(
			'INSERT INTO promotions (id, proposal, body) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET body = excluded.body',
			value.id,
			value.proposal,
			JSON.stringify(value)
		);
	}

	list(proposal?: string): Promotion[] {
		return this.sql
			.exec<{ body: string }>(
				`SELECT body FROM promotions${proposal ? ' WHERE proposal = ?' : ''} ORDER BY rowid`,
				...(proposal ? [proposal] : [])
			)
			.toArray()
			.map(({ body }) => JSON.parse(body) as Promotion);
	}
}

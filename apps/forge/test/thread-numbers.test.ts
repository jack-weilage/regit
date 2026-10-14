import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vitest';
import { initializeThreadNumbers } from '../src/thread-numbers.ts';

test('backfills in creation order, includes deleted threads and preserves numbers across restarts', () => {
	const db = new DatabaseSync(':memory:');
	// Execute the migration against real SQLite, as the coordinator does.
	const sql = {
		exec(query: string) {
			if (query.startsWith('PRAGMA')) return { toArray: () => db.prepare(query).all() };
			db.exec(query);
		}
	} as Pick<SqlStorage, 'exec'>;
	try {
		db.exec(`
			CREATE TABLE threads (id TEXT PRIMARY KEY, updated_at INTEGER, deleted_at INTEGER);
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			INSERT INTO threads VALUES ('ffffff', 900, NULL), ('aaaaaa', 100, 1), ('bbbbbb', 500, NULL);
		`);
		initializeThreadNumbers(sql);
		expect(db.prepare('SELECT id, number FROM threads ORDER BY number').all()).toEqual([
			{ id: 'ffffff', number: 1 },
			{ id: 'aaaaaa', number: 2 },
			{ id: 'bbbbbb', number: 3 }
		]);
		expect(db.prepare("SELECT value FROM meta WHERE key = 'last-thread-number'").get()).toEqual({
			value: '3'
		});
		db.exec("UPDATE threads SET updated_at = 1000, deleted_at = NULL WHERE id = 'aaaaaa'");
		initializeThreadNumbers(sql);
		expect(db.prepare("SELECT number FROM threads WHERE id = 'aaaaaa'").get()).toEqual({
			number: 2
		});
		expect(() => db.exec("INSERT INTO threads (id, number) VALUES ('duplicate', 2)")).toThrow();
		db.exec('DELETE FROM threads');
		initializeThreadNumbers(sql);
		expect(db.prepare("SELECT value FROM meta WHERE key = 'last-thread-number'").get()).toEqual({
			value: '3'
		});
	} finally {
		db.close();
	}
});

test('starts an empty repository at zero before allocating its first number', () => {
	const db = new DatabaseSync(':memory:');
	const sql = {
		exec(query: string) {
			if (query.startsWith('PRAGMA')) return { toArray: () => db.prepare(query).all() };
			db.exec(query);
		}
	} as Pick<SqlStorage, 'exec'>;
	try {
		db.exec(
			'CREATE TABLE threads (id TEXT PRIMARY KEY); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)'
		);
		initializeThreadNumbers(sql);
		expect(db.prepare("SELECT value FROM meta WHERE key = 'last-thread-number'").get()).toEqual({
			value: '0'
		});
	} finally {
		db.close();
	}
});

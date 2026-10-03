import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const repos = sqliteTable('repos', {
	name: text().primaryKey(),
	source: text(),
	createdBy: text('created_by').notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const toolchainSnapshots = sqliteTable('toolchain_snapshots', {
	repo: text().primaryKey(),
	snapshotId: text('snapshot_id').notNull(),
	key: text().notNull(),
	image: text().notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

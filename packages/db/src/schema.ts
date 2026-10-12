import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const repos = sqliteTable('repos', {
	name: text().primaryKey(),
	source: text(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	machine: text().notNull().default('standard-1')
});

export const repoMembers = sqliteTable(
	'repo_members',
	{
		repo: text()
			.notNull()
			.references(() => repos.name, { onDelete: 'cascade' }),
		principalId: text('principal_id').notNull(),
		role: text({ enum: ['owner', 'editor', 'viewer'] }).notNull()
	},
	(table) => [primaryKey({ columns: [table.repo, table.principalId] })]
);

export const toolchainSnapshots = sqliteTable('toolchain_snapshots', {
	repo: text().primaryKey(),
	snapshotId: text('snapshot_id').notNull(),
	key: text().notNull(),
	image: text().notNull(),
	size: integer(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const previews = sqliteTable('previews', {
	id: text().primaryKey(),
	repo: text().notNull(),
	thread: text().notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
});

export const gitTokens = sqliteTable('git_tokens', {
	id: text().primaryKey(),
	principalId: text('principal_id').notNull(),
	hash: text().notNull().unique(),
	repo: text().notNull(),
	label: text().notNull(),
	createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
	lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
});

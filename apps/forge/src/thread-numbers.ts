export function initializeThreadNumbers(sql: Pick<SqlStorage, 'exec'>) {
	// TODO: remove the backfill once every coordinator has numbered threads.
	const columns = sql.exec<{ name: string }>('PRAGMA table_info(threads)').toArray();
	if (!columns.some((column) => column.name === 'number')) {
		sql.exec(`
			ALTER TABLE threads ADD COLUMN number INTEGER;
			WITH numbered AS (SELECT id, ROW_NUMBER() OVER (ORDER BY rowid) AS number FROM threads)
			UPDATE threads SET number = (SELECT number FROM numbered WHERE numbered.id = threads.id);
		`);
	}
	sql.exec(`
		CREATE UNIQUE INDEX IF NOT EXISTS threads_by_number ON threads (number);
		INSERT INTO meta (key, value)
		SELECT 'last-thread-number', CAST(COALESCE(MAX(number), 0) AS TEXT) FROM threads WHERE true
		ON CONFLICT DO NOTHING;
	`);
}

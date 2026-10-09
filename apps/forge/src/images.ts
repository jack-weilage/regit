import { Buffer } from 'node:buffer';

export class Images {
	constructor(private sql: SqlStorage) {
		sql.exec(`CREATE TABLE IF NOT EXISTS images (
			id TEXT NOT NULL, thread TEXT NOT NULL, part INTEGER NOT NULL,
			mime TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (id, part)
		);
		CREATE INDEX IF NOT EXISTS images_by_thread ON images (thread);`);
	}

	put(thread: string, url: string) {
		const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
		if (!match || url.length > 6 * 1024 * 1024) throw new Error('Invalid image');
		const data = Buffer.from(match[2]!, 'base64');
		if (!data.length || data.length > 4 * 1024 * 1024) throw new Error('Image exceeds 4 MiB');
		const id = crypto.randomUUID();
		// SQLite rows are limited to 2 MB; keep large screenshots in bounded chunks.
		const chunk = 512 * 1024;
		for (let start = 0; start < data.length; start += chunk) {
			this.sql.exec(
				'INSERT INTO images (id, thread, part, mime, data) VALUES (?, ?, ?, ?, ?)',
				id,
				thread,
				start / chunk,
				match[1]!,
				data.subarray(start, start + chunk)
			);
		}
		return id;
	}

	get(id: string) {
		const rows = this.sql
			.exec<{ mime: string; data: ArrayBuffer }>(
				`SELECT i.mime, i.data FROM images i JOIN threads t ON t.id = i.thread
			 WHERE i.id = ? AND t.deleted_at IS NULL ORDER BY i.part`,
				id
			)
			.toArray();
		if (!rows.length) return null;
		return {
			mime: rows[0]!.mime,
			data: new Uint8Array(Buffer.concat(rows.map((row) => Buffer.from(row.data))))
		};
	}

	purge(thread: string) {
		this.sql.exec('DELETE FROM images WHERE thread = ?', thread);
	}
}

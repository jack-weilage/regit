import type { DiffFile, DiffHunk } from '@regit/core';

const largeFileLines = 1_000;
const keptLines = 5_000;

export function parseDiff(text: string): DiffFile[] {
	const files: DiffFile[] = [];
	let file: DiffFile | undefined;
	let hunk: DiffHunk | undefined;
	let old = 0;
	let next = 0;
	let oldEnd = 1;

	for (const line of text.split('\n')) {
		if (line.startsWith('diff --git ')) {
			const [, from, to] = /^diff --git a\/(.+) b\/(.+)$/.exec(line) ?? [];
			file = { path: to ?? '', change: 'modified', additions: 0, deletions: 0, hunks: [] };
			if (from && from !== to) file.oldPath = from;
			files.push(file);
			hunk = undefined;
			oldEnd = 1;
			continue;
		}
		if (!file) continue;

		if (!hunk) {
			if (line.startsWith('new file mode')) file.change = 'added';
			else if (line.startsWith('deleted file mode')) file.change = 'deleted';
			else if (line.startsWith('rename from ')) file.oldPath = line.slice('rename from '.length);
			else if (line.startsWith('rename to ')) file.path = line.slice('rename to '.length);
			else if (line.startsWith('Binary files ')) file.binary = true;
		}

		const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
		if (header) {
			old = Number(header[1]);
			next = Number(header[3]);
			const oldLength = header[2] === undefined ? 1 : Number(header[2]);
			const start = oldLength === 0 ? old + 1 : old;
			hunk = { skipped: Math.max(0, start - oldEnd), lines: [] };
			if (header[4]) hunk.context = header[4];
			oldEnd = start + oldLength;
			file.hunks.push(hunk);
			continue;
		}
		if (!hunk) continue;

		const text = line.slice(1);
		if (line.startsWith('+')) {
			file.additions++;
			hunk.lines.push({ kind: 'added', new: next++, text });
		} else if (line.startsWith('-')) {
			file.deletions++;
			hunk.lines.push({ kind: 'removed', old: old++, text });
		} else if (line.startsWith(' ')) {
			hunk.lines.push({ kind: 'context', old: old++, new: next++, text });
		}
	}

	for (const file of files) {
		if (file.oldPath && file.change === 'modified') file.change = 'renamed';
		const changed = file.additions + file.deletions;
		if (changed > largeFileLines) file.tooLarge = true;
		if (changed > keptLines) file.hunks = [];
	}
	return files;
}

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
			const [from, to] = headerPaths(line.slice('diff --git '.length));
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
			else if (line.startsWith('rename from '))
				file.oldPath = unquote(line.slice('rename from '.length));
			else if (line.startsWith('rename to ')) file.path = unquote(line.slice('rename to '.length));
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

// Git C-quotes paths with special characters ("a/caf\303\251.md"); an unquoted path never contains a quote.
function headerPaths(rest: string): [string?, string?] {
	let from: string | undefined;
	let to: string | undefined;
	if (rest.startsWith('"')) {
		const end = quotedEnd(rest);
		from = unquote(rest.slice(0, end));
		to = unquote(rest.slice(end + 1));
	} else if (rest.includes('"')) {
		const start = rest.indexOf('"');
		from = rest.slice(0, start - 1);
		to = unquote(rest.slice(start));
	} else {
		const half = (rest.length - 1) / 2;
		if (Number.isInteger(half) && rest.slice(2, half) === rest.slice(half + 3)) {
			from = rest.slice(0, half);
			to = rest.slice(half + 1);
		} else {
			[, from, to] = /^(a\/.+) (b\/.+)$/.exec(rest) ?? [];
		}
	}
	return [from?.replace(/^a\//, ''), to?.replace(/^b\//, '')];
}

function quotedEnd(text: string) {
	for (let index = 1; index < text.length; index++) {
		if (text[index] === '\\') index++;
		else if (text[index] === '"') return index + 1;
	}
	return text.length;
}

const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13 };

function unquote(path: string) {
	if (!path.startsWith('"') || !path.endsWith('"') || path.length < 2) return path;
	const bytes: number[] = [];
	const encoder = new TextEncoder();
	for (const [token, escaped] of path.slice(1, -1).matchAll(/\\([0-7]{3}|[\s\S])|[^\\]+/g)) {
		if (escaped === undefined) bytes.push(...encoder.encode(token));
		else if (escaped.length === 3) bytes.push(parseInt(escaped, 8));
		else bytes.push(escapes[escaped] ?? escaped.charCodeAt(0));
	}
	return new TextDecoder().decode(new Uint8Array(bytes));
}

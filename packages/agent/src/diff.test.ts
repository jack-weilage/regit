import { expect, test } from 'bun:test';
import { parseDiff } from './diff.ts';

const diff = `diff --git a/src/members.ts b/src/members.ts
index 1111111..2222222 100644
--- a/src/members.ts
+++ b/src/members.ts
@@ -1,3 +1,3 @@
 import { db } from './db';
-export const all = () => db.members();
+export const page = (limit: number) => db.members({ limit });
 export const count = () => db.count();
@@ -20,2 +20,3 @@ export function load() {
 	return page(50);
+	// TODO: paginate
 }
diff --git a/README.md b/README.md
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/README.md
@@ -0,0 +1,2 @@
+# Members
+Paged.
diff --git a/old.txt b/old.txt
deleted file mode 100644
--- a/old.txt
+++ /dev/null
@@ -1 +0,0 @@
-gone
diff --git a/src/audit-log.ts b/src/audit.ts
similarity index 90%
rename from src/audit-log.ts
rename to src/audit.ts
--- a/src/audit-log.ts
+++ b/src/audit.ts
@@ -5,1 +5,1 @@
-export const log = 1;
+export const last = 1;
diff --git a/logo.png b/logo.png
index 4444444..5555555 100644
Binary files a/logo.png and b/logo.png differ
diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
`;

test('parses files, hunks and line numbers', () => {
	const [members, readme, old, audit, logo, moved] = parseDiff(diff);

	expect(members).toMatchObject({
		path: 'src/members.ts',
		change: 'modified',
		additions: 2,
		deletions: 1
	});
	expect(members!.hunks.map((hunk) => [hunk.skipped, hunk.context])).toEqual([
		[0, undefined],
		[16, 'export function load() {']
	]);
	expect(members!.hunks[0]!.lines).toEqual([
		{ kind: 'context', old: 1, new: 1, text: "import { db } from './db';" },
		{ kind: 'removed', old: 2, text: 'export const all = () => db.members();' },
		{
			kind: 'added',
			new: 2,
			text: 'export const page = (limit: number) => db.members({ limit });'
		},
		{ kind: 'context', old: 3, new: 3, text: 'export const count = () => db.count();' }
	]);
	expect(members!.hunks[1]!.lines.at(1)).toEqual({
		kind: 'added',
		new: 21,
		text: '\t// TODO: paginate'
	});

	expect(readme).toMatchObject({ path: 'README.md', change: 'added', additions: 2, deletions: 0 });
	expect(readme!.hunks[0]).toMatchObject({ skipped: 0, lines: [{ new: 1 }, { new: 2 }] });
	expect(old).toMatchObject({ path: 'old.txt', change: 'deleted', deletions: 1 });
	expect(audit).toMatchObject({
		path: 'src/audit.ts',
		oldPath: 'src/audit-log.ts',
		change: 'renamed'
	});
	expect(audit!.hunks[0]!.skipped).toBe(4);
	expect(logo).toMatchObject({ path: 'logo.png', binary: true, hunks: [] });
	expect(moved).toMatchObject({ path: 'b.txt', oldPath: 'a.txt', change: 'renamed', hunks: [] });
});

test('marks large files, dropping hunks that are too big to keep', () => {
	const lines = (count: number) => Array.from({ length: count }, (_, i) => `+line ${i}`).join('\n');
	const [large, huge] = parseDiff(
		`diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,1500 @@\n${lines(1500)}\ndiff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -0,0 +1,6000 @@\n${lines(6000)}\n`
	);
	expect(large).toMatchObject({ additions: 1500, tooLarge: true });
	expect(large!.hunks[0]!.lines).toHaveLength(1500);
	expect(huge).toMatchObject({ additions: 6000, tooLarge: true, hunks: [] });
});

test('returns nothing for an empty diff', () => {
	expect(parseDiff('')).toEqual([]);
});

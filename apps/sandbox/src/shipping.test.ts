import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'bun:test';
import { git } from './exec.ts';
import {
	author,
	call,
	dir,
	fetch,
	remote,
	root,
	useWorkspace,
	workspace
} from './test-workspace.ts';

useWorkspace();

describe('shipping', () => {
	const sam = { name: 'Sam Rivera', email: 'sam@example.com' };
	let base: string;

	async function checkpoint(content: string, message: string) {
		await call('write_file', { path: 'greeting.ts', content });
		return workspace.commit({ message, author });
	}

	async function landOnMain(content: string) {
		const elsewhere = join(dir, 'elsewhere');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'greeting.ts'), content);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-am',
			'Main moved'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
	}

	beforeEach(async () => {
		base = await git(root, ['rev-parse', 'HEAD']);
	});

	const id = 'a'.repeat(32);

	function build(sourceSha: string, shipId = id) {
		return workspace.buildShip({
			id: shipId,
			sourceSha,
			base,
			remote,
			branch: 'main',
			message: 'Trusted squash',
			author: sam,
			committer: author
		});
	}

	async function ship(sourceSha: string, shipId = id) {
		const built = await build(sourceSha, shipId);
		if (!built.shipped) await workspace.pushShip({ ...built, remote, branch: 'main' });
		return { sha: built.sha };
	}

	test('reports how far behind main each fork is and which conflict', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await git(root, ['push', remote, 'HEAD:refs/heads/conflicting']);
		await git(root, ['reset', '--hard', base]);
		await call('write_file', { path: 'farewell.ts', content: "export const bye = 'bye';\n" });
		await workspace.commit({ message: 'Say bye', author });
		await git(root, ['push', remote, 'HEAD:refs/heads/clean']);
		await landOnMain("export const greeting = 'hey';\n");

		expect(
			await workspace.compare({
				remote,
				forks: [
					{ id: 'a', remote, branch: 'conflicting' },
					{ id: 'b', remote, branch: 'clean' },
					{ id: 'c', remote, branch: 'missing' }
				]
			})
		).toEqual({
			main: await git(remote, ['rev-parse', 'main']),
			branch: 'main',
			headline: 'Main moved',
			threads: [
				{ id: 'a', behind: 1, conflicts: ['greeting.ts'] },
				{ id: 'b', behind: 1, conflicts: [] }
			]
		});
	});

	test('holds checkpoints while a merge from main still has conflict markers', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await landOnMain("export const greeting = 'hey';\n");
		const main = await git(remote, ['rev-parse', 'main']);
		await git(root, ['fetch', remote, 'main']);
		await expect(
			git(root, [
				'-c',
				'user.name=ReGit',
				'-c',
				'user.email=agent@regit.dev',
				'merge',
				'FETCH_HEAD'
			])
		).rejects.toThrow(/CONFLICT/);

		expect(await workspace.commit({ message: 'Too early', author })).toBeNull();
		await call('write_file', {
			path: 'greeting.ts',
			content: "export const greeting = 'hi, hey';\n"
		});
		const sha = await workspace.commit({ message: 'Merge main', author });
		expect((await git(root, ['rev-list', '--parents', '-1', sha!])).split(' ')).toContain(main);
		expect(await git(root, ['show', `${sha}:greeting.ts`])).toBe(
			"export const greeting = 'hi, hey';"
		);
	});

	test('ships the exact source tree as one commit on main, and a retry finds it instead of shipping twice', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'First');
		await writeFile(join(root, 'source-only.txt'), 'source\n');
		const sourceSha = (await workspace.commit({ message: 'Second', author }))!;
		await checkpoint("export const greeting = 'not selected';\n", 'Unselected');
		const elsewhere = join(dir, 'canonical');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'canonical-only.txt'), 'canonical\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-m',
			'Independent'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
		const independent = await git(remote, ['rev-parse', 'main']);

		const { sha } = await ship(sourceSha);
		expect(await git(remote, ['rev-parse', 'main'])).toBe(sha);
		expect(await git(remote, ['rev-list', '--parents', '-1', sha])).toBe(`${sha} ${independent}`);
		expect(await git(remote, ['show', `${sha}:greeting.ts`])).toContain("'hi'");
		expect(await git(remote, ['show', `${sha}:source-only.txt`])).toBe('source');
		expect(await git(remote, ['show', `${sha}:canonical-only.txt`])).toBe('canonical');
		expect(await git(remote, ['log', '-1', '--format=%an|%ae|%cn|%ce', sha])).toBe(
			'Sam Rivera|sam@example.com|ReGit|agent@regit.dev'
		);
		expect(await git(remote, ['log', '-1', '--format=%B', sha])).toBe(
			`Trusted squash\n\nReGit-Ship: ${id}`
		);

		expect(await build(sourceSha)).toEqual({ sha, head: sha, shipped: true });
		expect(await git(remote, ['rev-list', '--count', `${base}..main`])).toBe('2');
	});

	test('ships onto whatever main is when it runs', async () => {
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		const elsewhere = join(dir, 'unrelated');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'other.txt'), 'other\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-m',
			'Other'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
		const moved = await git(remote, ['rev-parse', 'main']);

		const { sha } = await ship(sourceSha);
		expect(await git(remote, ['rev-parse', 'main^'])).toBe(moved);
		expect(await git(remote, ['rev-parse', 'main'])).toBe(sha);
	});

	test('refuses to push when main moved after the build, so the ship can be rebuilt', async () => {
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		const built = await build(sourceSha);
		const elsewhere = join(dir, 'racing');
		await git(dir, ['clone', remote, elsewhere]);
		await writeFile(join(elsewhere, 'other.txt'), 'other\n');
		await git(elsewhere, ['add', '.']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'commit',
			'-m',
			'Other'
		]);
		await git(elsewhere, ['push', 'origin', 'main']);
		const moved = await git(remote, ['rev-parse', 'main']);

		expect(await workspace.pushShip({ ...built, remote, branch: 'main' })).toEqual({
			pushed: false
		});
		expect(await git(remote, ['rev-parse', 'main'])).toBe(moved);
		const rebuilt = await build(sourceSha);
		expect(rebuilt).toMatchObject({ head: moved, shipped: false });
		expect(await workspace.pushShip({ ...rebuilt, remote, branch: 'main' })).toEqual({
			pushed: true
		});
		expect(await git(remote, ['rev-parse', 'main^'])).toBe(moved);
	});

	test('reports conflicting files, leaves no rebase behind and rejects empty or invalid ships', async () => {
		await expect(ship(base)).rejects.toThrow('Nothing to ship');
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		await landOnMain("export const greeting = 'conflict';\n");
		const head = await git(remote, ['rev-parse', 'main']);
		await expect(ship(sourceSha)).rejects.toThrow('Ship conflicts with main in greeting.ts');
		expect(await git(remote, ['rev-parse', 'main'])).toBe(head);
		await expect(readFile(join(root, '.git/rebase-merge/head-name'))).rejects.toThrow();
		await expect(readFile(join(root, '.git/rebase-apply/head-name'))).rejects.toThrow();
		expect(await git(root, ['diff', '--name-only', '--diff-filter=U'])).toBe('');
		await expect(ship(sourceSha, 'not-an-id')).rejects.toThrow('Invalid ship id');
		await expect(
			workspace.buildShip({
				id,
				sourceSha,
				base,
				remote,
				branch: '--all',
				message: 'x',
				author: sam,
				committer: author
			})
		).rejects.toThrow('Invalid branch');
	});

	test('explicitly synchronizes notes without losing another publisher notes', async () => {
		const sourceSha = (await checkpoint("export const greeting = 'hi';\n", 'Source'))!;
		const shipped = await ship(sourceSha);
		await workspace.publishProvenance({ sha: shipped.sha, remote, note: '{"attempt":1}' });
		const elsewhere = join(dir, 'notes-publisher');
		await git(dir, ['clone', remote, elsewhere]);
		await git(elsewhere, ['fetch', 'origin', 'refs/notes/regit:refs/notes/regit']);
		await git(elsewhere, [
			'-c',
			'user.name=Lin',
			'-c',
			'user.email=lin@example.com',
			'notes',
			'--ref=regit',
			'add',
			'-m',
			'{"other":true}',
			base
		]);
		await git(elsewhere, ['push', 'origin', 'refs/notes/regit']);
		await workspace.publishProvenance({ sha: shipped.sha, note: '{"attempt":2}' });
		expect(await git(remote, ['notes', '--ref=regit', 'show', base])).toBe('{"other":true}');
		expect(await git(remote, ['notes', '--ref=regit', 'show', shipped.sha])).toBe('{"attempt":2}');
		await expect(
			workspace.publishProvenance({
				sha: shipped.sha,
				remote: join(dir, 'missing.git'),
				note: '{}'
			})
		).rejects.toThrow('Notes discovery failed');
		expect(await git(remote, ['rev-parse', 'main'])).toBe(shipped.sha);
	});

	test("finds the branch a remote's HEAD points to", async () => {
		expect(await workspace.headBranch({ remote })).toBe('main');
		await git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
		await git(root, ['push', 'origin', 'main:trunk']);
		expect(await workspace.headBranch({ remote })).toBe('trunk');
	});

	test('diffs the work against the commit it started from', async () => {
		await checkpoint("export const greeting = 'hi';\n", 'Say hi');
		await call('write_file', { path: 'farewell.ts', content: "export const bye = 'bye';\n" });
		await workspace.commit({ message: 'Say bye', author });

		const diff = await workspace.diff({ base });
		expect(diff).toContain("-export const greeting = 'hello';\n+export const greeting = 'hi';");
		expect(diff).toContain('new file mode');
	});
});

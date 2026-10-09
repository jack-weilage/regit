import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type ReposWorker from './repos-worker.ts';

const server = createTestHarness({
	workers: [
		{ configPath: './test/wrangler.jsonc', bindingOverrides: { ARTIFACTS: 'fake-artifacts' } },
		{
			config: {
				name: 'fake-artifacts',
				main: './test/fake-artifacts.ts',
				compatibility_date: '2026-10-01'
			}
		}
	]
});
const worker = server.getWorker<Env, { default: typeof ReposWorker }>();

beforeAll(async () => {
	await server.listen();
	expect(await (await worker.getExport()).usesFakeArtifacts()).toBe(true);
});
beforeEach(() => worker.applyD1Migrations('DB'));
afterEach(() => server.reset());
afterAll(() => server.close());

test('creates and imports repositories, recording who made them', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'fresh', createdBy: 'sam@regit.dev' });
	await repos.create({
		name: 'kit',
		source: 'https://github.com/sveltejs/kit',
		createdBy: 'lin@regit.dev'
	});

	const env = await worker.getEnv();
	const { results } = await env.DB.prepare(
		'SELECT name, source, created_by FROM repos ORDER BY name'
	).all();
	expect(results).toEqual([
		{ name: 'fresh', source: null, created_by: 'sam@regit.dev' },
		{ name: 'kit', source: 'https://github.com/sveltejs/kit', created_by: 'lin@regit.dev' }
	]);
	expect(await repos.exists('kit')).toBe(true);
	expect(await repos.exists('missing')).toBe(false);
});

test('rejects a taken name', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'fresh', createdBy: 'sam@regit.dev' });
	await expect(
		Promise.resolve().then(() => repos.create({ name: 'fresh', createdBy: 'lin@regit.dev' }))
	).rejects.toThrow('fresh already exists.');
});

test('releases the name when the import fails', async () => {
	const repos = await worker.getExport();
	const source = 'https://unreachable.test/acme/kit';
	await expect(
		Promise.resolve().then(() => repos.create({ name: 'kit', source, createdBy: 'sam@regit.dev' }))
	).rejects.toThrow('The import failed');
	expect(await repos.exists('kit')).toBe(false);
});

test('repository permissions distinguish anonymous, unrelated, viewer, editor and owner and reread membership', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'demo', createdBy: 'sam@regit.dev', principalId: 'owner' });
	await repos.create({ name: 'other', createdBy: 'lin@regit.dev', principalId: 'unrelated' });
	const { DB } = await worker.getEnv();
	await DB.prepare(
		"INSERT INTO repo_members VALUES ('demo', 'viewer', 'viewer'), ('demo', 'editor', 'editor')"
	).run();
	for (const [id, expected] of [
		[null, [false, false, false]],
		['unrelated', [false, false, false]],
		['viewer', [true, false, false]],
		['editor', [true, true, false]],
		['owner', [true, true, true]]
	] as const) {
		const actual = await Promise.all(
			(['viewer', 'editor', 'owner'] as const).map((role) => repos.allowed('demo', id, role))
		);
		expect(actual).toEqual(expected);
	}
	await DB.prepare("DELETE FROM repo_members WHERE principal_id = 'editor'").run();
	expect(await repos.allowed('demo', 'editor', 'viewer')).toBe(false);
});

test('legacy creators claim only exact authenticated emails once, never restoring revoked access', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'legacy', createdBy: 'sam@regit.dev' });
	const { DB } = await worker.getEnv();
	await DB.prepare(
		"INSERT INTO git_tokens (id, hash, repo, scope, label, created_by, created_at, expires_at) VALUES ('legacy-token', 'hash', 'legacy', 'read', 'Laptop', 'sam@regit.dev', 0, 9999999999999)"
	).run();
	await repos.claim({ id: 'wrong', name: 'Sam', email: 'other@regit.dev' });
	expect(await repos.allowed('legacy', 'wrong', 'owner')).toBe(false);
	await repos.claim({ id: 'sam', name: 'Sam', email: 'sam@regit.dev' });
	expect(await repos.allowed('legacy', 'sam', 'owner')).toBe(true);
	await DB.prepare("DELETE FROM repo_members WHERE repo = 'legacy'").run();
	await repos.claim({ id: 'sam', name: 'Sam', email: 'sam@regit.dev' });
	await repos.claim({ id: 'replacement', name: 'Sam', email: 'sam@regit.dev' });
	expect(await repos.allowed('legacy', 'sam', 'viewer')).toBe(false);
	expect(await repos.allowed('legacy', 'replacement', 'viewer')).toBe(false);
	expect(
		await DB.prepare("SELECT principal_id FROM git_tokens WHERE id = 'legacy-token'").first()
	).toEqual({ principal_id: 'sam' });
});

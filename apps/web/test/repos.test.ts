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

test('creates and imports repositories, making their creators owners', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'fresh', principalId: 'sam' });
	await repos.create({
		name: 'kit',
		source: 'https://github.com/sveltejs/kit',
		principalId: 'lin'
	});

	const env = await worker.getEnv();
	const { results } = await env.DB.prepare('SELECT name, source FROM repos ORDER BY name').all();
	expect(results).toEqual([
		{ name: 'fresh', source: null },
		{ name: 'kit', source: 'https://github.com/sveltejs/kit' }
	]);
	expect(await repos.allowed('fresh', 'sam', 'owner')).toBe(true);
	expect(await repos.allowed('kit', 'sam', 'viewer')).toBe(false);
	expect(await repos.exists('kit')).toBe(true);
	expect(await repos.exists('missing')).toBe(false);
});

test('rejects a taken name', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'fresh', principalId: 'sam' });
	await expect(
		Promise.resolve().then(() => repos.create({ name: 'fresh', principalId: 'lin' }))
	).rejects.toThrow('fresh already exists.');
});

test('releases the name when the import fails', async () => {
	const repos = await worker.getExport();
	const source = 'https://unreachable.test/acme/kit';
	await expect(
		Promise.resolve().then(() => repos.create({ name: 'kit', source, principalId: 'sam' }))
	).rejects.toThrow('The import failed');
	expect(await repos.exists('kit')).toBe(false);
});

test('repository permissions distinguish anonymous, unrelated, viewer, editor and owner and reread membership', async () => {
	const repos = await worker.getExport();
	await repos.create({ name: 'demo', principalId: 'owner' });
	await repos.create({ name: 'other', principalId: 'unrelated' });
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

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

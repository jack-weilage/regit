import { hashGitToken } from '@regit/db';
import { createTestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import type TokensWorker from './tokens-worker.ts';

const server = createTestHarness({ workers: [{ configPath: './test/tokens.wrangler.jsonc' }] });
const worker = server.getWorker<Env, { default: typeof TokensWorker }>();

beforeAll(() => server.listen());
beforeEach(() => worker.applyD1Migrations('DB'));
afterEach(() => server.reset());
afterAll(() => server.close());

test('creates tokens that are stored hashed, lists them per person and revokes them', async () => {
	const tokens = await worker.getExport();
	const created = await tokens.create({
		repo: 'demo',
		days: 30,
		createdBy: 'sam@regit.dev'
	});
	expect(created.secret).toMatch(/^regit_[0-9a-f]{48}$/);
	expect(created.expiresAt - created.createdAt).toBe(30 * 86_400_000);

	const { results } = await (await worker.getEnv()).DB.prepare('SELECT hash FROM git_tokens').all();
	expect(results).toEqual([{ hash: await hashGitToken(created.secret) }]);

	const mine = await tokens.list('demo', 'sam@regit.dev');
	expect(mine.map(({ id, label, scope }) => ({ id, label, scope }))).toEqual([
		{ id: created.id, label: 'Laptop', scope: 'read' }
	]);
	expect(mine[0]).not.toHaveProperty('hash');
	expect(await tokens.list('demo', 'lin@regit.dev')).toEqual([]);
	expect(await tokens.list('other', 'sam@regit.dev')).toEqual([]);

	await tokens.revoke(created.id, 'lin@regit.dev');
	expect(await tokens.list('demo', 'sam@regit.dev')).toHaveLength(1);
	await tokens.revoke(created.id, 'sam@regit.dev');
	expect(await tokens.list('demo', 'sam@regit.dev')).toEqual([]);
});

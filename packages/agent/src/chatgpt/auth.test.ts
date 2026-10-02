import { describe, expect, test } from 'vitest';
import { ChatGPTAuth } from './auth.ts';
import { fakeFetch, jwt, memoryStore } from './testing.ts';

const now = Date.UTC(2026, 9, 2);
const tokensExpiringIn = (ms: number) => ({
	accessToken: jwt({ exp: (now + ms) / 1000 }),
	refreshToken: 'refresh-1',
	accountId: 'account'
});

describe('ChatGPTAuth', () => {
	test('uses stored tokens while they are fresh', async () => {
		const { fetch, requests } = fakeFetch();
		const auth = new ChatGPTAuth(memoryStore(tokensExpiringIn(60 * 60 * 1000)), {
			fetch,
			now: () => now
		});

		await auth.tokens();
		expect(requests).toHaveLength(0);
	});

	test('refreshes tokens that expire within five minutes and saves the rotated ones', async () => {
		const store = memoryStore(tokensExpiringIn(60 * 1000));
		const { fetch, requests } = fakeFetch(
			Response.json({ access_token: 'access-2', refresh_token: 'refresh-2' })
		);
		const auth = new ChatGPTAuth(store, { fetch, now: () => now });

		const tokens = await auth.tokens();
		expect(requests[0]!.body).toMatchObject({
			grant_type: 'refresh_token',
			refresh_token: 'refresh-1'
		});
		expect(tokens).toMatchObject({
			accessToken: 'access-2',
			refreshToken: 'refresh-2',
			accountId: 'account'
		});
		expect(store.tokens.refreshToken).toBe('refresh-2');
	});

	test('shares one refresh between concurrent callers', async () => {
		const { fetch, requests } = fakeFetch(Response.json({ access_token: 'access-2' }));
		const auth = new ChatGPTAuth(memoryStore(tokensExpiringIn(0)), { fetch, now: () => now });

		await Promise.all([auth.tokens(), auth.tokens()]);
		expect(requests).toHaveLength(1);
	});

	test('throws when the refresh is rejected', async () => {
		const { fetch } = fakeFetch(new Response(null, { status: 401 }));
		const auth = new ChatGPTAuth(memoryStore(tokensExpiringIn(0)), { fetch, now: () => now });

		await expect(auth.tokens()).rejects.toThrow('failed with 401');
	});
});

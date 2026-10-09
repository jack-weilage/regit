import { expect, test, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { GET } from '../src/routes/[repo]/images/[id]/+server.ts';

const state = vi.hoisted(() => ({ member: true }));
vi.mock('#lib/server/access.ts', () => ({
	requireRepoAccess: async (repo: string, user: string | undefined) => {
		if (repo !== 'demo' || user !== 'viewer' || !state.member)
			error(403, 'Repository access denied');
	}
}));
vi.mock('#lib/server/coordinators.ts', () => ({
	coordinatorFor: () => ({
		image: async (id: string) =>
			id === 'image-1'
				? {
						mime: 'image/png',
						data: new Uint8Array([137, 80, 78, 71])
					}
				: null
	})
}));

function get(repo = 'demo', user: string | undefined = 'viewer', id = 'image-1') {
	return GET({
		params: { repo, id },
		locals: { user: user ? { id: user } : undefined }
	} as Parameters<typeof GET>[0]);
}

test('serves private image bytes only while the viewer has repository access', async () => {
	const response = await get();
	expect(response.headers.get('Content-Type')).toBe('image/png');
	expect(response.headers.get('Cache-Control')).toBe('private, no-store');
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
	expect((await get('demo', 'viewer', 'missing')).status).toBe(404);
	await expect(get('demo', '')).rejects.toMatchObject({ status: 403 });
	await expect(get('other')).rejects.toMatchObject({ status: 403 });
	state.member = false;
	await expect(get()).rejects.toMatchObject({ status: 403 });
});

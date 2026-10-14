import { beforeEach, expect, test, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { load } from '../src/routes/[repo]/[thread]/+page.server.ts';

const state = vi.hoisted(() => ({
	member: true,
	resolve: vi.fn<(ref: string) => Promise<{ id: string; number: number } | null>>()
}));
vi.mock('#lib/server/access.ts', () => ({
	requireRepoAccess: async (repo: string, user: string | undefined) => {
		if (repo !== 'demo' || user !== 'viewer' || !state.member)
			error(403, 'Repository access denied');
	}
}));
vi.mock('#lib/server/coordinators.ts', () => ({
	coordinatorFor: () => ({ resolveThread: state.resolve })
}));

function open(ref: string, repo = 'demo', user: string | undefined = 'viewer', search = '') {
	return load({
		params: { repo, thread: ref },
		locals: { user: user ? { id: user } : undefined },
		url: new URL(`https://regit.dev/${repo}/${ref}${search}`)
	} as Parameters<typeof load>[0]);
}

beforeEach(() => {
	state.member = true;
	state.resolve.mockReset().mockImplementation(async (ref) => {
		if (['42', '00042', 'abcdef012345'].includes(ref)) return { id: 'abcdef012345', number: 42 };
		if (['7', '123456789012'].includes(ref)) return { id: '123456789012', number: 7 };
		return null;
	});
});

test('numeric routes return internal identity for actions, active selection and live subscriptions', async () => {
	await expect(open('42')).resolves.toEqual({ threadRef: { id: 'abcdef012345', number: 42 } });
	expect(state.resolve).toHaveBeenCalledWith('42');
});

test('legacy hex links permanently redirect to the numbered URL, preserving query parameters', async () => {
	await expect(open('abcdef012345', 'demo', 'viewer', '?panel=changes')).rejects.toMatchObject({
		status: 308,
		location: '/demo/42?panel=changes'
	});
	await expect(open('123456789012')).rejects.toMatchObject({ status: 308, location: '/demo/7' });
	await expect(open('7')).resolves.toEqual({ threadRef: { id: '123456789012', number: 7 } });
});

test('normalizes noncanonical decimal URLs without redirect loops', async () => {
	await expect(open('00042')).rejects.toMatchObject({ status: 308, location: '/demo/42' });
	await expect(open('42')).resolves.toHaveProperty('threadRef.number', 42);
});

test('unknown thread identifiers are not found', async () => {
	for (const ref of ['43', 'ffffffffffff', '0', 'bad']) {
		await expect(open(ref)).rejects.toMatchObject({ status: 404 });
	}
});

test('checks repository access before looking up or redirecting private threads', async () => {
	await expect(open('abcdef012345', 'demo', '')).rejects.toMatchObject({ status: 403 });
	await expect(open('42', 'other')).rejects.toMatchObject({ status: 403 });
	state.member = false;
	await expect(open('abcdef012345')).rejects.toMatchObject({ status: 403 });
	expect(state.resolve).not.toHaveBeenCalled();
});

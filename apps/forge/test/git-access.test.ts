import { describe, expect, test } from 'vitest';
import { proxyGit, proxyGitTargets, type GitAccess } from '../src/git-access.ts';

const remote = 'https://account.artifacts.cloudflare.net/git/regit/greeting--thread-1.git';
const access: GitAccess = { remote, token: 'fork-token', push: false };

function upstream() {
	const requests: Request[] = [];
	const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push(new Request(input, init));
		return new Response('ok');
	}) as typeof globalThis.fetch;
	return { fetch, requests };
}

describe('proxyGit', () => {
	test('forwards fetches from the fork with its token', async () => {
		const { fetch, requests } = upstream();
		const response = await proxyGit(
			new Request(`${remote}/info/refs?service=git-upload-pack`),
			access,
			fetch
		);

		expect(response.status).toBe(200);
		expect(requests[0]!.url).toBe(`${remote}/info/refs?service=git-upload-pack`);
		expect(requests[0]!.headers.get('authorization')).toBe('Bearer fork-token');
	});

	test('refuses other repositories and hosts', async () => {
		const { fetch, requests } = upstream();
		const other = remote.replace('greeting--thread-1', 'greeting');
		expect(
			(await proxyGit(new Request(`${other}/info/refs?service=git-upload-pack`), access, fetch))
				.status
		).toBe(403);
		expect((await proxyGit(new Request(`${remote}x/info/refs`), access, fetch)).status).toBe(403);
		expect(
			(
				await proxyGit(
					new Request('https://example.com/git/regit/greeting--thread-1.git/info/refs'),
					access,
					fetch
				)
			).status
		).toBe(403);
		expect(requests).toHaveLength(0);
	});

	test('reaches several repositories, each with its own token, pushing only where allowed', async () => {
		const { fetch, requests } = upstream();
		const main = remote.replace('greeting--thread-1', 'greeting');
		const targets: GitAccess[] = [
			{ ...access, push: true },
			{ remote: main, token: 'main-token', push: false }
		];
		const read = await proxyGitTargets(
			new Request(`${main}/info/refs?service=git-upload-pack`),
			targets,
			fetch
		);
		expect(read.status).toBe(200);
		expect(requests[0]!.headers.get('authorization')).toBe('Bearer main-token');

		const push = (repo: string) =>
			proxyGitTargets(
				new Request(`${repo}/git-receive-pack`, { method: 'POST', body: 'pack' }),
				targets,
				fetch
			);
		expect((await push(main)).status).toBe(403);
		expect((await push(remote)).status).toBe(200);
		expect(requests[1]!.headers.get('authorization')).toBe('Bearer fork-token');

		const other = remote.replace('greeting--thread-1', 'greeting--thread-2');
		expect((await proxyGitTargets(new Request(`${other}/info/refs`), targets, fetch)).status).toBe(
			403
		);
		expect(requests).toHaveLength(2);
	});

	test('only lets pushes through while a checkpoint is being pushed', async () => {
		const { fetch, requests } = upstream();
		const advertise = () => new Request(`${remote}/info/refs?service=git-receive-pack`);
		const upload = () =>
			new Request(`${remote}/git-receive-pack`, { method: 'POST', body: 'pack' });

		expect((await proxyGit(advertise(), access, fetch)).status).toBe(403);
		expect((await proxyGit(upload(), access, fetch)).status).toBe(403);
		expect(await (await proxyGit(upload(), { ...access, push: true }, fetch)).text()).toBe('ok');
		expect(requests).toHaveLength(1);
	});
});

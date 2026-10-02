export interface GitAccess {
	remote: string;
	token: string;
	push: boolean;
}

export function proxyGit(
	request: Request,
	{ remote, token, push }: GitAccess,
	fetch = globalThis.fetch
) {
	const url = new URL(request.url);
	const repo = new URL(remote);
	const inRepo = url.pathname === repo.pathname || url.pathname.startsWith(`${repo.pathname}/`);
	if (url.host !== repo.host || !inRepo) {
		return new Response("Only this attempt's fork is reachable", { status: 403 });
	}

	const service = url.searchParams.get('service') ?? url.pathname.split('/').at(-1);
	if (service === 'git-receive-pack' && !push) {
		return new Response('Pushes go through checkpoints', { status: 403 });
	}

	const forwarded = new Request(url, request);
	forwarded.headers.set('Authorization', `Bearer ${token}`);
	return fetch(forwarded);
}

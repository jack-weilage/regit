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
	if (!reaches(url, remote)) {
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

// Proxies to whichever of the targets the request is for, each with its own token and push rule.
export function proxyGitTargets(request: Request, targets: GitAccess[], fetch = globalThis.fetch) {
	const url = new URL(request.url);
	const target = targets.find(({ remote }) => reaches(url, remote));
	if (!target) return new Response('Repository is not authorized', { status: 403 });
	return proxyGit(request, target, fetch);
}

function reaches(url: URL, remote: string) {
	const repo = new URL(remote);
	return (
		url.host === repo.host &&
		(url.pathname === repo.pathname || url.pathname.startsWith(`${repo.pathname}/`))
	);
}

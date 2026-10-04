import { createServices, type ServicesOptions } from './services.ts';
import { isTool, ToolError, tools } from './tools.ts';
import {
	abortRebase,
	clone,
	commit,
	continueRebase,
	diff,
	headBranch,
	push,
	rebase,
	squash,
	toolchain
} from './workspace.ts';

export interface SandboxOptions {
	mise?: string;
	services?: ServicesOptions;
}

export function createSandbox(
	root: string,
	{ mise = 'mise', services: options }: SandboxOptions = {}
) {
	const services = createServices(root, options);
	const serviceRoutes: Record<string, (body: never) => Promise<object>> = {
		list: async () => ({ services: await services.list() }),
		start: async (body) => ({ service: await services.start(body) }),
		stop: async (body: { name: string }) => (await services.stop(body.name), {}),
		restart: async (body: { name: string }) => ({ service: await services.restart(body.name) }),
		logs: async (body: { name: string; lines?: number }) => ({
			logs: await services.logs(body.name, body.lines)
		})
	};
	const workspace: Record<string, (body: never) => Promise<object>> = {
		clone: async (body) => (await clone(root, body), {}),
		commit: async (body) => ({ sha: await commit(root, body) }),
		push: async (body) => ({ sha: await push(root, body) }),
		diff: async (body) => ({ diff: await diff(root, body) }),
		'head-branch': async (body) => ({ branch: await headBranch(root, body) }),
		squash: async (body) => ({ sha: await squash(root, body) }),
		rebase: (body) => rebase(root, body),
		'continue-rebase': (body) => continueRebase(root, body),
		'abort-rebase': async () => (await abortRebase(root), {}),
		toolchain: async () => ({ tools: await toolchain(root, mise) })
	};

	async function handle(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (request.method === 'GET' && pathname === '/health') return new Response('ok');
		const preview = /^\/preview\/(\d+)(\/.*)?$/.exec(pathname);
		if (preview) {
			const url = new URL(request.url);
			const target = `http://127.0.0.1:${preview[1]}${preview[2] ?? '/'}${url.search}`;
			return globalThis
				.fetch(target, {
					method: request.method,
					headers: request.headers,
					body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
				})
				.catch(() => error(`Nothing is listening on port ${preview[1]}`, 502));
		}
		if (request.method !== 'POST') return error('Not found', 404);

		const [, group, name = ''] = pathname.split('/');
		try {
			if (group === 'tools' && isTool(name)) {
				const args = await request.json().catch(() => {
					throw new ToolError('The arguments were not valid JSON');
				});
				return Response.json({ output: await tools[name](root, args as never) });
			}
			if (group === 'services' && Object.hasOwn(serviceRoutes, name)) {
				return Response.json(await serviceRoutes[name]!((await request.json()) as never));
			}
			if (group === 'workspace' && Object.hasOwn(workspace, name)) {
				return Response.json(await workspace[name]!((await request.json()) as never));
			}
			return error('Not found', 404);
		} catch (cause) {
			if (cause instanceof ToolError) return error(cause.message, 422);
			return error(cause instanceof Error ? cause.message : String(cause), 500);
		}
	}

	return Object.assign(handle, { services });
}

function error(message: string, status: number) {
	return Response.json({ error: message }, { status });
}

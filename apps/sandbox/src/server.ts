import { createServices, type ServicesOptions } from './services.ts';
import { discoverSkills } from './skills.ts';
import { isTool, ToolError, tools } from './tools.ts';
import {
	clone,
	commit,
	compare,
	diff,
	headBranch,
	hook,
	prepareCandidate,
	promoteCandidate,
	publishProvenance,
	push,
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
		'prepare-candidate': (body) => prepareCandidate(root, body),
		'promote-candidate': (body) => promoteCandidate(root, body),
		'publish-provenance': async (body) => (await publishProvenance(root, body), {}),
		clone: (body) => services.pausedDuring(() => clone(root, body)),
		compare: (body) => compare(root, body),
		commit: async (body) => ({ sha: await commit(root, body) }),
		push: async (body) => ({ sha: await push(root, body) }),
		diff: async (body) => ({ diff: await diff(root, body) }),
		'head-branch': async (body) => ({ branch: await headBranch(root, body) }),
		toolchain: async () => ({ tools: await toolchain(root, mise) }),
		hook: (body) => hook(root, body),
		skills: async () => ({ skills: await discoverSkills(root) })
	};

	async function handle(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (request.method === 'GET' && pathname === '/health') return new Response('ok');
		const preview = /^\/preview\/(\d+)(\/.*)?$/.exec(pathname);
		if (preview) {
			const url = new URL(request.url);
			const target = `http://127.0.0.1:${preview[1]}${preview[2] ?? '/'}${url.search}`;
			const headers = new Headers(request.headers);
			headers.set('accept-encoding', 'identity');
			const response = await globalThis
				.fetch(target, {
					method: request.method,
					headers,
					body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer()
				})
				.catch(() => null);
			if (!response) return error(`Nothing is listening on port ${preview[1]}`, 502);
			const plain = new Headers(response.headers);
			plain.delete('content-encoding');
			plain.delete('content-length');
			return new Response(response.body, { status: response.status, headers: plain });
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

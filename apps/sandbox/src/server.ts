import { isTool, ToolError, tools } from './tools.ts';
import {
	abortRebase,
	clone,
	commit,
	continueRebase,
	diff,
	push,
	rebase,
	squash,
	toolchain
} from './workspace.ts';

export interface SandboxOptions {
	mise?: string;
}

export function createSandbox(root: string, { mise = 'mise' }: SandboxOptions = {}) {
	const workspace: Record<string, (body: never) => Promise<object>> = {
		clone: async (body) => (await clone(root, body), {}),
		commit: async (body) => ({ sha: await commit(root, body) }),
		push: async (body) => ({ sha: await push(root, body) }),
		diff: async (body) => ({ diff: await diff(root, body) }),
		squash: async (body) => ({ sha: await squash(root, body) }),
		rebase: (body) => rebase(root, body),
		'continue-rebase': (body) => continueRebase(root, body),
		'abort-rebase': async () => (await abortRebase(root), {}),
		toolchain: async () => ({ tools: await toolchain(root, mise) })
	};

	return async function fetch(request: Request): Promise<Response> {
		const { pathname } = new URL(request.url);
		if (request.method === 'GET' && pathname === '/health') return new Response('ok');
		if (request.method !== 'POST') return error('Not found', 404);

		const [, group, name = ''] = pathname.split('/');
		try {
			if (group === 'tools' && isTool(name)) {
				const args = await request.json().catch(() => {
					throw new ToolError('The arguments were not valid JSON');
				});
				return Response.json({ output: await tools[name](root, args as never) });
			}
			if (group === 'workspace' && Object.hasOwn(workspace, name)) {
				return Response.json(await workspace[name]!((await request.json()) as never));
			}
			return error('Not found', 404);
		} catch (cause) {
			if (cause instanceof ToolError) return error(cause.message, 422);
			return error(cause instanceof Error ? cause.message : String(cause), 500);
		}
	};
}

function error(message: string, status: number) {
	return Response.json({ error: message }, { status });
}

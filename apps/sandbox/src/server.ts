import { isTool, ToolError, tools } from './tools.ts';
import { clone, commit, push } from './workspace.ts';

const workspace = { clone, commit, push } as const;

export function createSandbox(root: string) {
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
				const action = workspace[name as keyof typeof workspace];
				const result = await action(root, (await request.json()) as never);
				return Response.json(name === 'commit' ? { sha: result } : {});
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

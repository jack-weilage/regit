import type { ToolExecutor } from '../types.ts';
import type {
	CloneRequest,
	CommitRequest,
	CommitResponse,
	ErrorResponse,
	Fetch,
	PushRequest,
	ToolResponse
} from './protocol.ts';
import { toolSpecs } from './specs.ts';

const origin = 'http://sandbox';

async function post<T>(fetch: Fetch, path: string, body: string, signal?: AbortSignal) {
	const response = await fetch(`${origin}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
		signal
	});
	const result = (await response.json()) as T | ErrorResponse;
	if (!response.ok) throw new Error((result as ErrorResponse).error);
	return result as T;
}

export function sandboxTools(fetch: Fetch): ToolExecutor {
	return {
		specs: toolSpecs,
		async execute(call, signal) {
			const { output } = await post<ToolResponse>(
				fetch,
				`/tools/${call.name}`,
				call.arguments,
				signal
			);
			return output;
		}
	};
}

export function sandboxWorkspace(fetch: Fetch) {
	return {
		async clone(request: CloneRequest) {
			await post(fetch, '/workspace/clone', JSON.stringify(request));
		},
		async commit(request: CommitRequest) {
			const { sha } = await post<CommitResponse>(
				fetch,
				'/workspace/commit',
				JSON.stringify(request)
			);
			return sha;
		},
		async push(request: PushRequest) {
			await post(fetch, '/workspace/push', JSON.stringify(request));
		}
	};
}

export type SandboxWorkspace = ReturnType<typeof sandboxWorkspace>;

import type { ToolExecutor } from '../types.ts';
import type {
	CloneRequest,
	CommitRequest,
	CommitResponse,
	ContinueRebaseRequest,
	ContinueRebaseResponse,
	DiffRequest,
	DiffResponse,
	ErrorResponse,
	Fetch,
	HeadBranchRequest,
	HeadBranchResponse,
	PushRequest,
	PushResponse,
	RebaseRequest,
	RebaseResponse,
	ServiceInfo,
	ServicesResponse,
	SquashRequest,
	ToolchainResponse,
	ToolName,
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

export const readOnlyTools: ToolName[] = ['read_file', 'find_files', 'search', 'run'];

export function sandboxTools(fetch: Fetch, only?: ToolName[]): ToolExecutor {
	return {
		specs: only ? toolSpecs.filter((spec) => only.includes(spec.name)) : toolSpecs,
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
			const { sha } = await post<PushResponse>(fetch, '/workspace/push', JSON.stringify(request));
			return sha;
		},
		async headBranch(request: HeadBranchRequest) {
			const { branch } = await post<HeadBranchResponse>(
				fetch,
				'/workspace/head-branch',
				JSON.stringify(request)
			);
			return branch;
		},
		async services() {
			const { services } = await post<ServicesResponse>(fetch, '/services/list', '{}');
			return services;
		},
		async startService(request: { name: string } | Omit<ServiceInfo, 'saved' | 'status'>) {
			const { service } = await post<{ service: ServiceInfo }>(
				fetch,
				'/services/start',
				JSON.stringify(request)
			);
			return service;
		},
		async stopService(name: string) {
			await post(fetch, '/services/stop', JSON.stringify({ name }));
		},
		async restartService(name: string) {
			const { service } = await post<{ service: ServiceInfo }>(
				fetch,
				'/services/restart',
				JSON.stringify({ name })
			);
			return service;
		},
		async serviceLogs(name: string, lines?: number) {
			const { logs } = await post<{ logs: string }>(
				fetch,
				'/services/logs',
				JSON.stringify({ name, lines })
			);
			return logs;
		},
		async diff(request: DiffRequest) {
			const { diff } = await post<DiffResponse>(fetch, '/workspace/diff', JSON.stringify(request));
			return diff;
		},
		async squash(request: SquashRequest) {
			const { sha } = await post<CommitResponse>(
				fetch,
				'/workspace/squash',
				JSON.stringify(request)
			);
			return sha;
		},
		rebase(request: RebaseRequest) {
			return post<RebaseResponse>(fetch, '/workspace/rebase', JSON.stringify(request));
		},
		continueRebase(request: ContinueRebaseRequest) {
			return post<ContinueRebaseResponse>(
				fetch,
				'/workspace/continue-rebase',
				JSON.stringify(request)
			);
		},
		async abortRebase() {
			await post(fetch, '/workspace/abort-rebase', '{}');
		},
		async toolchain() {
			const { tools } = await post<ToolchainResponse>(fetch, '/workspace/toolchain', '{}');
			return tools;
		}
	};
}

export type SandboxWorkspace = ReturnType<typeof sandboxWorkspace>;

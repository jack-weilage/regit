import type { ToolExecutor } from '../types.ts';
import type {
	BuildShipRequest,
	BuildShipResponse,
	PushShipRequest,
	PushShipResponse,
	CloneRequest,
	CloneResponse,
	BuildRevertRequest,
	CommitsRequest,
	CommitsResponse,
	DeployRequest,
	DeployResponse,
	ChecksRequest,
	ChecksResponse,
	ClashesRequest,
	ClashesResponse,
	RunCheckRequest,
	RunCheckResponse,
	CompareRequest,
	CompareResponse,
	CommitRequest,
	CommitResponse,
	DiffRequest,
	DiffResponse,
	ErrorResponse,
	Fetch,
	HeadBranchRequest,
	HeadBranchResponse,
	HookLine,
	HookRequest,
	HookResponse,
	PublishProvenanceRequest,
	PushRequest,
	PushResponse,
	ServiceInfo,
	ServicesResponse,
	SkillsResponse,
	ToolchainResponse,
	ToolArguments,
	ToolName,
	ToolResponse
} from './protocol.ts';
import { toolSpecs } from './specs.ts';
import { errorMessage, SandboxUnavailableError } from '../transient.ts';

const origin = 'http://sandbox';

function send(fetch: Fetch, path: string, body: string, signal?: AbortSignal) {
	return fetch(`${origin}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
		signal
	}).catch((error: unknown) => {
		if (signal?.aborted) throw error;
		throw new SandboxUnavailableError(`The sandbox is unreachable: ${errorMessage(error)}`, {
			cause: error
		});
	});
}

async function post<T>(fetch: Fetch, path: string, body: string, signal?: AbortSignal) {
	return answer<T>(await send(fetch, path, body, signal));
}

async function answer<T>(response: Response) {
	const text = await response.text();
	let result: T | ErrorResponse;
	try {
		result = JSON.parse(text) as T | ErrorResponse;
	} catch {
		const reason = `The sandbox answered ${response.status}: ${text.slice(0, 200)}`;
		throw response.status >= 500 ? new SandboxUnavailableError(reason) : new Error(reason);
	}
	if (!response.ok) throw new Error((result as ErrorResponse).error);
	return result as T;
}

export const readOnlyTools: ToolName[] = ['read_file', 'view_image', 'find_files', 'search', 'run'];

export function sandboxTools(
	fetch: Fetch,
	only?: ToolName[],
	run?: (args: ToolArguments['run'], signal?: AbortSignal) => Promise<string>
): ToolExecutor {
	return {
		specs: only ? toolSpecs.filter((spec) => only.includes(spec.name)) : toolSpecs,
		async execute(call, signal) {
			if (call.name === 'run' && run) return run(JSON.parse(call.arguments), signal);
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
		buildShip(request: BuildShipRequest) {
			return post<BuildShipResponse>(fetch, '/workspace/build-ship', JSON.stringify(request));
		},
		buildRevert(request: BuildRevertRequest) {
			return post<BuildShipResponse>(fetch, '/workspace/build-revert', JSON.stringify(request));
		},
		pushShip(request: PushShipRequest) {
			return post<PushShipResponse>(fetch, '/workspace/push-ship', JSON.stringify(request));
		},
		compare(request: CompareRequest) {
			return post<CompareResponse>(fetch, '/workspace/compare', JSON.stringify(request));
		},
		checks(request: ChecksRequest) {
			return post<ChecksResponse>(fetch, '/workspace/checks', JSON.stringify(request));
		},
		runCheck(request: RunCheckRequest) {
			return post<RunCheckResponse>(fetch, '/workspace/run-check', JSON.stringify(request));
		},
		async cancelChecks() {
			await post(fetch, '/workspace/cancel-checks', '{}');
		},
		deploy(request: DeployRequest) {
			return post<DeployResponse>(fetch, '/workspace/deploy', JSON.stringify(request));
		},
		commits(request: CommitsRequest) {
			return post<CommitsResponse>(fetch, '/workspace/commits', JSON.stringify(request));
		},
		clashes(request: ClashesRequest) {
			return post<ClashesResponse>(fetch, '/workspace/clashes', JSON.stringify(request));
		},
		async publishProvenance(request: PublishProvenanceRequest) {
			await post(fetch, '/workspace/publish-provenance', JSON.stringify(request));
		},
		async clone(request: CloneRequest) {
			return post<CloneResponse>(fetch, '/workspace/clone', JSON.stringify(request));
		},
		// Runs a lifecycle hook, passing its output to onOutput as it's printed.
		async hook(name: HookRequest['name'], onOutput?: (chunk: string) => void) {
			const response = await send(fetch, '/workspace/hook', JSON.stringify({ name }));
			// TODO: remove once no running sandbox predates streamed hook output.
			if (!response.headers.get('Content-Type')?.includes('ndjson') || !response.body)
				return answer<HookResponse>(response);
			let buffered = '';
			for await (const text of response.body.pipeThrough(new TextDecoderStream())) {
				const lines = (buffered + text).split('\n');
				buffered = lines.pop()!;
				for (const line of lines.filter(Boolean)) {
					const parsed = JSON.parse(line) as HookLine;
					if ('output' in parsed) onOutput?.(parsed.output);
					else if ('result' in parsed) return parsed.result;
					else throw new Error(parsed.error);
				}
			}
			throw new SandboxUnavailableError(`The sandbox stopped before .agents/${name} finished`);
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
		async skills() {
			const { skills } = await post<SkillsResponse>(fetch, '/workspace/skills', '{}');
			return skills;
		},
		async toolchain() {
			const { tools } = await post<ToolchainResponse>(fetch, '/workspace/toolchain', '{}');
			return tools;
		},
		async trust() {
			const { trusted } = await post<{ trusted: boolean }>(fetch, '/workspace/trust', '{}');
			return trusted;
		}
	};
}

export type SandboxWorkspace = ReturnType<typeof sandboxWorkspace>;

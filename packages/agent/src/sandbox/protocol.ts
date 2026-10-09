export interface ToolArguments {
	read_file: { path: string; offset?: number; limit?: number };
	write_file: { path: string; content: string };
	edit_file: { path: string; old_string: string; new_string: string; replace_all?: boolean };
	find_files: { pattern: string };
	search: { pattern: string; path?: string; glob?: string };
	run: { command: string; timeout_seconds?: number };
}

export type ToolName = keyof ToolArguments;

export interface ToolResponse {
	output: string;
}

export interface ErrorResponse {
	error: string;
}

export interface CloneRequest {
	remote: string;
	branch?: string;
	token?: string;
}

export interface CommitRequest {
	message: string;
	author: { name: string; email: string };
}

export interface CommitResponse {
	sha: string | null;
}

export type Toolchain = Record<string, string[]>;

export interface SkillInfo {
	name: string;
	description: string;
	body: string;
	directory: string;
	resources: string[];
}

export interface SkillsResponse {
	skills: SkillInfo[];
}

export interface ToolchainResponse {
	tools: Toolchain;
}

export interface PushRequest {
	ref: string;
	token?: string;
	remote?: string;
	force?: boolean;
}

export interface PushResponse {
	sha: string;
}

export interface Identity {
	name: string;
	email: string;
}

export interface PrepareCandidateRequest {
	sourceSha: string;
	base: string;
	requiredCommits?: string[];
	remote: string;
	branch: string;
	message: string;
	author: Identity;
	committer: Identity;
}

export interface PrepareCandidateResponse {
	sha: string;
	expectedHead: string;
}

export interface PromoteCandidateRequest {
	sha: string;
	expectedHead: string;
	remote: string;
	branch: string;
}

export interface PromoteCandidateResponse {
	sha: string;
}

export interface PublishProvenanceRequest {
	sha: string;
	ref?: string;
	note: string;
	remote?: string;
}

export interface ServiceSpec {
	name: string;
	command: string;
	port: number;
	cwd?: string;
	env?: Record<string, string>;
}

export interface ServiceInfo extends ServiceSpec {
	saved: boolean;
	status: 'stopped' | 'starting' | 'running' | 'exited';
	exitCode?: number | null;
	startedAt?: number;
}

export interface ServicesResponse {
	services: ServiceInfo[];
}

export interface ServiceRequest {
	name: string;
}

export interface ServiceLogsRequest extends ServiceRequest {
	lines?: number;
}

export interface HeadBranchRequest {
	remote: string;
	token?: string;
}

export interface HeadBranchResponse {
	branch: string | null;
}

export interface DiffRequest {
	base: string;
}

export interface DiffResponse {
	diff: string;
}

export interface SquashRequest {
	base: string;
	message: string;
	author: Identity;
	committer: Identity;
}

export interface RebaseRequest {
	remote: string;
	branch: string;
	token?: string;
	committer: Identity;
}

export interface ContinueRebaseRequest {
	committer: Identity;
}

export interface ContinueRebaseResponse {
	sha: string | null;
	conflicts: string[];
}

export interface RebaseResponse extends ContinueRebaseResponse {
	onto: string;
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

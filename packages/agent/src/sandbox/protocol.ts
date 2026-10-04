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

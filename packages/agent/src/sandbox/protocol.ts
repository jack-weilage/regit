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
}

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

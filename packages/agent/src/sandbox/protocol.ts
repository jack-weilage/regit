import type { CheckAction } from '@regit/core';
import type { ToolOutput } from '../types.ts';

export type { CheckAction };

export interface ToolArguments {
	read_file: { path: string; offset?: number; limit?: number };
	view_image: { path: string };
	write_file: { path: string; content: string };
	edit_file: { path: string; old_string: string; new_string: string; replace_all?: boolean };
	find_files: { pattern: string };
	search: { pattern: string; path?: string; glob?: string };
	run: { command: string; timeout_seconds?: number };
}

export type ToolName = keyof ToolArguments;

export interface ToolResponse {
	output: ToolOutput;
}

export interface ErrorResponse {
	error: string;
}

export interface CloneRequest {
	remote: string;
	branch?: string;
}

export interface CloneResponse {
	preserved: boolean;
	setup: string | null;
}

export interface HookRequest {
	name: 'setup' | 'resume';
}

export interface HookResponse {
	ran: boolean;
	output: string;
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

export interface BuildShipRequest {
	id: string;
	sourceSha: string;
	base: string;
	remote: string;
	branch: string;
	message: string;
	author: Identity;
	committer: Identity;
}

export interface BuildShipResponse {
	sha: string;
	tree: string;
	head: string;
	shipped: boolean;
}

export interface BuildRevertRequest {
	sha: string;
	remote: string;
	branch: string;
	message: string;
	committer: Identity;
}

export interface PushShipRequest {
	sha: string;
	head: string;
	remote: string;
	branch: string;
}

export interface PushShipResponse {
	pushed: boolean;
}

export interface PublishProvenanceRequest {
	sha: string;
	ref?: string;
	note: string;
	remote?: string;
}

export interface CompareRequest {
	remote: string;
	forks: { id: string; remote: string; branch: string; published?: string }[];
}

export interface ClashesRequest {
	fork: CompareRequest['forks'][number];
	others: CompareRequest['forks'];
}

export interface ClashesResponse {
	clashes: { id: string; files: string[] }[];
}

export interface CompareResponse {
	main: string;
	branch: string;
	headline: string;
	threads: { id: string; behind: number; conflicts: string[] }[];
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
}

export interface HeadBranchResponse {
	branch: string | null;
}

export interface DiffRequest {
	base: string;
	head?: string;
}

export interface CheckSpec {
	name: string;
	run?: string;
	ask?: string;
	when?: string[];
	inputs?: string[];
	before: CheckAction[];
	blocking: boolean;
	timeoutSeconds?: number;
}

export interface PlannedCheck extends CheckSpec {
	applies: boolean;
	inputsHash: string;
}

export interface ChecksRequest {
	base: string;
	commit: string;
}

export interface ChecksResponse {
	checks: PlannedCheck[];
	error?: string;
	// Changed files that decide what deploys and how: the checks and the deploy script.
	governing: string[];
}

export interface RunCheckRequest {
	name: string;
	command: string;
	commit?: string;
	timeoutSeconds?: number;
}

export interface RunCheckResponse {
	ok: boolean;
	output: string;
	log: string;
}

export interface DeployRequest {
	commit: string;
	env: Record<string, string>;
	timeoutSeconds?: number;
}

export type DeployResponse =
	{ ran: false } | { ran: true; ok: boolean; output: string; log: string };

export interface CommitsRequest {
	from: string | null;
	to: string;
}

export interface CommitsResponse {
	commits: { sha: string; headline: string }[];
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

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

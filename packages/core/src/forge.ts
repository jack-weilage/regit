export type Mode = 'small' | 'medium' | 'large';

export type ThreadStatus = 'draft' | 'running' | 'needs-you' | 'discarded';

export interface Author {
	name: string;
	kind: 'person' | 'agent';
}

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export type Entry =
	| { type: 'message'; id: string; at: number; author: Author; text: string }
	| { type: 'intent'; id: string; at: number; intent: Intent }
	| { type: 'event'; id: string; at: number; text: string };

export interface ThreadSummary {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	updatedAt: number;
}

export interface ThreadDetail {
	summary: ThreadSummary;
	entries: Entry[];
}

export interface RepoInfo {
	name: string;
	remote: string;
	defaultBranch: string;
}

export type LiveMessage =
	{ type: 'entry'; thread: string; entry: Entry } | { type: 'thread'; summary: ThreadSummary };

export interface ForgeApi {
	createRepo(input: { name: string; source?: string; createdBy: string }): Promise<RepoInfo>;
	openThread(
		repo: string,
		input: { author: Author; text: string; mode: Mode }
	): Promise<ThreadSummary>;
	reply(repo: string, thread: string, input: { author: Author; text: string }): Promise<void>;
	startThread(repo: string, thread: string): Promise<void>;
	threads(repo: string): Promise<ThreadSummary[]>;
	thread(repo: string, id: string): Promise<ThreadDetail | null>;
}

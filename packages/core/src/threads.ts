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

export type LiveMessage =
	{ type: 'entry'; thread: string; entry: Entry } | { type: 'thread'; summary: ThreadSummary };

export interface RepoCoordinatorApi {
	openThread(input: { author: Author; text: string; mode: Mode }): Promise<ThreadSummary>;
	reply(thread: string, input: { author: Author; text: string }): Promise<void>;
	start(thread: string): Promise<void>;
	threads(): ThreadSummary[];
	thread(id: string): ThreadDetail | null;
}

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
	| {
			type: 'message';
			id: string;
			at: number;
			author: Author;
			text: string;
			steering?: { read: boolean };
	  }
	| { type: 'intent'; id: string; at: number; intent: Intent }
	| { type: 'event'; id: string; at: number; text: string };

export interface ThreadSummary {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	updatedAt: number;
	deleted: { at: number; by: string } | null;
}

export const threadPurgeDelayMs = 7 * 24 * 60 * 60 * 1000;

export interface UsageRow {
	task: 'intent' | 'conversation' | 'attempt';
	model: string;
	tokens: number;
	cost: number | null;
}

export interface ThreadUsage {
	rows: UsageRow[];
	context: { used: number; limit: number };
}

export interface ThreadDetail {
	summary: ThreadSummary;
	entries: Entry[];
	usage: ThreadUsage;
}

export type LiveMessage =
	{ type: 'entry'; thread: string; entry: Entry } | { type: 'thread'; summary: ThreadSummary };

export interface RepoCoordinatorApi {
	openThread(input: {
		repo: string;
		author: Author;
		text: string;
		mode: Mode;
	}): Promise<ThreadSummary>;
	reply(thread: string, input: { author: Author; text: string }): Promise<void>;
	start(thread: string): Promise<void>;
	discard(thread: string, by: Author): Promise<void>;
	reopen(thread: string, by: Author): void;
	delete(thread: string, by: Author): Promise<void>;
	restore(thread: string): void;
	threads(): ThreadSummary[];
	thread(id: string): ThreadDetail | null;
}

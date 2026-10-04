import type { DiffFile, DiffSummary } from './diff.ts';

export type Mode = 'small' | 'medium' | 'large';

export const machines = {
	'standard-1': { vcpu: 0.5, memoryGib: 4, diskGb: 8 },
	'standard-2': { vcpu: 1, memoryGib: 6, diskGb: 12 },
	'standard-3': { vcpu: 2, memoryGib: 8, diskGb: 16 },
	'standard-4': { vcpu: 4, memoryGib: 12, diskGb: 20 }
} as const;

export type Machine = keyof typeof machines;

export const defaultMachine: Machine = 'standard-1';

export type ThreadStatus =
	'draft' | 'running' | 'reviewing' | 'needs-you' | 'shipping' | 'shipped' | 'discarded';

export type ReviewVerdict = 'pass' | 'fail' | 'needs-human';

export type CheckVerdict = 'met' | 'unmet' | 'unverified';

export const maxReviewRounds = 3;

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
			type: 'review';
			id: string;
			at: number;
			round: number;
			verdict: ReviewVerdict;
			checks: CheckVerdict[];
	  }
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
	machine: Machine;
	updatedAt: number;
	deleted: { at: number; by: string } | null;
	changes: DiffSummary | null;
	base: string | null;
	shipped: { sha: string; by: string; at: number } | null;
}

export interface ShipInput {
	by: Author;
	email: string;
	title: string;
	body: string;
}

export const threadPurgeDelayMs = 7 * 24 * 60 * 60 * 1000;

export interface UsageRow {
	task: 'intent' | 'conversation' | 'attempt' | 'review';
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
		machine: Machine;
	}): Promise<ThreadSummary>;
	reply(thread: string, input: { author: Author; text: string }): Promise<void>;
	start(thread: string): Promise<void>;
	discard(thread: string, by: Author): Promise<void>;
	reopen(thread: string, by: Author): void;
	delete(thread: string, by: Author): Promise<void>;
	restore(thread: string): void;
	stop(thread: string, by: Author): Promise<void>;
	changes(thread: string): Promise<DiffFile[] | null>;
	ship(thread: string, input: ShipInput): Promise<void>;
	threads(): ThreadSummary[];
	thread(id: string): ThreadDetail | null;
}

import type { DiffFile, DiffSummary } from './diff.ts';

export type Mode = 'small' | 'medium' | 'large';

export type ModeChoice = Mode | 'auto';

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
	id?: string;
	name: string;
	kind: 'person' | 'agent';
}

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export interface SimilarMatch {
	thread: string;
	relation: 'same' | 'overlap' | 'related';
	probability: number;
}

export interface ToolCallRecord {
	id: string;
	tool: string;
	target: string;
	status: 'running' | 'done' | 'failed';
	startedAt: number;
	finishedAt?: number;
	output?: string;
}

export interface StartupStage {
	label: string;
	status: 'pending' | 'running' | 'done' | 'failed';
	startedAt?: number;
	finishedAt?: number;
	output?: string;
}

export interface ThreadActivity {
	startup: { cold: boolean; stages: StartupStage[] } | null;
	status: { label: string; since: number } | null;
	text: string;
	calls: ToolCallRecord[];
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
	| { type: 'intent'; id: string; at: number; intent: Intent; similar?: SimilarMatch[] }
	| {
			type: 'suggestion';
			id: string;
			at: number;
			intent: Intent;
			context: string;
			outcome:
				{ kind: 'dismissed'; by: string } | { kind: 'spun-off'; thread: string; by: string } | null;
	  }
	| { type: 'event'; id: string; at: number; text: string }
	| { type: 'tools'; id: string; at: number; calls: ToolCallRecord[] }
	| { type: 'startup'; id: string; at: number; stages: StartupStage[] }
	| {
			type: 'thread-message';
			id: string;
			at: number;
			direction: 'in' | 'out';
			thread: string;
			headline: string;
			text: string;
			steering?: { read: boolean };
	  };

export interface ThreadSummary {
	id: string;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	auto: boolean;
	machine: Machine;
	updatedAt: number;
	deleted: { at: number; by: string } | null;
	parent: { id: string; headline: string } | null;
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
	task: 'intent' | 'conversation' | 'attempt' | 'review' | 'search';
	model: string;
	tokens: number;
	cost: number | null;
}

export interface ThreadUsage {
	rows: UsageRow[];
	context: { used: number; limit: number };
}

export interface ThreadService {
	name: string;
	command: string;
	port: number;
	saved: boolean;
	status: 'stopped' | 'starting' | 'running' | 'exited';
	exitCode?: number | null;
	preview: string;
}

export interface ThreadDetail {
	summary: ThreadSummary;
	entries: Entry[];
	usage: ThreadUsage;
	services: ThreadService[];
	activity: ThreadActivity | null;
	control?: import('./acceptance.ts').ProposalControl;
}

export type LiveMessage =
	| { type: 'entry'; thread: string; entry: Entry }
	| { type: 'thread'; summary: ThreadSummary }
	| { type: 'activity'; thread: string; activity: ThreadActivity | null };

export interface RepoCoordinatorApi {
	openThread(input: {
		repo: string;
		author: Author;
		text: string;
		mode: ModeChoice;
		machine: Machine;
	}): Promise<ThreadSummary>;
	reply(thread: string, input: { author: Author; text: string }): Promise<void>;
	start(thread: string, by?: Author): Promise<void>;
	acceptIntent(thread: string, by: Author): Promise<void>;
	pinDependency(thread: string, dependency: string, by: Author): Promise<void>;
	unpinDependency(thread: string, dependency: string, by: Author): Promise<void>;
	approvePromotion(thread: string, promotion: string, by: Author): Promise<void>;
	discard(thread: string, by: Author): Promise<void>;
	reopen(thread: string, by: Author): void;
	delete(thread: string, by: Author): Promise<void>;
	restore(thread: string): void;
	stop(thread: string, by: Author): Promise<void>;
	changes(thread: string): Promise<DiffFile[] | null>;
	ship(thread: string, input: ShipInput): Promise<void>;
	spinOff(thread: string, entry: string, by: Author): Promise<ThreadSummary>;
	dismissSuggestion(thread: string, entry: string, by: Author): void;
	serviceAction(thread: string, action: 'start' | 'stop' | 'restart', name: string): Promise<void>;
	serviceLogs(thread: string, name: string): Promise<string>;
	assess(text: string): Promise<{ similar: SimilarMatch[]; size: Mode }>;
	forwardIntent(thread: string, to: string, by: Author): Promise<string>;
	threads(): ThreadSummary[];
	thread(id: string): ThreadDetail | null;
}

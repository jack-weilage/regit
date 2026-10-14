import type { Automation } from './automations.ts';
import type { DiffFile, DiffSummary } from './diff.ts';
import type { DeploySecret, MainStatus, Verdict } from './main.ts';
import type { Failure, Retry, RetryFailure } from './retries.ts';

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

export const defaultDeployMachine: Machine = 'standard-3';

export type ThreadStatus = 'running' | 'needs-you' | 'shipping' | 'shipped' | 'discarded';

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

export type DoneWhenStatus = 'met' | 'unmet' | 'unverified';

// What the agent found for one done-when check, on the thread's tree when it looked; stale once the tree changes.
export interface DoneWhenResult {
	status: DoneWhenStatus;
	evidence: string;
	at: number;
	tree: string | null;
	stale?: boolean;
}

export interface SimilarMatch {
	thread: string;
	relation: 'same' | 'overlap' | 'related';
	probability: number;
}

export interface ThreadOverlap {
	thread: string;
	headline: string;
	purpose?: string;
	files: string[];
}

export type CheckAction = 'handoff' | 'deploy';

export interface CheckResult {
	name: string;
	kind: 'run' | 'ask';
	status: 'passed' | 'failed' | 'warned';
	reused: boolean;
	output: string;
	log?: string;
}

export interface CheckRun {
	action: CheckAction;
	at: number;
	results: CheckResult[];
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

// What the thread's agent is doing right now: starting its sandbox, streaming a step, or between steps.
export type AgentPhase =
	| { type: 'idle' }
	| { type: 'starting'; stages: StartupStage[] }
	| { type: 'streaming'; text: string; calls: ToolCallRecord[] }
	| { type: 'thinking'; label: string; since: number };

export const idlePhase: AgentPhase = { type: 'idle' };

export interface ThreadActivity {
	agent: AgentPhase;
	retry: Retry | null;
	ship: import('./ships.ts').ShipProgress | null;
}

// What a thread's sandbox reports; the coordinator adds ship progress.
export type AgentActivity = Omit<ThreadActivity, 'ship'>;

export type EventTone = 'warning' | 'danger';

export type Entry =
	| {
			type: 'message';
			id: string;
			at: number;
			author: Author;
			text: string;
			steering?: { read: boolean };
	  }
	| {
			type: 'intent';
			id: string;
			at: number;
			intent: Intent;
			similar?: SimilarMatch[];
			results?: Record<string, DoneWhenResult>;
	  }
	| {
			type: 'suggestion';
			id: string;
			at: number;
			intent: Intent;
			context: string;
			outcome:
				| { kind: 'dismissed'; by: string }
				| { kind: 'spun-off'; thread: string; number?: number; by: string }
				| null;
	  }
	| { type: 'event'; id: string; at: number; text: string; tone?: EventTone }
	| { type: 'tools'; id: string; at: number; calls: ToolCallRecord[]; checkpoint?: string }
	| { type: 'startup'; id: string; at: number; stages: StartupStage[] }
	| { type: 'recovered'; id: string; at: number; failures: RetryFailure[] }
	| ({ type: 'failure'; id: string; at: number; resumable: boolean } & Failure)
	| {
			type: 'thread-message';
			id: string;
			at: number;
			direction: 'in' | 'out';
			thread: string;
			number?: number;
			headline: string;
			text: string;
			steering?: { read: boolean };
	  }
	// A message one of this thread's automations delivered to it.
	| {
			type: 'automation';
			id: string;
			at: number;
			automation: string;
			name: string;
			trigger: string;
			text: string;
			run: number;
			limit: number;
			steering?: { read: boolean };
	  };

export function countCheckpoints(entries: Entry[]) {
	return entries.filter((entry) =>
		entry.type === 'tools'
			? !!entry.checkpoint
			: // TODO: drop once no thread has the old per-step "Checkpoint" events.
				entry.type === 'event' && entry.text.startsWith('Checkpoint ')
	).length;
}

export interface ThreadSummary {
	id: string;
	number: number;
	headline: string;
	status: ThreadStatus;
	mode: Mode;
	auto: boolean;
	machine: Machine;
	updatedAt: number;
	deleted: { at: number; by: string } | null;
	parent: { id: string; number: number | null; headline: string } | null;
	changes: DiffSummary | null;
	shipped: { sha: string; by: string; at: number; verdict: Verdict } | null;
	failure: { at: number; title: string; error: string; resumable: boolean } | null;
	behind: {
		branch: string;
		commits: number;
		sha: string;
		headline: string;
		conflicts: string[];
	} | null;
	checks: CheckRun | null;
}

export interface ShipInput {
	by: Author;
	email: string;
	title: string;
	body: string;
}

export const threadPurgeDelayMs = 7 * 24 * 60 * 60 * 1000;

export interface UsageRow {
	task: 'agent' | 'search';
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
	branch: string;
	entries: Entry[];
	usage: ThreadUsage;
	services: ThreadService[];
	automations: Automation[];
	activity: ThreadActivity | null;
}

export type LiveMessage =
	| { type: 'main'; main: MainStatus }
	| { type: 'entry'; thread: string; entry: Entry }
	| { type: 'thread'; summary: ThreadSummary }
	| { type: 'activity'; thread: string; activity: ThreadActivity | null };

export interface RepoCoordinatorApi {
	image(id: string): { mime: string; data: Uint8Array<ArrayBuffer> } | null;
	openThread(input: {
		repo: string;
		author: Author;
		text: string;
		mode: ModeChoice;
		machine: Machine;
	}): Promise<ThreadSummary>;
	reply(thread: string, input: { author: Author; text: string }): Promise<void>;
	discard(thread: string, by: Author): Promise<void>;
	reopen(thread: string, by: Author): void;
	delete(thread: string, by: Author): Promise<void>;
	restore(thread: string): void;
	stop(thread: string, by: Author): Promise<void>;
	resume(thread: string, by: Author): Promise<void>;
	retryNow(thread: string): Promise<void>;
	bringUpToDate(thread: string, by: Author): Promise<void>;
	changes(thread: string): Promise<DiffFile[] | null>;
	ship(thread: string, input: ShipInput): Promise<void>;
	spinOff(thread: string, entry: string, by: Author): Promise<ThreadSummary>;
	dismissSuggestion(thread: string, entry: string, by: Author): void;
	serviceAction(thread: string, action: 'start' | 'stop' | 'restart', name: string): Promise<void>;
	serviceLogs(thread: string, name: string): Promise<string>;
	assess(text: string): Promise<{ similar: SimilarMatch[]; size: Mode }>;
	forwardIntent(thread: string, to: string, by: Author): Promise<string>;
	automations(thread: string): Automation[];
	cancelAutomation(thread: string, id: string, by: Author): Promise<Automation>;
	threads(): ThreadSummary[];
	resolveThread(ref: string): Pick<ThreadSummary, 'id' | 'number'> | null;
	thread(id: string): Promise<ThreadDetail | null>;
	main(): MainStatus;
	deploySecrets(by: Author): Promise<DeploySecret[]>;
	setDeploySecret(name: string, value: string, by: Author): Promise<void>;
	deleteDeploySecret(name: string, by: Author): Promise<void>;
}

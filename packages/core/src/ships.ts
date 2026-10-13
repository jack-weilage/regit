import type { Retry } from './retries.ts';
import type { Author, Intent } from './threads.ts';

export interface Revision {
	proposal: string;
	repository: string;
	branch: string;
	base: string;
	sha: string;
	at: number;
}

export type ShipStage = 'starting' | 'checking' | 'fetching' | 'building' | 'pushing' | 'recording';

// What checking a ship found: the tree its checks passed on (null when the repository has none), conflicts, or failures.
export type ShipVerification =
	{ tree: string | null } | { conflicts: string[]; branch: string } | { failed: string[] };

export interface ShipProgress {
	stage: ShipStage;
	note: string | null;
	branch: string | null;
	since: number;
	started: number;
	retry?: Retry | null;
}

export interface Ship {
	id: string;
	repo: string;
	thread: string;
	source: Revision;
	intent: Intent | null;
	by: Author;
	email: string;
	title: string;
	body: string;
	handBacks: number;
}

import type { Author, Intent, Mode, Machine } from './threads.ts';

export interface AcceptedIntent {
	id: string;
	proposal: string;
	intent: Intent;
	acceptedBy: Author;
	at: number;
}

export interface RunRecord {
	id: string;
	proposal: string;
	intent: string;
	mode: Mode;
	machine: Machine;
	status: string;
	createdAt: number;
}

export interface Revision {
	id: string;
	proposal: string;
	run: string;
	intent: string;
	repository: string;
	branch: string;
	base: string;
	sha: string;
	at: number;
}

export interface Candidate {
	repository: string;
	branch: string;
	sha: string;
	expectedHead: string;
}

export interface Promotion {
	id: string;
	proposal: string;
	revision: string;
	intent: string;
	requestedBy: Author;
	approvedBy: Author | null;
	email: string;
	title: string;
	body: string;
	status: 'queued' | 'preparing' | 'ready' | 'publishing' | 'shipped' | 'failed' | 'cancelled';
	candidate: Candidate | null;
	error: string | null;
	notesPublished: boolean;
	at: number;
}

export interface ProposalControl {
	acceptedIntent: AcceptedIntent | null;
	runs: RunRecord[];
	revisions: Revision[];
	promotions: Promotion[];
}

export function promotionProblem(
	promotion: Promotion,
	accepted: AcceptedIntent | null,
	revision: Revision | undefined
): string | null {
	if (!accepted || promotion.intent !== accepted.id) return 'The accepted intent changed';
	if (!revision || revision.intent !== accepted.id)
		return 'The revision does not implement the accepted intent';
	if (!promotion.candidate) return 'No integration candidate exists';
	return null;
}

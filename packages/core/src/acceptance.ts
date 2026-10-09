import type { Author, Intent, Mode, Machine, ReviewVerdict, CheckVerdict } from './threads.ts';

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

export interface Assessment {
	id: string;
	revision: string;
	intent: string;
	producer: string;
	verdict: ReviewVerdict;
	checks: { state: CheckVerdict; evidence: string }[];
	findings: string[];
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
	email: string;
	title: string;
	body: string;
	status:
		| 'queued'
		| 'preparing'
		| 'reviewing'
		| 'ready'
		| 'publishing'
		| 'shipped'
		| 'failed'
		| 'cancelled';
	candidate: Candidate | null;
	assessment: Assessment | null;
	error: string | null;
	notesPublished: boolean;
	at: number;
}

export interface ProposalControl {
	acceptedIntent: AcceptedIntent | null;
	runs: RunRecord[];
	revisions: Revision[];
	assessments: Assessment[];
	promotions: Promotion[];
}

// Assessment is model judgment, not a trusted executable check or authorization.
export function promotionProblem(
	promotion: Promotion,
	accepted: AcceptedIntent | null,
	revision: Revision | undefined
): string | null {
	if (!accepted || promotion.intent !== accepted.id) return 'The accepted intent changed';
	if (!revision || revision.intent !== accepted.id)
		return 'The revision does not implement the accepted intent';
	if (!promotion.candidate) return 'No integration candidate exists';
	if (!promotion.assessment || promotion.assessment.revision !== promotion.candidate.sha)
		return 'The exact integration candidate has not been assessed';
	if (promotion.assessment.intent !== accepted.id)
		return 'The assessment covers a different intent';
	return null;
}

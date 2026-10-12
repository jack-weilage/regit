import type { Author, Intent } from './threads.ts';

export interface Revision {
	proposal: string;
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
	source: Revision;
	intent: Intent | null;
	requestedBy: Author;
	approvedBy: Author | null;
	email: string;
	title: string;
	body: string;
	status: 'queued' | 'preparing' | 'ready' | 'publishing' | 'shipped' | 'failed' | 'cancelled';
	candidate: Candidate | null;
	error: string | null;
	notesPublished: boolean;
	handBacks: number;
	at: number;
}

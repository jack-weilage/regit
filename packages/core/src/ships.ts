import type { Author, Intent } from './threads.ts';

export interface Revision {
	proposal: string;
	repository: string;
	branch: string;
	base: string;
	sha: string;
	at: number;
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

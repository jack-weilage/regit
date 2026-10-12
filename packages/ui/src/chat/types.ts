export type { DiffFile, DiffHunk, DiffLine } from '@regit/core';

export type AuthorKind = 'person' | 'agent';

export interface Author {
	name: string;
	kind: AuthorKind;
	avatar?: string;
}

export interface Mentionable {
	kind: 'person' | 'thread';
	handle: string;
	label: string;
	detail?: string;
	avatar?: string;
	href?: string;
	deleted?: boolean;
}

export type ThreadStatus = 'running' | 'needs-you' | 'shipping' | 'shipped' | 'discarded';

export interface SimilarThread extends Mentionable {
	kind: 'thread';
	relation: 'same' | 'overlap' | 'related';
	status: ThreadStatus;
}

export interface ThreadAction {
	label: string;
	detail?: string;
	separated?: boolean;
	danger?: boolean;
	onselect: () => void;
}

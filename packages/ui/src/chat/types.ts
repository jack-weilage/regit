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

export type ThreadStatus =
	'draft' | 'running' | 'reviewing' | 'needs-you' | 'landing' | 'shipped' | 'discarded';

export interface ThreadAction {
	label: string;
	detail?: string;
	separated?: boolean;
	danger?: boolean;
	onselect: () => void;
}

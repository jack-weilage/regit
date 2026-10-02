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
}

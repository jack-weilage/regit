export const gitTokenPrefix = 'regit_';

export function newGitToken() {
	return `${gitTokenPrefix}${hex(crypto.getRandomValues(new Uint8Array(24)))}`;
}

export async function hashGitToken(secret: string) {
	return hex(
		new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret)))
	);
}

function hex(bytes: Uint8Array) {
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

import { Buffer } from 'node:buffer';

export interface Sealed {
	name: string;
	iv: string;
	value: string;
}

// Deploy secrets are sealed with forge's DEPLOY_SECRETS_KEY and bound to their repository and name. The key is an
// optional secret, so wrangler doesn't type it and local dev starts without one.
async function key(env: object) {
	const secret = (env as { DEPLOY_SECRETS_KEY?: string }).DEPLOY_SECRETS_KEY;
	if (!secret) throw new Error('Deploy secrets need DEPLOY_SECRETS_KEY set on forge');
	const raw = Buffer.from(secret, 'base64');
	if (raw.length !== 32) throw new Error('DEPLOY_SECRETS_KEY must be 32 bytes, base64-encoded');
	return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const context = (repo: string, name: string) => new TextEncoder().encode(`${repo}/${name}`);

export async function seal(env: object, repo: string, name: string, value: string) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const sealed = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: context(repo, name) },
		await key(env),
		new TextEncoder().encode(value)
	);
	return {
		name,
		iv: Buffer.from(iv).toString('base64'),
		value: Buffer.from(sealed).toString('base64')
	};
}

export async function open(env: object, repo: string, sealed: Sealed[]) {
	const opener = await key(env);
	const opened: Record<string, string> = {};
	for (const { name, iv, value } of sealed) {
		const plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: Buffer.from(iv, 'base64'), additionalData: context(repo, name) },
			opener,
			Buffer.from(value, 'base64')
		);
		opened[name] = new TextDecoder().decode(plain);
	}
	return opened;
}

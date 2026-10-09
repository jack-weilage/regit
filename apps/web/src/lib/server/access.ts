import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { canAccessRepository, principalId, type RepoRole } from '@regit/db';
import { error } from '@sveltejs/kit';

export interface AccessConfig {
	teamDomain: string;
	audience: string;
	keys?: JWTVerifyGetKey;
}

const remoteKeys = new Map<string, JWTVerifyGetKey>();

export async function accessUser(token: string | null, config: AccessConfig) {
	if (!token || !config.teamDomain || !config.audience) return null;
	const issuer = `https://${config.teamDomain}`;
	let keys = config.keys ?? remoteKeys.get(issuer);
	if (!keys) {
		keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
		remoteKeys.set(issuer, keys);
	}
	try {
		const { payload } = await jwtVerify(token, keys, { issuer, audience: config.audience });
		if (typeof payload.sub !== 'string' || !payload.sub) return null;
		const id = principalId(issuer, payload.sub);
		if (typeof payload.email === 'string' && payload.email) {
			return {
				id,
				name:
					typeof payload.name === 'string' && payload.name
						? payload.name
						: payload.email.split('@')[0]!,
				email: payload.email
			};
		}
		if (typeof payload.common_name === 'string' && payload.common_name) {
			return { id, name: 'Service token', email: payload.common_name };
		}
		return null;
	} catch {
		return null;
	}
}

export async function requireRepoAccess(
	repo: string,
	id: string | null | undefined,
	role: RepoRole = 'viewer'
) {
	const { db } = await import('./db.ts');
	if (!(await canAccessRepository(db(), repo, id, role))) error(403, 'Repository access denied');
}

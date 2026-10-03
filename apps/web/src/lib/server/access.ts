import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

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
		if (typeof payload.email === 'string' && payload.email) {
			return { name: payload.email.split('@')[0]!, email: payload.email };
		}
		if (typeof payload.common_name === 'string' && payload.common_name) {
			return { name: 'Service token', email: payload.common_name };
		}
		return null;
	} catch {
		return null;
	}
}

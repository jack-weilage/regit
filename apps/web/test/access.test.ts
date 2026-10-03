import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, test } from 'vitest';
import { accessEmail } from '../src/lib/server/access.ts';

const teamDomain = 'regit.cloudflareaccess.com';
const audience = 'regit-web';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
const config = { teamDomain, audience, keys };

function token(claims: { email?: string; iss?: string; aud?: string; exp?: string }) {
	const { iss = `https://${teamDomain}`, aud = audience, exp = '1h', ...payload } = claims;
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(iss)
		.setAudience(aud)
		.setIssuedAt()
		.setExpirationTime(exp)
		.sign(privateKey);
}

test('accepts a valid Access token', async () => {
	expect(await accessEmail(await token({ email: 'sam@regit.dev' }), config)).toBe('sam@regit.dev');
});

test('rejects missing, forged and mismatched tokens', async () => {
	const forger = await generateKeyPair('RS256');
	const forged = await new SignJWT({ email: 'sam@regit.dev' })
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(`https://${teamDomain}`)
		.setAudience(audience)
		.setExpirationTime('1h')
		.sign(forger.privateKey);

	expect(await accessEmail(null, config)).toBeNull();
	expect(await accessEmail(forged, config)).toBeNull();
	expect(
		await accessEmail(await token({ email: 'sam@regit.dev', aud: 'other' }), config)
	).toBeNull();
	expect(
		await accessEmail(await token({ email: 'sam@regit.dev', iss: 'https://evil.test' }), config)
	).toBeNull();
	expect(await accessEmail(await token({ email: 'sam@regit.dev', exp: '-1m' }), config)).toBeNull();
	expect(await accessEmail(await token({}), config)).toBeNull();
});

test('refuses everyone until Access is configured', async () => {
	const valid = await token({ email: 'sam@regit.dev' });
	expect(await accessEmail(valid, { ...config, audience: '' })).toBeNull();
	expect(await accessEmail(valid, { ...config, teamDomain: '' })).toBeNull();
});

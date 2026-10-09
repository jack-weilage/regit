import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, test } from 'vitest';
import { accessUser } from '../src/lib/server/access.ts';
import { principalId } from '@regit/db';

const teamDomain = 'regit.cloudflareaccess.com';
const audience = 'regit-web';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256' }] });
const config = { teamDomain, audience, keys };

function token(claims: {
	email?: string;
	common_name?: string;
	iss?: string;
	aud?: string;
	exp?: string;
	sub?: string;
}) {
	const {
		iss = `https://${teamDomain}`,
		aud = audience,
		exp = '1h',
		sub = 'sam-subject',
		...payload
	} = claims;
	return new SignJWT(payload)
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(iss)
		.setSubject(sub)
		.setAudience(aud)
		.setIssuedAt()
		.setExpirationTime(exp)
		.sign(privateKey);
}

test('accepts a valid Access token', async () => {
	expect(await accessUser(await token({ email: 'sam@regit.dev' }), config)).toEqual({
		id: principalId(`https://${teamDomain}`, 'sam-subject'),
		name: 'sam',
		email: 'sam@regit.dev'
	});
});

test('accepts a service token by its client ID', async () => {
	expect(await accessUser(await token({ common_name: 'abc123.access' }), config)).toEqual({
		id: principalId(`https://${teamDomain}`, 'sam-subject'),
		name: 'Service token',
		email: 'abc123.access'
	});
});

test('rejects missing, forged and mismatched tokens', async () => {
	const forger = await generateKeyPair('RS256');
	const forged = await new SignJWT({ email: 'sam@regit.dev' })
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(`https://${teamDomain}`)
		.setAudience(audience)
		.setExpirationTime('1h')
		.sign(forger.privateKey);

	expect(await accessUser(null, config)).toBeNull();
	expect(await accessUser(forged, config)).toBeNull();
	expect(
		await accessUser(await token({ email: 'sam@regit.dev', aud: 'other' }), config)
	).toBeNull();
	expect(
		await accessUser(await token({ email: 'sam@regit.dev', iss: 'https://evil.test' }), config)
	).toBeNull();
	expect(await accessUser(await token({ email: 'sam@regit.dev', exp: '-1m' }), config)).toBeNull();
	expect(await accessUser(await token({}), config)).toBeNull();
});

test('refuses everyone until Access is configured', async () => {
	const valid = await token({ email: 'sam@regit.dev' });
	expect(await accessUser(valid, { ...config, audience: '' })).toBeNull();
	expect(await accessUser(valid, { ...config, teamDomain: '' })).toBeNull();
});

test('identity follows issuer and subject, not email, and requires a subject', async () => {
	const first = await accessUser(await token({ email: 'sam@regit.dev' }), config);
	const renamed = await accessUser(await token({ email: 'new@regit.dev' }), config);
	const other = await accessUser(await token({ email: 'sam@regit.dev', sub: 'other' }), config);
	expect(first?.id).toBe(renamed?.id);
	expect(first?.id).not.toBe(other?.id);
	expect(principalId('https://other.cloudflareaccess.com', 'sam-subject')).not.toBe(first?.id);
	expect(await accessUser(await token({ email: 'sam@regit.dev', sub: '' }), config)).toBeNull();
	const missingSubject = await new SignJWT({ email: 'sam@regit.dev' })
		.setProtectedHeader({ alg: 'RS256' })
		.setIssuer(`https://${teamDomain}`)
		.setAudience(audience)
		.setExpirationTime('1h')
		.sign(privateKey);
	expect(await accessUser(missingSubject, config)).toBeNull();
});

import { describe, expect, test } from 'bun:test';
import { backoff, isTransient, SandboxUnavailableError } from './transient.ts';

const failure = (fields: object) => Object.assign(new Error('x'), fields);

describe('isTransient', () => {
	test('retries outages, rate limits and lost connections', () => {
		expect(isTransient(new SandboxUnavailableError('gone'))).toBe(true);
		expect(isTransient(failure({ status: 429 }))).toBe(true);
		expect(isTransient(failure({ status: 503 }))).toBe(true);
		expect(isTransient(failure({ code: 'server_error' }))).toBe(true);
		expect(isTransient(failure({ retryable: true }))).toBe(true);
		expect(isTransient(failure({ code: 'UPSTREAM_UNAVAILABLE' }))).toBe(true);
		expect(isTransient(new Error('Network connection lost.'))).toBe(true);
		expect(isTransient(new Error('fetch failed: the remote end hung up unexpectedly'))).toBe(true);
	});

	test('fails fast on errors that would repeat', () => {
		expect(isTransient(failure({ status: 400 }))).toBe(false);
		expect(isTransient(failure({ status: 401 }))).toBe(false);
		expect(isTransient(failure({ code: 'NOT_FOUND' }))).toBe(false);
		expect(isTransient(new Error('rebase --onto abc def failed: CONFLICT'))).toBe(false);
		expect(isTransient('nope')).toBe(false);
	});
});

describe('backoff', () => {
	test('grows exponentially up to a cap and honours Retry-After', () => {
		expect(backoff(1, 1000, 8000)).toBeWithin(800, 1201);
		expect(backoff(3, 1000, 8000)).toBeWithin(3200, 4801);
		expect(backoff(10, 1000, 8000)).toBeLessThanOrEqual(9600);
		expect(backoff(1, 1000, 60_000, { retryAfterMs: 20_000 })).toBe(20_000);
	});
});

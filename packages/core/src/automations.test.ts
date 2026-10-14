import { expect, test } from 'bun:test';
import {
	describeTrigger,
	maxAutomationLifetimeMs,
	nextScheduled,
	normalizeAutomation,
	parseDuration
} from './automations.ts';

const now = Date.parse('2026-10-14T10:00:00Z');
const hour = 60 * 60 * 1000;
const day = 24 * hour;
const base = { name: 'check', message: 'Check the deploy' };

test('parses durations, alone and combined', () => {
	expect(parseDuration('30s')).toBe(30_000);
	expect(parseDuration('15m')).toBe(15 * 60_000);
	expect(parseDuration('1h30m')).toBe(1.5 * hour);
	expect(parseDuration('2w')).toBe(14 * day);
	for (const bad of ['', '15', 'm', '1.5h', '0m', '2 hours'])
		expect(() => parseDuration(bad)).toThrow();
});

test('an event trigger waits, runs once and lasts at most 30 days by default', () => {
	expect(normalizeAutomation({ ...base, on: { event: 'deployed' }, delay: '15m' }, now)).toEqual({
		name: 'check',
		on: { event: 'deployed' },
		delayMs: 15 * 60_000,
		message: 'Check the deploy',
		runLimit: 1,
		expiresAt: now + maxAutomationLifetimeMs,
		nextAt: null
	});
	expect(() => normalizeAutomation({ ...base, on: { event: 'merged' } }, now)).toThrow(
		'on.event must be one of'
	);
});

test('at and after run once, at their time', () => {
	expect(normalizeAutomation({ ...base, on: { after: '2h' } }, now)).toMatchObject({
		nextAt: now + 2 * hour,
		runLimit: 1
	});
	expect(
		normalizeAutomation({ ...base, on: { at: '2026-10-15T09:00:00+02:00' } }, now).nextAt
	).toBe(Date.parse('2026-10-15T07:00:00Z'));
	expect(() => normalizeAutomation({ ...base, on: { at: '2026-10-13T09:00Z' } }, now)).toThrow(
		'already passed'
	);
	expect(() => normalizeAutomation({ ...base, on: { at: 'tomorrow' } }, now)).toThrow();
	expect(() =>
		normalizeAutomation({ ...base, on: { after: '1h' }, expires: { runs: 3 } }, now)
	).toThrow('runs once');
	expect(() => normalizeAutomation({ ...base, on: { after: '31d' } }, now)).toThrow();
	expect(() => normalizeAutomation({ ...base, on: { after: '1h' }, delay: '5m' }, now)).toThrow(
		'Only an event trigger takes a delay'
	);
});

test('a schedule repeats in its time zone and ends after 7 days unless told otherwise', () => {
	const daily = normalizeAutomation(
		{ ...base, on: { schedule: '0 9 * * *', timezone: 'Europe/Berlin' } },
		now
	);
	expect(daily).toMatchObject({
		nextAt: Date.parse('2026-10-15T07:00:00Z'),
		runLimit: 50,
		expiresAt: now + 7 * day
	});
	expect(nextScheduled({ schedule: '0 9 * * *' }, now)).toBe(Date.parse('2026-10-15T09:00:00Z'));
	expect(
		normalizeAutomation(
			{ ...base, on: { schedule: '*/30 * * * *' }, expires: { runs: 5, after: '2d' } },
			now
		)
	).toMatchObject({ runLimit: 5, expiresAt: now + 2 * day, nextAt: now + 30 * 60_000 });
	expect(() => normalizeAutomation({ ...base, on: { schedule: '* * * * * *' } }, now)).toThrow(
		'five fields'
	);
	expect(() =>
		normalizeAutomation({ ...base, on: { schedule: '0 9 * * *', timezone: 'Mars/Base' } }, now)
	).toThrow('time zone');
	expect(() =>
		normalizeAutomation({ ...base, on: { schedule: '0 9 1 1 *' }, expires: { after: '3d' } }, now)
	).toThrow('first runs after the automation expires');
});

test('expiry is capped at 50 runs and 30 days', () => {
	const on = { schedule: '0 * * * *' };
	expect(normalizeAutomation({ ...base, on, expires: { runs: 50 } }, now).runLimit).toBe(50);
	expect(() => normalizeAutomation({ ...base, on, expires: { runs: 51 } }, now)).toThrow();
	expect(() => normalizeAutomation({ ...base, on, expires: { runs: 0 } }, now)).toThrow();
	expect(() => normalizeAutomation({ ...base, on, expires: { runs: 2.5 } }, now)).toThrow();
	expect(normalizeAutomation({ ...base, on, expires: { after: '30d' } }, now).expiresAt).toBe(
		now + 30 * day
	);
	expect(() => normalizeAutomation({ ...base, on, expires: { after: '31d' } }, now)).toThrow();
	expect(
		normalizeAutomation({ ...base, on, expires: { after: '2026-10-20T00:00Z' } }, now).expiresAt
	).toBe(Date.parse('2026-10-20T00:00Z'));
});

test('rejects a missing name, message or trigger, and more than one trigger', () => {
	expect(() => normalizeAutomation({ ...base, name: ' ', on: { after: '1h' } }, now)).toThrow();
	expect(() => normalizeAutomation({ ...base, message: '', on: { after: '1h' } }, now)).toThrow();
	expect(() => normalizeAutomation(base, now)).toThrow('Say when it runs');
	expect(() =>
		normalizeAutomation({ ...base, on: { after: '1h', event: 'deployed' } }, now)
	).toThrow('exactly one');
	expect(() => normalizeAutomation({ ...base, on: { after: '1h', timezone: 'UTC' } }, now)).toThrow(
		'Only a schedule takes a timezone'
	);
});

test('describes triggers in words', () => {
	expect(describeTrigger({ event: 'deployed' }, 15 * 60_000)).toBe(
		'15m after what this thread shipped deploys'
	);
	expect(describeTrigger({ event: 'shipped' })).toBe('When this thread ships');
	expect(describeTrigger({ schedule: '0 9 * * 1-5', timezone: 'Europe/Berlin' })).toBe(
		'On schedule 0 9 * * 1-5 (Europe/Berlin)'
	);
});

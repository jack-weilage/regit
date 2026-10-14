import { Cron } from 'croner';

// Moments in a shipped thread's life, from its verdict: shipping lands it, then main's checks pass or fail, it
// deploys, or it is reverted.
export const threadEvents = ['shipped', 'passed', 'failed', 'deployed', 'reverted'] as const;

export type ThreadEvent = (typeof threadEvents)[number];

export type AutomationTrigger =
	| { event: ThreadEvent }
	| { at: string }
	| { after: string }
	| { schedule: string; timezone?: string };

// What an agent asks for. The same shape, with a target, is meant for repository automations in a file later.
export interface AutomationSpec {
	name: string;
	on: AutomationTrigger;
	delay?: string;
	message: string;
	expires?: { runs?: number; after?: string };
}

export type AutomationEnd = 'runs' | 'expired' | 'cancelled' | 'thread';

export interface Automation {
	id: string;
	thread: string;
	name: string;
	on: AutomationTrigger;
	delayMs: number;
	message: string;
	runs: { done: number; limit: number };
	createdAt: number;
	expiresAt: number;
	// When it next fires; null while it waits for a thread event.
	nextAt: number | null;
	lastRunAt: number | null;
	ended: { at: number; reason: AutomationEnd; by?: string } | null;
}

export interface NormalizedAutomation {
	name: string;
	on: AutomationTrigger;
	delayMs: number;
	message: string;
	runLimit: number;
	expiresAt: number;
	nextAt: number | null;
}

export const maxAutomationRuns = 50;
export const maxAutomationLifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const defaultScheduleLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const maxMessageChars = 4000;
const maxNameChars = 64;

const units: Record<string, number> = {
	s: 1000,
	m: 60 * 1000,
	h: 60 * 60 * 1000,
	d: 24 * 60 * 60 * 1000,
	w: 7 * 24 * 60 * 60 * 1000
};

// Durations such as "30s", "15m", "2h", "3d", "1w" or "1h30m".
export function parseDuration(text: string) {
	const value = text.trim().toLowerCase();
	if (!/^(\d+[smhdw])+$/.test(value))
		throw new Error(`"${text}" isn't a duration. Use a number and unit, such as 15m, 2h or 3d`);
	let total = 0;
	for (const [, amount, unit] of value.matchAll(/(\d+)([smhdw])/g))
		total += Number(amount) * units[unit!]!;
	if (!total) throw new Error(`"${text}" is no time at all`);
	return total;
}

function parseTime(text: string, now: number) {
	const at = Date.parse(text);
	if (Number.isNaN(at) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text.trim()))
		throw new Error(
			`"${text}" isn't a time. Use ISO 8601 with a time zone, such as 2026-11-01T09:00Z`
		);
	if (at <= now) throw new Error(`${text} has already passed`);
	return at;
}

function schedule(pattern: string, timezone?: string) {
	if (pattern.trim().split(/\s+/).length !== 5)
		throw new Error(
			`"${pattern}" isn't a cron schedule. Use five fields: minute hour day-of-month month day-of-week`
		);
	if (timezone) {
		try {
			new Intl.DateTimeFormat('en', { timeZone: timezone });
		} catch {
			throw new Error(`"${timezone}" isn't a time zone. Use an IANA name such as Europe/Berlin`);
		}
	}
	try {
		return new Cron(pattern.trim(), { timezone, paused: true });
	} catch (error) {
		throw new Error(`"${pattern}" isn't a cron schedule: ${(error as Error).message}`);
	}
}

// The first time a schedule fires after a moment.
export function nextScheduled(on: { schedule: string; timezone?: string }, after: number) {
	return schedule(on.schedule, on.timezone).nextRun(new Date(after))?.getTime() ?? null;
}

function trigger(on: unknown, now: number): { on: AutomationTrigger; nextAt: number | null } {
	if (!on || typeof on !== 'object') throw new Error('Say when it runs with on');
	const given = on as Record<string, unknown>;
	const kinds = ['event', 'at', 'after', 'schedule'].filter((key) => given[key] !== undefined);
	if (kinds.length !== 1) throw new Error('Give on exactly one of event, at, after or schedule');
	const [kind] = kinds;
	const value = given[kind!];
	if (typeof value !== 'string' || !value.trim()) throw new Error(`on.${kind} must be text`);
	if (kind !== 'schedule' && given.timezone !== undefined)
		throw new Error('Only a schedule takes a timezone');
	if (kind === 'event') {
		if (!threadEvents.includes(value as ThreadEvent))
			throw new Error(`on.event must be one of ${threadEvents.join(', ')}`);
		return { on: { event: value as ThreadEvent }, nextAt: null };
	}
	if (kind === 'at') return { on: { at: value.trim() }, nextAt: parseTime(value, now) };
	if (kind === 'after') return { on: { after: value.trim() }, nextAt: now + parseDuration(value) };
	const timezone = given.timezone;
	if (timezone !== undefined && (typeof timezone !== 'string' || !timezone.trim()))
		throw new Error('on.timezone must be text');
	const scheduled = { schedule: value.trim(), ...(timezone ? { timezone: timezone.trim() } : {}) };
	return { on: scheduled, nextAt: nextScheduled(scheduled, now) };
}

// Checks what an agent asked for and works out when it first runs and when it ends.
export function normalizeAutomation(input: unknown, now: number): NormalizedAutomation {
	if (!input || typeof input !== 'object') throw new Error('Describe the automation');
	const spec = input as Record<string, unknown>;
	const name = typeof spec.name === 'string' ? spec.name.trim() : '';
	if (!name || name.length > maxNameChars)
		throw new Error(`Give it a name of at most ${maxNameChars} characters`);
	const message = typeof spec.message === 'string' ? spec.message.trim() : '';
	if (!message || message.length > maxMessageChars)
		throw new Error(`Give it a message of at most ${maxMessageChars} characters`);
	const { on, nextAt: first } = trigger(spec.on, now);
	const once = 'at' in on || 'after' in on;
	const recurring = 'schedule' in on;

	if (spec.delay !== undefined && typeof spec.delay !== 'string')
		throw new Error('delay must be a duration such as 15m');
	if (spec.delay !== undefined && !('event' in on))
		throw new Error('Only an event trigger takes a delay; put the time in on instead');
	const delayMs = typeof spec.delay === 'string' ? parseDuration(spec.delay) : 0;
	if (delayMs > maxAutomationLifetimeMs) throw new Error('delay can be at most 30 days');

	const expires = (spec.expires ?? {}) as Record<string, unknown>;
	if (typeof expires !== 'object') throw new Error('expires takes runs and after');
	const { runs, after } = expires;
	if (
		runs !== undefined &&
		(typeof runs !== 'number' || !Number.isInteger(runs) || runs < 1 || runs > maxAutomationRuns)
	)
		throw new Error(`expires.runs must be a whole number from 1 to ${maxAutomationRuns}`);
	if (once && typeof runs === 'number' && runs > 1)
		throw new Error('An at or after trigger runs once; use a schedule to repeat');
	if (after !== undefined && (typeof after !== 'string' || !after.trim()))
		throw new Error('expires.after must be a duration such as 7d, or a time');
	const runLimit = (runs as number | undefined) ?? (recurring ? maxAutomationRuns : 1);

	const cap = now + maxAutomationLifetimeMs;
	let expiresAt = recurring ? now + defaultScheduleLifetimeMs : cap;
	if (typeof after === 'string') {
		expiresAt = /^\d{4}-/.test(after.trim()) ? parseTime(after, now) : now + parseDuration(after);
		if (expiresAt > cap) throw new Error('expires.after can be at most 30 days away');
	}
	if (first !== null && first > expiresAt)
		throw new Error(
			recurring
				? 'The schedule first runs after the automation expires'
				: 'That is after the automation expires; it can run at most 30 days from now'
		);
	return { name, on, delayMs, message, runLimit, expiresAt, nextAt: first };
}

const eventPhrases: Record<ThreadEvent, string> = {
	shipped: 'this thread ships',
	passed: "main's checks pass on what this thread shipped",
	failed: "main's checks fail on what this thread shipped",
	deployed: 'what this thread shipped deploys',
	reverted: 'what this thread shipped is reverted'
};

function formatDelay(ms: number) {
	for (const [unit, size] of Object.entries(units).reverse())
		if (ms % size === 0) return `${ms / size}${unit}`;
	return `${Math.round(ms / 1000)}s`;
}

export function describeTrigger(on: AutomationTrigger, delayMs = 0) {
	if ('event' in on)
		return `${delayMs ? `${formatDelay(delayMs)} after` : 'When'} ${eventPhrases[on.event]}`;
	if ('at' in on) return `At ${on.at}`;
	if ('after' in on) return `${on.after} after it was set up`;
	return `On schedule ${on.schedule}${on.timezone ? ` (${on.timezone})` : ' (UTC)'}`;
}

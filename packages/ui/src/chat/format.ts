import { getContext, hasContext, setContext } from 'svelte';

export interface TimeOptions {
	locale?: string;
	timeZone?: string;
}

export interface Formatters {
	time(at: Date | number): string;
	clock(at: Date | number): string;
	date(at: Date | number): string;
	age(at: number, now?: number): string;
	ago(at: number, now?: number): string;
}

function create({ locale, timeZone }: TimeOptions): Formatters {
	const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone });
	const clock = new Intl.DateTimeFormat(locale, {
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
		timeZone
	});
	const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone });
	const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
	return {
		time: (at) => time.format(at),
		clock: (at) => clock.format(at),
		date: (at) => date.format(at),
		age(at, now = Date.now()) {
			const minutes = Math.max(0, now - at) / 60_000;
			if (minutes < 1) return 'now';
			if (minutes < 60) return `${Math.floor(minutes)}m`;
			if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
			if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 60 / 24)}d`;
			return date.format(at);
		},
		ago(at, now = Date.now()) {
			const minutes = Math.round((at - now) / 60_000);
			if (Math.abs(minutes) < 1) return 'just now';
			if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
			if (Math.abs(minutes) < 60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
			return relative.format(Math.round(minutes / 60 / 24), 'day');
		}
	};
}

const cache = new Map<string, Formatters>();

export function formatters(options: TimeOptions = {}) {
	const valid = {
		locale: supported(options.locale, 'locale'),
		timeZone: supported(options.timeZone, 'timeZone')
	};
	const id = `${valid.locale ?? ''}|${valid.timeZone ?? ''}`;
	let found = cache.get(id);
	if (!found) {
		if (cache.size >= 100) cache.clear();
		cache.set(id, (found = create(valid)));
	}
	return found;
}

function supported(value: string | undefined, kind: 'locale' | 'timeZone') {
	if (!value) return undefined;
	try {
		new Intl.DateTimeFormat(kind === 'locale' ? value : undefined, {
			timeZone: kind === 'timeZone' ? value : undefined
		});
		return value;
	} catch {
		return undefined;
	}
}

const key = Symbol('time options');

// Servers render with the viewer's options (from a cookie) so hydration doesn't change the text.
export function setTimeOptions(options: () => TimeOptions) {
	setContext(key, () => formatters(options()));
}

export function useFormat(): Formatters {
	const current = hasContext(key) ? getContext<() => Formatters>(key) : () => formatters();
	return {
		time: (at) => current().time(at),
		clock: (at) => current().clock(at),
		date: (at) => current().date(at),
		age: (at, now) => current().age(at, now),
		ago: (at, now) => current().ago(at, now)
	};
}

export function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
}

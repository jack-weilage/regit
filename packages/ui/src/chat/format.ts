export const formatTime = new Intl.DateTimeFormat(undefined, {
	hour: 'numeric',
	minute: '2-digit'
}).format;

const shortDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function formatAge(at: number, now = Date.now()) {
	const minutes = Math.max(0, now - at) / 60_000;
	if (minutes < 1) return 'now';
	if (minutes < 60) return `${Math.floor(minutes)}m`;
	if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h`;
	if (minutes < 60 * 24 * 7) return `${Math.floor(minutes / 60 / 24)}d`;
	return shortDate.format(at);
}

export const formatDate = shortDate.format;

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function formatAgo(at: number, now = Date.now()) {
	const minutes = Math.round((at - now) / 60_000);
	if (Math.abs(minutes) < 1) return 'just now';
	if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
	if (Math.abs(minutes) < 60 * 24) return relative.format(Math.round(minutes / 60), 'hour');
	return relative.format(Math.round(minutes / 60 / 24), 'day');
}

export function formatDuration(ms: number) {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ''}`;
}

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

export const formatTime = new Intl.DateTimeFormat(undefined, {
	hour: 'numeric',
	minute: '2-digit'
}).format;

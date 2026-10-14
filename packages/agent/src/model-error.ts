export class ModelError extends Error {
	constructor(
		message: string,
		readonly status?: number,
		readonly code?: string,
		readonly retryAfterMs?: number
	) {
		super(message);
		this.name = 'ModelError';
	}
}

export function retryAfter(headers: Headers | undefined) {
	const ms = Number(headers?.get('retry-after-ms'));
	if (ms > 0) return ms;
	const seconds = Number(headers?.get('retry-after'));
	return seconds > 0 ? seconds * 1000 : undefined;
}

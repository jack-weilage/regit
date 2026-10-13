// The sandbox couldn't be reached at all, as opposed to a tool that ran and failed.
export class SandboxUnavailableError extends Error {
	override name = 'SandboxUnavailableError';
}

const statuses = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524, 529]);
const codes = new Set([
	'server_error',
	'rate_limit_exceeded',
	'overloaded_error',
	'connection_error',
	'stream_ended',
	'CREATE_IN_PROGRESS',
	'IMPORT_IN_PROGRESS',
	'FORK_IN_PROGRESS',
	'UPSTREAM_UNAVAILABLE',
	'INTERNAL_ERROR'
]);
const messages =
	/network connection lost|connection (reset|refused|closed|error)|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|remote end hung up|early EOF|RPC failed|could not resolve host|returned error: 5\d\d|Durable Object reset|is overloaded|internal error/i;

export function isTransient(error: unknown): boolean {
	if (error instanceof SandboxUnavailableError) return true;
	if (typeof error !== 'object' || !error) return false;
	const { retryable, status, code, message } = error as {
		retryable?: unknown;
		status?: unknown;
		code?: unknown;
		message?: unknown;
	};
	if (retryable === true) return true;
	if (typeof status === 'number') return statuses.has(status);
	if (typeof code === 'string' && codes.has(code)) return true;
	return typeof message === 'string' && messages.test(message);
}

export function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

// Exponential backoff with jitter, never sooner than the server asked for.
export function backoff(attempt: number, baseMs: number, maxMs: number, error?: unknown) {
	const exponential = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
	const jittered = exponential * (0.8 + Math.random() * 0.4);
	const asked = (error as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
	return Math.round(Math.max(jittered, typeof asked === 'number' ? Math.min(asked, maxMs) : 0));
}

export function sleep(ms: number, signal?: AbortSignal) {
	return new Promise<void>((resolve) => {
		if (signal?.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal?.addEventListener('abort', done, { once: true });
	});
}

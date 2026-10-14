export const liveHeartbeatMs = 25_000;

const staleMs = 2 * liveHeartbeatMs + 10_000;
const firstRetryMs = 1_000;
const maxRetryMs = 30_000;
const sourceClosed = 2; // EventSource.CLOSED

export interface LiveHandlers {
	message(data: string): void;
	// Updates sent while disconnected are lost, so a reopened stream reloads what they would have changed.
	reconnected(): void;
}

// The part of an EventSource this uses, so it type-checks without the DOM and tests can fake it.
export interface LiveSource {
	readonly readyState: number;
	addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
	close(): void;
}

export interface LiveEnvironment {
	open(url: string): LiveSource;
	page: EventTarget;
	visible(): boolean;
}

// EventSource gives up for good when a reconnect gets an error response, and never notices a connection a sleeping
// device left half-open. This replaces a source that closed or went quiet past two heartbeats, retrying with
// backoff, and checks as soon as the page wakes, since timers don't run while it sleeps.
export function connectLive(url: string, handlers: LiveHandlers, env: LiveEnvironment) {
	let source: LiveSource | undefined;
	let opened = false;
	let heard = Date.now();
	let failures = 0;
	let retry: ReturnType<typeof setTimeout> | undefined;

	function connect() {
		clearTimeout(retry);
		retry = undefined;
		source?.close();
		heard = Date.now();
		const current = (source = env.open(url));
		current.addEventListener('open', () => {
			failures = 0;
			heard = Date.now();
			if (opened) handlers.reconnected();
			opened = true;
		});
		current.addEventListener('ping', () => (heard = Date.now()));
		current.addEventListener('message', (event) => {
			heard = Date.now();
			handlers.message(String(event.data));
		});
		current.addEventListener('error', () => {
			if (current === source && current.readyState === sourceClosed && !retry)
				retry = setTimeout(connect, Math.min(firstRetryMs * 2 ** failures++, maxRetryMs));
		});
	}

	const stale = () => !retry && Date.now() - heard > staleMs;
	const wake = () => {
		if (env.visible() && (retry || stale())) connect();
	};

	const watchdog = setInterval(() => stale() && connect(), liveHeartbeatMs);
	const events = ['visibilitychange', 'online', 'pageshow'];
	for (const event of events) env.page.addEventListener(event, wake);
	connect();

	return () => {
		clearInterval(watchdog);
		clearTimeout(retry);
		for (const event of events) env.page.removeEventListener(event, wake);
		source?.close();
	};
}

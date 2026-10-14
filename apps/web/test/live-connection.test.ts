import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { connectLive, liveHeartbeatMs, type LiveSource } from '../src/lib/live.ts';

// An EventSource the test drives: it opens, delivers, and fails the way a browser's does.
class FakeSource implements LiveSource {
	readyState = 0;
	#listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();
	addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
		this.#listeners.set(type, [...(this.#listeners.get(type) ?? []), listener]);
	}
	open() {
		this.readyState = 1;
		this.deliver('open');
	}
	deliver(type: string, data = '') {
		for (const listener of this.#listeners.get(type) ?? []) listener({ data });
	}
	// A refused reconnect, like an error response while forge deploys, closes an EventSource for good.
	refuse() {
		this.readyState = 2;
		this.deliver('error');
	}
	close() {
		this.readyState = 2;
	}
}

let sources: FakeSource[];
let page: EventTarget;
let visible: boolean;
let messages: string[];
let reconnects: number;
let stop: () => void;

beforeEach(() => {
	vi.useFakeTimers();
	sources = [];
	page = new EventTarget();
	visible = true;
	messages = [];
	reconnects = 0;
	stop = connectLive(
		'/demo/live',
		{ message: (data) => messages.push(data), reconnected: () => reconnects++ },
		{
			open: () => {
				const source = new FakeSource();
				sources.push(source);
				return source;
			},
			page,
			visible: () => visible
		}
	);
	sources[0]!.open();
});
afterEach(() => {
	stop();
	vi.useRealTimers();
});

const latest = () => sources.at(-1)!;

test('relays messages and reloads only after a reconnect', () => {
	latest().deliver('message', '{"type":"entry"}');
	expect(messages).toEqual(['{"type":"entry"}']);
	expect(reconnects).toBe(0);
});

test('retries with backoff after a reconnect is refused', async () => {
	latest().refuse();
	await vi.advanceTimersByTimeAsync(999);
	expect(sources).toHaveLength(1);
	await vi.advanceTimersByTimeAsync(1);
	expect(sources).toHaveLength(2);

	latest().refuse();
	await vi.advanceTimersByTimeAsync(1_999);
	expect(sources).toHaveLength(2);
	await vi.advanceTimersByTimeAsync(1);
	expect(sources).toHaveLength(3);

	latest().open();
	expect(reconnects).toBe(1);
	latest().refuse();
	await vi.advanceTimersByTimeAsync(1_000);
	expect(sources).toHaveLength(4);
});

test('keeps a stream that pings and replaces one that goes quiet', async () => {
	for (let beat = 0; beat < 4; beat++) {
		await vi.advanceTimersByTimeAsync(liveHeartbeatMs);
		latest().deliver('ping');
	}
	expect(sources).toHaveLength(1);

	await vi.advanceTimersByTimeAsync(3 * liveHeartbeatMs);
	expect(sources).toHaveLength(2);
	expect(sources[0]!.readyState).toBe(2);
	latest().open();
	expect(reconnects).toBe(1);
});

test('reconnects as soon as the page wakes from a sleep that froze its timers', () => {
	vi.setSystemTime(Date.now() + 10 * 60_000);
	visible = false;
	page.dispatchEvent(new Event('visibilitychange'));
	expect(sources).toHaveLength(1);

	visible = true;
	page.dispatchEvent(new Event('visibilitychange'));
	expect(sources).toHaveLength(2);
	latest().open();
	expect(reconnects).toBe(1);

	page.dispatchEvent(new Event('visibilitychange'));
	expect(sources).toHaveLength(2);
});

test('skips the backoff when the network comes back', () => {
	latest().refuse();
	page.dispatchEvent(new Event('online'));
	expect(sources).toHaveLength(2);
});

test('closes the stream and stops reconnecting when the page leaves', async () => {
	stop();
	expect(latest().readyState).toBe(2);
	await vi.advanceTimersByTimeAsync(10 * liveHeartbeatMs);
	page.dispatchEvent(new Event('online'));
	expect(sources).toHaveLength(1);
});

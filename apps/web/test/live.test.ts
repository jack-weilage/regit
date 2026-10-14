import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GET } from '../src/routes/[repo]/live/+server.ts';

const heartbeat = 25_000;

// A coordinator socket that delivers messages and answers pings until it goes silent.
class FakeSocket extends EventTarget {
	silent = false;
	closed = false;
	sent: string[] = [];
	accept() {}
	send(data: string) {
		this.sent.push(data);
		if (data === 'ping' && !this.silent)
			queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: 'pong' })));
	}
	close() {
		this.closed = true;
	}
	deliver(data: string) {
		this.dispatchEvent(new MessageEvent('message', { data }));
	}
}

const state = vi.hoisted(() => ({ socket: null as unknown as FakeSocket }));
vi.mock('#lib/server/access.ts', () => ({ requireRepoAccess: async () => {} }));
vi.mock('#lib/server/coordinators.ts', () => ({
	coordinatorFor: () => ({ fetch: async () => ({ webSocket: state.socket }) })
}));

beforeEach(() => {
	vi.useFakeTimers();
	state.socket = new FakeSocket();
});
afterEach(() => vi.useRealTimers());

async function open() {
	const response = await GET({
		params: { repo: 'demo' },
		request: new Request('https://regit.dev/demo/live'),
		locals: { user: { id: 'viewer' } }
	} as unknown as Parameters<typeof GET>[0]);
	const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
	let text = '';
	let done = false;
	const pump = (async () => {
		for (;;) {
			const chunk = await reader.read();
			if (chunk.done) return void (done = true);
			text += chunk.value;
		}
	})();
	return { read: () => text, ended: () => done, pump };
}

test('relays coordinator messages and keeps a coordinator that answers pings', async () => {
	const live = await open();
	state.socket.deliver('{"type":"entry"}');
	await vi.advanceTimersByTimeAsync(5 * heartbeat);
	expect(live.read()).toContain('data: {"type":"entry"}\n\n');
	expect(live.read()).toContain(': ping\n\n');
	expect(live.read()).not.toContain('pong');
	expect(state.socket.sent.filter((data) => data === 'ping')).toHaveLength(5);
	expect(live.ended()).toBe(false);
});

test('ends the stream when the coordinator stops answering, so the browser reconnects', async () => {
	const live = await open();
	await vi.advanceTimersByTimeAsync(2 * heartbeat);
	state.socket.silent = true;
	await vi.advanceTimersByTimeAsync(2 * heartbeat);
	expect(live.ended()).toBe(false);
	await vi.advanceTimersByTimeAsync(heartbeat);
	await live.pump;
	expect(live.ended()).toBe(true);
	expect(state.socket.closed).toBe(true);
});

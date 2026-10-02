import type { ChatGPTTokens, TokenStore } from './auth.ts';

export function memoryStore(tokens: ChatGPTTokens) {
	const store: TokenStore & { tokens: ChatGPTTokens } = {
		tokens,
		async load() {
			return store.tokens;
		},
		async save(next) {
			store.tokens = next;
		}
	};
	return store;
}

export function jwt(payload: object) {
	const encode = (value: object) => btoa(JSON.stringify(value)).replaceAll('=', '');
	return `${encode({ alg: 'none' })}.${encode(payload)}.`;
}

export function eventStream(events: object[]) {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

export function fakeFetch(...responses: (Response | (() => Response))[]) {
	const requests: { url: string; init: RequestInit; body: any }[] = [];
	const fetch = (async (url: string, init: RequestInit) => {
		requests.push({ url, init, body: JSON.parse(init.body as string) });
		const next = responses.shift();
		if (!next) throw new Error(`Unexpected request to ${url}`);
		return typeof next === 'function' ? next() : next;
	}) as typeof globalThis.fetch;
	return { fetch, requests };
}

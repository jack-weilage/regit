export { fakeGateway } from '../testing.ts';

export const completed = {
	type: 'response.completed',
	response: {
		usage: {
			input_tokens: 120,
			output_tokens: 30,
			input_tokens_details: { cached_tokens: 100, cache_write_tokens: 20 }
		}
	}
};

export function eventStream(events: object[]) {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
		headers: { 'Content-Type': 'text/event-stream' }
	});
}

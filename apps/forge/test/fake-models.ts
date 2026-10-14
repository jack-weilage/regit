import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GatewayRequest, JevRequest, JevResponse, Metadata } from '@regit/agent';

const completed = {
	type: 'response.completed',
	response: {
		usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }
	}
};

const replies = new Map<string, object[][]>();
const requests = new Map<string, GatewayRequest[]>();
const decisions = new Map<string, JevResponse[]>();
const decided = new Map<string, JevRequest[]>();

function list<T>(lists: Map<string, T[]>, repo: string) {
	if (!lists.has(repo)) lists.set(repo, []);
	return lists.get(repo)!;
}

export default class FakeModels extends WorkerEntrypoint {
	script(repo: string, next: object[][]) {
		replies.set(repo, next);
		requests.set(repo, []);
	}

	requests(repo: string) {
		return JSON.stringify(list(requests, repo));
	}

	scriptDecisions(repo: string, next: JevResponse[]) {
		decisions.set(repo, next);
		decided.set(repo, []);
	}

	decisionRequests(repo: string) {
		return JSON.stringify(list(decided, repo));
	}

	decide(request: JevRequest, { repo }: Metadata = {}): JevResponse {
		list(decided, String(repo)).push(request);
		const unrelated = { probabilities: { unrelated: 1 } };
		return (
			list(decisions, String(repo)).shift() ?? {
				answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, unrelated]))
			}
		);
	}

	run(request: GatewayRequest) {
		const { repo } = request.headers['cf-aig-metadata'] as Metadata;
		list(requests, String(repo)).push(request);
		const reply = list(replies, String(repo)).shift();
		if (!reply)
			return Response.json(
				{ error: { message: 'The fake model ran out of replies' } },
				{ status: 400 }
			);
		const outage = reply.find((event): event is { status: number } => 'status' in event);
		if (outage) return Response.json({ error: { message: 'The model is overloaded' } }, outage);
		if (request.provider === 'anthropic') return stream(asMessage(reply as Scripted[]), true);
		const events = reply.some((event) => 'type' in event && event.type === 'response.failed')
			? reply
			: [...reply, completed];
		return stream(events);
	}
}

function stream(events: object[], named = false) {
	return new Response(
		events
			.map((event) => {
				const name = named ? `event: ${(event as { type: string }).type}\n` : '';
				return `${name}data: ${JSON.stringify(event)}\n\n`;
			})
			.join(''),
		{ headers: { 'Content-Type': 'text/event-stream' } }
	);
}

type Scripted =
	| { type: 'response.output_text.delta'; delta: string }
	| {
			type: 'response.output_item.done';
			item: { type: string; call_id: string; name: string; arguments: string };
	  }
	| { type: 'response.failed'; response: { error: { code?: string; message: string } } };

// Tests script replies as Responses events; Claude models get the same reply as a Messages stream.
function asMessage(reply: Scripted[]) {
	const usage = { input_tokens: 50, output_tokens: 10 };
	const events: object[] = [
		{
			type: 'message_start',
			message: {
				id: 'msg_fake',
				type: 'message',
				role: 'assistant',
				model: 'claude-opus-5-5',
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage
			}
		}
	];
	let index = -1;
	let texting = false;
	let calling = false;
	for (const event of reply) {
		if (event.type === 'response.failed') {
			const { code, message } = event.response.error;
			events.push({ type: 'error', error: { type: code ?? 'api_error', message } });
			return events;
		}
		if (event.type === 'response.output_text.delta') {
			if (!texting) {
				events.push({
					type: 'content_block_start',
					index: ++index,
					content_block: { type: 'text', text: '' }
				});
				texting = true;
			}
			events.push({
				type: 'content_block_delta',
				index,
				delta: { type: 'text_delta', text: event.delta }
			});
			continue;
		}
		if (event.item.type !== 'function_call') continue;
		if (texting) events.push({ type: 'content_block_stop', index });
		texting = false;
		calling = true;
		const { call_id: id, name, arguments: input } = event.item;
		events.push(
			{
				type: 'content_block_start',
				index: ++index,
				content_block: { type: 'tool_use', id, name, input: {} }
			},
			{
				type: 'content_block_delta',
				index,
				delta: { type: 'input_json_delta', partial_json: input }
			},
			{ type: 'content_block_stop', index }
		);
	}
	if (texting) events.push({ type: 'content_block_stop', index });
	events.push(
		{
			type: 'message_delta',
			delta: { stop_reason: calling ? 'tool_use' : 'end_turn', stop_sequence: null },
			usage
		},
		{ type: 'message_stop' }
	);
	return events;
}

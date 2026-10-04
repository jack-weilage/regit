import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GatewayRequest, JevRequest, JevResponse } from '@regit/agent';

const completed = {
	type: 'response.completed',
	response: {
		usage: { input_tokens: 50, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } }
	}
};

let replies: object[][] = [];
let requests: GatewayRequest[] = [];
let decisions: JevResponse[] = [];
let decided: JevRequest[] = [];

export default class FakeModels extends WorkerEntrypoint {
	script(next: object[][]) {
		replies = next;
		requests = [];
	}

	requests() {
		return JSON.stringify(requests);
	}

	scriptDecisions(next: JevResponse[]) {
		decisions = next;
		decided = [];
	}

	decisionRequests() {
		return JSON.stringify(decided);
	}

	decide(request: JevRequest): JevResponse {
		decided.push(request);
		const unrelated = { probabilities: { unrelated: 1 } };
		return (
			decisions.shift() ?? {
				answers: Object.fromEntries(Object.keys(request.questions).map((key) => [key, unrelated]))
			}
		);
	}

	run(request: GatewayRequest) {
		requests.push(request);
		const reply = replies.shift();
		if (!reply)
			return Response.json(
				{ error: { message: 'The fake model ran out of replies' } },
				{ status: 500 }
			);
		const events = reply.some((event) => 'type' in event && event.type === 'response.failed')
			? reply
			: [...reply, completed];
		return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}
}

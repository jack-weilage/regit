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
		const events = reply.some((event) => 'type' in event && event.type === 'response.failed')
			? reply
			: [...reply, completed];
		return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {
			headers: { 'Content-Type': 'text/event-stream' }
		});
	}
}

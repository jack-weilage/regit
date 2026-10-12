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
let analyses: object[][] = [];
let analyzed: GatewayRequest[] = [];
const noChange = [{ type: 'response.output_text.delta', delta: 'No change.' }];

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

	scriptAnalyses(next: object[][]) {
		analyses = next;
		analyzed = [];
	}

	analysisRequests() {
		return JSON.stringify(analyzed);
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
		const metadata = request.headers['cf-aig-metadata'] as { task?: string } | undefined;
		const analysis = metadata?.task === 'analysis';
		(analysis ? analyzed : requests).push(request);
		const reply = analysis ? (analyses.shift() ?? noChange) : replies.shift();
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

import type { AgentEvent, ModelClient, ToolCall, ToolExecutor, Turn, Usage } from './types.ts';

export interface AgentOptions {
	model: ModelClient;
	tools: ToolExecutor;
	instructions: string;
	history: Turn[];
	maxSteps?: number;
	signal?: AbortSignal;
}

export type AgentOutcome = 'finished' | 'step-limit' | 'aborted';

export async function* runAgent({
	model,
	tools,
	instructions,
	history,
	maxSteps = 50,
	signal
}: AgentOptions): AsyncGenerator<AgentEvent, AgentOutcome> {
	const turns = [...history];

	for (let step = 0; step < maxSteps; step++) {
		if (signal?.aborted) return 'aborted';

		let text = '';
		const calls: ToolCall[] = [];
		const reasoning: unknown[] = [];
		let usage: Usage | undefined;

		for await (const event of model.respond(
			{ instructions, history: turns, tools: tools.specs },
			signal
		)) {
			if (event.type === 'text') {
				text += event.delta;
				yield event;
			} else if (event.type === 'call') {
				calls.push(event.call);
				yield event;
			} else if (event.type === 'reasoning') {
				reasoning.push(event.data);
			} else {
				usage = event.usage;
			}
		}

		const reply: Turn = { role: 'assistant', text, calls, ...(reasoning.length && { reasoning }) };
		turns.push(reply);
		yield { type: 'turn', turn: reply };
		if (usage) yield { type: 'usage', usage };

		if (calls.length === 0) return 'finished';

		const results = [];
		for (const call of calls) {
			if (signal?.aborted) return 'aborted';
			const output = await tools
				.execute(call, signal)
				.catch((error: unknown) => `Error: ${errorMessage(error)}`);
			const result = { callId: call.id, output };
			results.push(result);
			yield { type: 'result', result };
		}

		const toolTurn: Turn = { role: 'tool', results };
		turns.push(toolTurn);
		yield { type: 'turn', turn: toolTurn };
	}

	return 'step-limit';
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

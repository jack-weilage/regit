import type {
	AgentEvent,
	ModelClient,
	ToolCall,
	ToolExecutor,
	ToolResult,
	Turn,
	Usage
} from './types.ts';

export interface AgentOptions {
	model: ModelClient;
	tools: ToolExecutor;
	instructions: string;
	history: Turn[];
	maxSteps?: number;
	signal?: AbortSignal;
	steer?: () => Turn[] | Promise<Turn[]>;
}

export type AgentOutcome = 'finished' | 'step-limit' | 'aborted';

export async function* runAgent({
	model,
	tools,
	instructions,
	history,
	maxSteps = 50,
	signal,
	steer
}: AgentOptions): AsyncGenerator<AgentEvent, AgentOutcome> {
	const turns = [...history];

	for (let step = 0; step < maxSteps; step++) {
		if (signal?.aborted) return 'aborted';

		let text = '';
		const calls: ToolCall[] = [];
		const reasoning: string[] = [];
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

		if (calls.length === 0) {
			const steered = (await steer?.()) ?? [];
			yield { type: 'step', turns: [reply, ...steered], usage };
			if (!steered.length) return 'finished';
			turns.push(reply, ...steered);
			continue;
		}

		const results: ToolResult[] = [];
		for (const call of calls) {
			if (signal?.aborted) return 'aborted';
			const output = await tools
				.execute(call, signal)
				.catch((error: unknown) => `Error: ${errorMessage(error)}`);
			const result: ToolResult =
				typeof output === 'string'
					? { callId: call.id, output }
					: { callId: call.id, output: output.text, imageUrl: output.imageUrl };
			results.push(result);
			yield { type: 'result', result };
		}

		const step: Turn[] = [reply, { role: 'tool', results }, ...((await steer?.()) ?? [])];
		turns.push(...step);
		yield { type: 'step', turns: step, usage };
	}

	return 'step-limit';
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

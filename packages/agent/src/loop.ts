import type {
	AgentEvent,
	InflightStep,
	ModelClient,
	Reply,
	ToolCall,
	ToolExecutor,
	ToolResult,
	Turn,
	Usage
} from './types.ts';
import { backoff, errorMessage, isTransient, SandboxUnavailableError, sleep } from './transient.ts';

export interface RetryPolicy {
	limit: number;
	baseMs: number;
	maxMs: number;
}

export const modelRetries: RetryPolicy = { limit: 5, baseMs: 2000, maxMs: 30_000 };

export interface AgentOptions {
	model: ModelClient;
	tools: ToolExecutor;
	instructions: string;
	history: Turn[];
	maxSteps?: number;
	signal?: AbortSignal;
	steer?: () => Turn[] | Promise<Turn[]>;
	retries?: RetryPolicy;
	// Finishes an interrupted step: kept results are replayed as is and the other calls run.
	resume?: InflightStep;
	wait?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type AgentOutcome = 'finished' | 'step-limit' | 'aborted';

export async function* runAgent({
	model,
	tools,
	instructions,
	history,
	maxSteps = 50,
	signal,
	steer,
	retries = modelRetries,
	resume,
	wait = sleep
}: AgentOptions): AsyncGenerator<AgentEvent, AgentOutcome> {
	const turns = [...history];
	let resuming = resume;

	for (let step = 0; step < maxSteps; step++) {
		if (signal?.aborted) return 'aborted';

		let text = '';
		let calls: ToolCall[] = [];
		let reasoning: string[] = [];
		let compaction: string | undefined;
		let usage: Usage | undefined;
		const kept = new Map<string, ToolResult>();

		if (resuming) {
			({ text, calls } = resuming.reply);
			reasoning = resuming.reply.reasoning ?? [];
			compaction = resuming.reply.compaction;
			usage = resuming.usage;
			for (const result of resuming.results) kept.set(result.callId, result);
			for (const call of calls) yield { type: 'call', call };
			resuming = undefined;
		} else {
			for (let attempt = 1; ; attempt++) {
				try {
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
						} else if (event.type === 'compaction') {
							compaction = event.data;
						} else if (event.type === 'compacting') {
							yield event;
						} else {
							usage = event.usage;
						}
					}
					break;
				} catch (error) {
					if (signal?.aborted) return 'aborted';
					if (attempt >= retries.limit || !isTransient(error)) throw error;
					const delayMs = backoff(attempt, retries.baseMs, retries.maxMs, error);
					yield {
						type: 'retry',
						label: 'Model request',
						error: errorMessage(error),
						attempt: attempt + 1,
						limit: retries.limit,
						delayMs
					};
					[text, calls, reasoning, compaction, usage] = ['', [], [], undefined, undefined];
					await wait(delayMs, signal);
					if (signal?.aborted) return 'aborted';
				}
			}
		}

		const reply: Reply = {
			role: 'assistant',
			text,
			calls,
			...(reasoning.length && { reasoning }),
			...(compaction && { compaction })
		};

		if (calls.length === 0) {
			const steered = (await steer?.()) ?? [];
			yield { type: 'step', turns: [reply, ...steered], usage };
			if (!steered.length) return 'finished';
			turns.push(reply, ...steered);
			continue;
		}

		yield { type: 'reply', reply, usage };
		const results: ToolResult[] = [];
		for (const call of calls) {
			if (signal?.aborted) return 'aborted';
			const replayed = kept.get(call.id);
			if (replayed) {
				results.push(replayed);
				yield { type: 'result', result: replayed };
				continue;
			}
			const output = await tools.execute(call, signal).catch((error: unknown) => {
				if (error instanceof SandboxUnavailableError) throw error;
				return `Error: ${errorMessage(error)}`;
			});
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

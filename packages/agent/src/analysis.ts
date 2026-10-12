import type { Intent } from './intent.ts';
import { runAgent } from './loop.ts';
import type { ModelClient, ToolExecutor, Turn, Usage } from './types.ts';

export const recordTools = ['update_intent', 'suggest_thread'];

export interface ThreadRecords {
	intent?: Intent;
	suggestions: string[];
}

export function analysisRequest({ intent, suggestions }: ThreadRecords) {
	const recorded = intent
		? `The recorded intent is "${intent.headline}": ${intent.purpose} Done when: ${intent.doneWhen.join('; ')}`
		: 'No intent is recorded yet.';
	const suggested = suggestions.length
		? `Separate work already suggested: ${suggestions.join('; ')}.`
		: 'No separate work has been suggested yet.';
	return `ReGit (automatic, not from a person): update this thread's records from everything above. Only update_intent and suggest_thread are available, and this message isn't shown to anyone.

${recorded}
${suggested}

- If people asked for a change and the recorded intent is missing or no longer describes it, call update_intent with a headline, purpose and done-when checks that capture exactly what they asked for, including later refinements. Describe the requested outcome, not the steps taken, with checkable done-when checks that include important failure cases. Don't reword an intent that still fits, and don't record one for questions or exploration.
- For each piece of separate work found in this thread that isn't already suggested (a bug noticed outside the request, or an independent part of a larger request), call suggest_thread with what was found as context.
- If nothing needs recording, reply "No change."`;
}

export async function analyzeThread({
	model,
	instructions,
	tools,
	history,
	records,
	signal
}: {
	model: ModelClient;
	instructions: string;
	tools: ToolExecutor;
	history: Turn[];
	records: ThreadRecords;
	signal?: AbortSignal;
}) {
	const usage: Usage[] = [];
	for await (const event of runAgent({
		model,
		instructions,
		tools: {
			specs: tools.specs,
			execute: (call, signal) =>
				recordTools.includes(call.name)
					? tools.execute(call, signal)
					: Promise.reject(new Error(`${call.name} isn't available while recording`))
		},
		history: [...history, { role: 'user', text: analysisRequest(records) }],
		allowedTools: recordTools,
		maxSteps: 1,
		signal
	})) {
		if (event.type === 'step' && event.usage) usage.push(event.usage);
	}
	return { usage };
}

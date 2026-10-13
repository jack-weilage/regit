import type { InflightStep } from './types.ts';

// Calls whose effects live outside the sandbox: replaying them would repeat those effects.
const external = new Set([
	'update_intent',
	'record_done_when',
	'suggest_thread',
	'message_thread',
	'ask_threads'
]);

export const interruptedOutput =
	'Error: The sandbox stopped responding while this ran, so it may or may not have taken effect. Check before repeating it.';

// A rebuilt workspace is back at the checkpoint before the step, so its sandbox calls replay from the start.
// A surviving workspace keeps what finished; the call that was cut off isn't run blind a second time.
export function resumeStep(step: InflightStep, rebuilt: boolean): InflightStep {
	const names = new Map(step.reply.calls.map((call) => [call.id, call.name]));
	if (rebuilt) {
		const results = step.results.filter((result) => external.has(names.get(result.callId) ?? ''));
		return { ...step, results };
	}
	const done = new Set(step.results.map((result) => result.callId));
	const cut = step.reply.calls.find((call) => !done.has(call.id));
	if (!cut) return step;
	return { ...step, results: [...step.results, { callId: cut.id, output: interruptedOutput }] };
}

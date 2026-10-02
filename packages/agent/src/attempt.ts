import { runAgent, type AgentOptions, type AgentOutcome } from './loop.ts';
import type { CommitRequest, PushRequest } from './sandbox/protocol.ts';
import type { AgentEvent, Step, Turn } from './types.ts';

export interface Checkpoints {
	commit(request: CommitRequest): Promise<string | null>;
	push(request: PushRequest): Promise<void>;
}

export interface AttemptOptions extends AgentOptions {
	checkpoints: Checkpoints;
	author: CommitRequest['author'];
	push: PushRequest;
}

export type AttemptEvent =
	Exclude<AgentEvent, { type: 'step' }> | ({ type: 'step'; checkpoint?: string } & Step);

export async function* runAttempt({
	checkpoints,
	author,
	push,
	...agent
}: AttemptOptions): AsyncGenerator<AttemptEvent, AgentOutcome> {
	const run = runAgent(agent);
	try {
		let next = await run.next();
		while (!next.done) {
			const event = next.value;
			if (event.type === 'step' && event.turns.some((turn) => turn.role === 'tool')) {
				const sha = await checkpoints.commit({ message: checkpointMessage(event.turns), author });
				if (sha) await checkpoints.push(push);
				yield sha ? { ...event, checkpoint: sha } : event;
			} else {
				yield event;
			}
			next = await run.next();
		}
		return next.value;
	} finally {
		await run.return('aborted');
	}
}

// TODO: summarize checkpoint messages with a small model instead of reusing the agent's commentary
function checkpointMessage(turns: Turn[]) {
	const reply = turns.find((turn) => turn.role === 'assistant');
	const line = reply?.text.trim().split('\n')[0]?.trim();
	if (!line) return 'Checkpoint';
	return line.length > 72 ? `${line.slice(0, 71)}…` : line;
}

import type { Intent } from './intent.ts';
import { runAgent, type AgentOutcome } from './loop.ts';
import type { ModelClient, ToolExecutor, Usage } from './types.ts';

const instructions = `You resolve merge conflicts. The repository is in the middle of a rebase: a finished change is being replayed onto the latest base branch, and some files conflict.

- Edit only the conflicted files. Keep what both sides meant: the newer code on the base branch and the change described by the intent.
- Remove every conflict marker (<<<<<<<, =======, >>>>>>>).
- If the repository's checks are quick, run them to confirm the merged code still works.
- Never run git add, git commit, git rebase or git push; the rebase is finished for you.
- When you are done, reply with one sentence saying how you resolved the conflicts.`;

export interface ConflictOptions {
	model: ModelClient;
	tools: ToolExecutor;
	intent: Intent;
	base: string;
	files: string[];
	maxSteps?: number;
	signal?: AbortSignal;
}

export async function resolveConflicts({
	model,
	tools,
	intent,
	base,
	files,
	maxSteps = 40,
	signal
}: ConflictOptions): Promise<{ outcome: AgentOutcome; summary: string; usage: Usage[] }> {
	const usage: Usage[] = [];
	let summary = '';
	const task = `The change: ${intent.headline}\n\n${intent.purpose}\n\nIt conflicts with the latest ${base} in:\n${files.map((file) => `- ${file}`).join('\n')}`;

	const run = runAgent({
		model,
		tools,
		instructions,
		history: [{ role: 'user', text: task }],
		maxSteps,
		signal
	});
	let next = await run.next();
	while (!next.done) {
		if (next.value.type === 'step') {
			if (next.value.usage) usage.push(next.value.usage);
			for (const turn of next.value.turns) {
				if (turn.role === 'assistant' && turn.text) summary = turn.text;
			}
		}
		next = await run.next();
	}
	return { outcome: next.value, summary, usage };
}

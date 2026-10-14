import { intentParameters, type Intent } from './intent.ts';
import type { ToolExecutor } from './types.ts';

export interface Suggestion extends Intent {
	context: string;
}

const spec = {
	name: 'launch_thread',
	description:
		'Hand separate work to its own thread: something outside the current task, such as a bug you noticed, a follow-up, or one of several independent pieces of a larger request. Unless a person asked for a new thread, it is only suggested and they decide whether to start it. Never do that work yourself.',
	parameters: {
		...intentParameters,
		properties: {
			...intentParameters.properties,
			context: {
				type: 'string',
				description:
					'What the new thread needs to know: what you found, where (path:line) and why it matters'
			},
			start: {
				type: 'boolean',
				description:
					'true only when a person in this thread explicitly asked you to create or start a thread for this work: it starts working right away. Otherwise false, to suggest it.'
			}
		},
		required: [...intentParameters.required, 'context', 'start']
	}
};

export function launchTools(
	onLaunch: (suggestion: Suggestion, start: boolean) => Promise<string | null>
): ToolExecutor {
	return {
		specs: [spec],
		async execute(call) {
			const { headline, purpose, doneWhen, context, start } = JSON.parse(
				call.arguments
			) as Suggestion & { start?: boolean };
			const thread = await onLaunch(
				{
					headline: headline.trim(),
					purpose: purpose.trim(),
					doneWhen: (doneWhen ?? []).map((check) => check.trim()).filter(Boolean),
					context: (context ?? '').trim()
				},
				start === true
			);
			if (thread) return `Started thread ${thread}. It works on its own from here.`;
			if (start)
				return 'Suggested instead: only a person in this thread can ask you to start one. The person can start it as its own thread.';
			return 'Suggested. The person can start it as its own thread.';
		}
	};
}

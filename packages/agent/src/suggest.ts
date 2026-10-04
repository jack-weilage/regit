import { intentParameters, type Intent } from './intent.ts';
import type { ToolExecutor } from './types.ts';

export interface Suggestion extends Intent {
	context: string;
}

const spec = {
	name: 'suggest_thread',
	description:
		'Suggest separate work as its own thread: something outside the current task, such as a bug you noticed, a follow-up, or one of several independent pieces of a larger request. The person decides whether to spin it off. Never do the suggested work yourself.',
	parameters: {
		...intentParameters,
		properties: {
			...intentParameters.properties,
			context: {
				type: 'string',
				description:
					'What the new thread needs to know: what you found, where (path:line) and why it matters'
			}
		},
		required: [...intentParameters.required, 'context']
	}
};

export function suggestTools(
	onSuggest: (suggestion: Suggestion) => void | Promise<void>
): ToolExecutor {
	return {
		specs: [spec],
		async execute(call) {
			const { headline, purpose, doneWhen, context } = JSON.parse(call.arguments) as Suggestion;
			await onSuggest({
				headline: headline.trim(),
				purpose: purpose.trim(),
				doneWhen: (doneWhen ?? []).map((check) => check.trim()).filter(Boolean),
				context: (context ?? '').trim()
			});
			return 'Suggested. The person can spin it off into its own thread.';
		}
	};
}

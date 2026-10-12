import type { ToolExecutor, ToolSpec } from './types.ts';

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export const intentParameters = {
	type: 'object',
	properties: {
		headline: {
			type: 'string',
			description:
				'A conventional commit summary such as "fix(settings): load members lazily", at most 72 characters'
		},
		purpose: {
			type: 'string',
			description: 'One or two plain sentences on why the change matters'
		},
		doneWhen: {
			type: 'array',
			items: { type: 'string' },
			description: 'One to five concrete, checkable conditions that mean the work is finished'
		}
	},
	required: ['headline', 'purpose', 'doneWhen']
};

const spec: ToolSpec = {
	name: 'update_intent',
	description:
		"Record what this thread is doing: the change, why it matters and when it's done. Call it once the goal of the work is clear and again whenever it changes. People read it to follow the thread, and other agents use it to spot duplicate or overlapping work and to understand the changes later.",
	parameters: intentParameters
};

export function intentTools(onIntent: (intent: Intent) => void | Promise<void>): ToolExecutor {
	return {
		specs: [spec],
		async execute(call) {
			const { headline, purpose, doneWhen } = JSON.parse(call.arguments) as Intent;
			await onIntent({
				headline: headline.trim(),
				purpose: purpose.trim(),
				doneWhen: doneWhen.map((check) => check.trim()).filter(Boolean)
			});
			return 'Recorded the intent.';
		}
	};
}

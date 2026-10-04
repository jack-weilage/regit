import type { ToolExecutor, ToolSpec } from './types.ts';

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export interface ConversationMessage {
	author: string;
	text: string;
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

const specs: ToolSpec[] = [
	{
		name: 'propose_intent',
		description:
			'Propose the change this thread should make. The person reviews it and decides whether to start the work.',
		parameters: intentParameters
	},
	{
		name: 'update_intent',
		description:
			"Revise the thread's current intent after the person refines what they want. Replaces the whole intent.",
		parameters: intentParameters
	}
];

export function intentTools(
	onIntent: (intent: Intent) => void | Promise<void>,
	only?: ('propose_intent' | 'update_intent')[]
): ToolExecutor {
	return {
		specs: only ? specs.filter((spec) => only.includes(spec.name as 'update_intent')) : specs,
		async execute(call) {
			const { headline, purpose, doneWhen } = JSON.parse(call.arguments) as Intent;
			await onIntent({
				headline: headline.trim(),
				purpose: purpose.trim(),
				doneWhen: doneWhen.map((check) => check.trim()).filter(Boolean)
			});
			return call.name === 'propose_intent'
				? 'Proposed. The person can now start the work or ask for changes.'
				: 'Updated the intent.';
		}
	};
}

export function describeTask(intent: Intent, conversation: ConversationMessage[]) {
	const checks = intent.doneWhen.map((check) => `- ${check}`).join('\n');
	const context = conversation.map(({ author, text }) => `${author}: ${text}`).join('\n\n');
	return `${intent.headline}\n\n${intent.purpose}\n\nDone when:\n${checks}\n\nConversation:\n${context}`;
}

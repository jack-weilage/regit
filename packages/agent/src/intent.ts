import type { ModelClient, ToolSpec, Usage } from './types.ts';

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export interface ConversationMessage {
	author: string;
	text: string;
}

const instructions = `You turn a conversation about a change to a code repository into an intent for ReGit's coding agent.
- headline: a conventional commit summary such as "fix(settings): load members lazily", at most 72 characters.
- purpose: one or two plain sentences on why the change matters.
- doneWhen: one to five concrete, checkable conditions that mean the work is finished.
Later messages refine earlier ones. Call propose_intent exactly once.`;

const proposeIntent: ToolSpec = {
	name: 'propose_intent',
	description: 'Propose the intent for this thread',
	parameters: {
		type: 'object',
		properties: {
			headline: { type: 'string' },
			purpose: { type: 'string' },
			doneWhen: { type: 'array', items: { type: 'string' } }
		},
		required: ['headline', 'purpose', 'doneWhen']
	}
};

export async function draftIntent(
	model: ModelClient,
	conversation: ConversationMessage[],
	signal?: AbortSignal
) {
	const transcript = conversation.map(({ author, text }) => `${author}: ${text}`).join('\n\n');
	const stream = model.respond(
		{ instructions, history: [{ role: 'user', text: transcript }], tools: [proposeIntent] },
		signal
	);
	let intent: Intent | undefined;
	let usage: Usage | undefined;
	for await (const event of stream) {
		if (event.type === 'call' && event.call.name === proposeIntent.name && !intent) {
			const { headline, purpose, doneWhen } = JSON.parse(event.call.arguments) as Intent;
			intent = {
				headline: headline.trim(),
				purpose: purpose.trim(),
				doneWhen: doneWhen.map((check) => check.trim())
			};
		} else if (event.type === 'done') {
			usage = event.usage;
		}
	}
	if (!intent) throw new Error('The model did not propose an intent');
	return { intent, usage };
}

export function describeTask(intent: Intent, conversation: ConversationMessage[]) {
	const checks = intent.doneWhen.map((check) => `- ${check}`).join('\n');
	const context = conversation.map(({ author, text }) => `${author}: ${text}`).join('\n\n');
	return `${intent.headline}\n\n${intent.purpose}\n\nDone when:\n${checks}\n\nConversation:\n${context}`;
}

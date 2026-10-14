import type { ThreadStatus } from '@regit/core';
import type { ToolExecutor } from './types.ts';

export interface ThreadListing {
	id: string;
	number: number;
	headline: string;
	status: ThreadStatus;
}

export interface ThreadMessaging {
	list(): Promise<ThreadListing[]>;
	send(thread: string, text: string): Promise<string>;
}

const specs = [
	{
		name: 'list_threads',
		description:
			'List the other threads in this repository with their id, status and headline, to find one to message.',
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'message_thread',
		description:
			"Send a message to another thread's agent, for example when your change affects work it is doing or you need something from it. Be specific: say what changed, where (path:line) and what you need. Replies arrive as messages in this thread.",
		parameters: {
			type: 'object',
			properties: {
				thread: { type: 'string', description: 'The id of the thread, from list_threads' },
				text: { type: 'string' }
			},
			required: ['thread', 'text']
		}
	}
];

export function threadTools(messaging: ThreadMessaging): ToolExecutor {
	return {
		specs,
		async execute(call) {
			if (call.name === 'list_threads') {
				const threads = await messaging.list();
				if (!threads.length) return 'There are no other threads in this repository.';
				return threads
					.map(
						(thread) =>
							`#${thread.number} (${thread.id}) · ${thread.status} · ${thread.headline || 'New thread'}`
					)
					.join('\n');
			}
			const { thread, text } = JSON.parse(call.arguments) as { thread: string; text: string };
			if (!text?.trim()) throw new Error('The message is empty');
			return messaging.send(thread.trim(), text.trim());
		}
	};
}

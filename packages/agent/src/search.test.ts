import { expect, test } from 'vitest';
import { askThreads, askThreadsTools, type ThreadSource } from './search.ts';
import { scriptedModel } from './testing.ts';

const usage = { inputTokens: 100, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10 };
const call = (id: string, name: string, args: object) =>
	({ type: 'call', call: { id, name, arguments: JSON.stringify(args) } }) as const;

test('reads other threads with its tools and returns the answer and usage', async () => {
	const reads: string[] = [];
	const source: ThreadSource = {
		list: async () => [
			{ id: 'auth01', status: 'running', headline: 'fix(auth): refresh sessions' }
		],
		read: async (id) => {
			reads.push(id);
			return 'Intent: refresh expired sessions. Changed files: src/hooks.server.ts';
		},
		search: async () => 'No matches.',
		diff: async () => 'No changes.'
	};
	const { model, requests } = scriptedModel([
		[call('l', 'list_threads', {}), { type: 'done', usage }],
		[call('r', 'read_thread', { id: 'auth01' }), { type: 'done', usage }],
		[
			{ type: 'text', delta: 'auth01 changes src/hooks.server.ts.' },
			{ type: 'done', usage }
		]
	]);

	const result = await askThreads({ model, source, question: 'Who touches the middleware?' });

	expect(result).toEqual({
		answer: 'auth01 changes src/hooks.server.ts.',
		usage: [usage, usage, usage]
	});
	expect(reads).toEqual(['auth01']);
	expect(requests[0]!.tools.map((tool) => tool.name)).toEqual([
		'list_threads',
		'read_thread',
		'search_thread',
		'read_diff'
	]);
	expect(JSON.stringify(requests[2]!.history)).toContain('fix(auth): refresh sessions');
});

test('says when it found nothing, and the ask tool passes the thread along', async () => {
	const { model } = scriptedModel([[{ type: 'done', usage }]]);
	const source: ThreadSource = {
		list: async () => [],
		read: async () => '',
		search: async () => '',
		diff: async () => ''
	};
	expect((await askThreads({ model, source, question: 'Anything?' })).answer).toBe(
		"I couldn't find an answer in the other threads."
	);

	const asked: string[] = [];
	const tools = askThreadsTools(async (question) => {
		asked.push(question);
		return 'An answer.';
	});
	expect(tools.specs.map((spec) => spec.name)).toEqual(['ask_threads']);
	expect(
		await tools.execute({
			id: 'a',
			name: 'ask_threads',
			arguments: JSON.stringify({ question: ' What changed? ', thread: 'auth01' })
		})
	).toBe('An answer.');
	expect(asked).toEqual(['What changed? (thread auth01)']);
});

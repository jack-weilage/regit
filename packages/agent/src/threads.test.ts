import { expect, test } from 'bun:test';
import { threadTools } from './threads.ts';

test('lists the other threads and messages one of them', async () => {
	const sent: unknown[] = [];
	const tools = threadTools({
		list: async () => [
			{
				id: 'abc123',
				number: 42,
				headline: 'feat(api): rename user id',
				status: 'working' as const
			},
			{ id: 'def456', number: 7, headline: '', status: 'idle' as const }
		],
		send: async (thread, text) => {
			sent.push({ thread, text });
			return 'Delivered.';
		}
	});
	expect(tools.specs.map((spec) => spec.name)).toEqual(['list_threads', 'message_thread']);

	expect(await tools.execute({ id: 'l', name: 'list_threads', arguments: '{}' })).toBe(
		'#42 (abc123) · working · feat(api): rename user id\n#7 (def456) · idle · New thread'
	);
	expect(
		await tools.execute({
			id: 'm',
			name: 'message_thread',
			arguments: JSON.stringify({ thread: ' abc123 ', text: ' The field is now accountId. ' })
		})
	).toBe('Delivered.');
	expect(sent).toEqual([{ thread: 'abc123', text: 'The field is now accountId.' }]);
});

test('says when there are no other threads and refuses empty messages', async () => {
	const tools = threadTools({ list: async () => [], send: async () => 'Delivered.' });
	expect(await tools.execute({ id: 'l', name: 'list_threads', arguments: '{}' })).toBe(
		'There are no other threads in this repository.'
	);
	await expect(
		tools.execute({
			id: 'm',
			name: 'message_thread',
			arguments: JSON.stringify({ thread: 'abc123', text: ' ' })
		})
	).rejects.toThrow('The message is empty');
});

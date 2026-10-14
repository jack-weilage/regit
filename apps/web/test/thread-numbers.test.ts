import { expect, test } from 'vitest';
import type { ThreadSummary, ToolCallRecord } from '@regit/core';
import { toolView } from '../src/lib/activity.ts';
import { similarThreads } from '../src/lib/similar.ts';

const thread: ThreadSummary = {
	id: 'abcdef012345',
	number: 42,
	headline: 'fix(settings): load members lazily',
	status: 'running',
	mode: 'small',
	auto: false,
	machine: 'standard-1',
	updatedAt: 100,
	deleted: null,
	parent: null,
	changes: null,
	shipped: null,
	failure: null,
	behind: null,
	checks: null
};

test('similar thread mentions display a number but preserve internal handles and use numeric links', () => {
	expect(
		similarThreads(
			'demo',
			[
				{ thread: thread.id, relation: 'overlap', probability: 0.9 },
				{ thread: 'missing', relation: 'related', probability: 0.8 }
			],
			[thread]
		)
	).toEqual([
		{
			kind: 'thread',
			handle: thread.id,
			number: 42,
			label: thread.headline,
			href: '/demo/42',
			relation: 'overlap',
			status: 'running'
		}
	]);
});

test('thread messaging tool targets display numbers without rewriting unrelated tool targets', () => {
	const call: ToolCallRecord = {
		id: 'call',
		tool: 'message_thread',
		target: thread.id,
		status: 'done',
		startedAt: 100
	};
	expect(toolView(call, [thread])).toMatchObject({ target: '#42', verb: 'Messaged thread' });
	expect(call.target).toBe(thread.id);
	expect(toolView(call, []).target).toBe('Unavailable thread');
	expect(toolView({ ...call, tool: 'read_file' }, [thread]).target).toBe(thread.id);
});

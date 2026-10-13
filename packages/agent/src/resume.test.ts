import { describe, expect, test } from 'bun:test';
import { runAgent } from './loop.ts';
import { interruptedOutput, resumeStep } from './resume.ts';
import { fakeTools, scriptedModel } from './testing.ts';
import type { InflightStep } from './types.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
const step: InflightStep = {
	reply: {
		role: 'assistant',
		text: 'Fixing it',
		calls: [
			{ id: 'c1', name: 'update_intent', arguments: '{}' },
			{ id: 'c2', name: 'write_file', arguments: '{"path":"a.ts"}' },
			{ id: 'c3', name: 'run', arguments: '{"command":"bun test"}' },
			{ id: 'c4', name: 'read_file', arguments: '{"path":"b.ts"}' }
		]
	},
	usage,
	results: [
		{ callId: 'c1', output: 'Intent updated' },
		{ callId: 'c2', output: 'Wrote a.ts' }
	]
};

describe('resumeStep', () => {
	test('keeps finished calls and marks the one that was cut off when the workspace survived', () => {
		expect(resumeStep(step, false).results).toEqual([
			{ callId: 'c1', output: 'Intent updated' },
			{ callId: 'c2', output: 'Wrote a.ts' },
			{ callId: 'c3', output: interruptedOutput }
		]);
	});

	test('replays sandbox calls but never external ones when the workspace was rebuilt', () => {
		expect(resumeStep(step, true).results).toEqual([{ callId: 'c1', output: 'Intent updated' }]);
	});
});

describe('runAgent resuming a step', () => {
	test('runs only the calls without a result, then asks the model as usual', async () => {
		const { model, requests } = scriptedModel([[{ type: 'done', usage }]]);
		const { tools, calls } = fakeTools({
			update_intent: () => 'again',
			write_file: () => 'Wrote a.ts again',
			run: () => 'ran',
			read_file: () => 'contents'
		});
		const events = await Array.fromAsync(
			runAgent({ model, tools, instructions: '', history: [], resume: resumeStep(step, true) })
		);

		expect(calls.map((call) => call.id)).toEqual(['c2', 'c3', 'c4']);
		expect(requests).toHaveLength(1);
		expect(requests[0]!.history).toEqual([
			step.reply,
			{
				role: 'tool',
				results: [
					{ callId: 'c1', output: 'Intent updated' },
					{ callId: 'c2', output: 'Wrote a.ts again' },
					{ callId: 'c3', output: 'ran' },
					{ callId: 'c4', output: 'contents' }
				]
			}
		]);
		expect(events.find((event) => event.type === 'step')).toMatchObject({ usage });
	});
});

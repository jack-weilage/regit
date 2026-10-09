import { expect, test } from 'vitest';
import { reviewFeedback, reviewIntent } from './review.ts';
import { verificationSkill } from './skills.ts';
import { fakeTools, scriptedModel } from './testing.ts';

const usage = { inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 5 };
const intent = {
	headline: 'perf(settings): load members lazily',
	purpose: 'Settings load slowly.',
	doneWhen: ['Settings render in under a second', 'Members load as you scroll']
};
const submit = (review: object) =>
	({
		type: 'call',
		call: { id: 'r1', name: 'submit_review', arguments: JSON.stringify(review) }
	}) as const;

test('reviews the work with read-only tools and stops once the review is submitted', async () => {
	const { model, requests } = scriptedModel([
		[
			{ type: 'call', call: { id: 'c1', name: 'run', arguments: '{"command":"git diff abc"}' } },
			{ type: 'done', usage }
		],
		[
			submit({
				checks: [
					{ state: 'met', evidence: 'Benchmark shows 180ms' },
					{ state: 'unmet', evidence: 'No scroll handler' }
				],
				findings: ['Scrolling never loads the next page.'],
				verdict: 'fail'
			}),
			{ type: 'done', usage }
		]
	]);
	const { tools, calls } = fakeTools({ run: () => 'exit code 0\ndiff' });

	const { review, usage: spent } = await reviewIntent({
		model,
		tools,
		intent,
		base: 'abc',
		summary: 'Paged the members.'
	});

	expect(review).toEqual({
		verdict: 'fail',
		checks: [
			{ state: 'met', evidence: 'Benchmark shows 180ms' },
			{ state: 'unmet', evidence: 'No scroll handler' }
		],
		findings: ['Scrolling never loads the next page.']
	});
	expect(requests).toHaveLength(2);
	expect(spent).toHaveLength(2);
	expect(calls.map((call) => call.name)).toEqual(['run']);
	expect(requests[0]!.history[0]).toMatchObject({ role: 'user' });
	expect((requests[0]!.history[0] as { text: string }).text).toContain(
		'The work started from commit abc'
	);
	expect(requests[0]!.tools.map((tool) => tool.name)).toEqual(['run', 'submit_review']);
});

test('never passes work with unmet or unchecked items', async () => {
	const review = async (checks: object[]) => {
		const { model } = scriptedModel([[submit({ checks, findings: [], verdict: 'pass' })]]);
		return (
			await reviewIntent({ model, tools: fakeTools({}).tools, intent, base: null, summary: '' })
		).review.verdict;
	};
	expect(await review([{ state: 'met' }, { state: 'unmet' }])).toBe('fail');
	expect(await review([{ state: 'met' }])).toBe('needs-human');
	expect(await review([{ state: 'met' }, { state: 'met' }])).toBe('pass');
});

test('fails when the reviewer never submits', async () => {
	const { model } = scriptedModel([[{ type: 'text', delta: 'Looks fine.' }]]);
	await expect(
		reviewIntent({ model, tools: fakeTools({}).tools, intent, base: null, summary: '' })
	).rejects.toThrow('did not submit a review');
});

test('gives reviewers repository context and loads verification instructions on demand', async () => {
	const { model, requests } = scriptedModel([
		[
			{
				type: 'call',
				call: { id: 'skill', name: 'load_skill', arguments: '{"name":"verifying-changes"}' }
			}
		],
		[
			submit({
				checks: intent.doneWhen.map(() => ({
					state: 'unverified',
					evidence: 'No conclusive measurement available.'
				})),
				findings: [],
				verdict: 'needs-human'
			})
		]
	]);
	const { review } = await reviewIntent({
		model,
		tools: fakeTools({}).tools,
		intent,
		base: 'abc',
		summary: '',
		guidance: 'Repository guidance: AGENTS.md\nUse bun test.',
		skills: [verificationSkill]
	});
	expect(requests[0]!.instructions).toContain('Use bun test.');
	expect(requests[0]!.instructions).not.toContain(verificationSkill.body);
	expect(JSON.stringify(requests[1]!.history)).toContain(
		'Derive expected results from the contract'
	);
	expect(review.verdict).toBe('needs-human');
});

test('turns a review into feedback for the coding agent', () => {
	const feedback = reviewFeedback(intent, {
		verdict: 'fail',
		checks: [
			{ state: 'met', evidence: 'ok' },
			{ state: 'unmet', evidence: 'No scroll handler' }
		],
		findings: ['Scrolling never loads the next page.']
	});
	expect(feedback).toContain('- [met] Settings render in under a second\n');
	expect(feedback).toContain('- [not met] Members load as you scroll: No scroll handler');
	expect(feedback).toContain('Findings:\n- Scrolling never loads the next page.');
});

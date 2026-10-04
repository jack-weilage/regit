import { expect, test } from 'vitest';
import { findSimilar, type JevRequest } from './similar.ts';

const candidates = [
	{
		id: 'members',
		headline: 'perf(settings): load org members in pages',
		purpose: 'Big orgs wait.'
	},
	{ id: 'rename', headline: 'feat(api): rename user id to account id' },
	{ id: 'cache', headline: 'Cache org settings' },
	{ id: 'docs', headline: 'docs: add a contributing guide' }
];

const answer = (same: number, overlap: number, related: number) => ({
	type: 'choice',
	probabilities: { same, overlap, related, unrelated: 1 - same - overlap - related }
});

test('asks how the intent relates to each thread and keeps the meaningful matches', async () => {
	const requests: JevRequest[] = [];
	const matches = await findSimilar(
		async (request) => {
			requests.push(request);
			return {
				answers: {
					t1: answer(0.93, 0.06, 0.01),
					t2: answer(0.41, 0.53, 0.06),
					t3: answer(0, 0.16, 0.57),
					t4: answer(0, 0, 0.07)
				}
			};
		},
		'Page org members on the settings page',
		candidates
	);

	expect(matches).toEqual([
		{ thread: 'members', relation: 'same', probability: 0.93 },
		{ thread: 'rename', relation: 'overlap', probability: 0.94 },
		{ thread: 'cache', relation: 'related', probability: 0.73 }
	]);
	expect(requests[0]!.state).toEqual({
		new_intent: 'Page org members on the settings page',
		threads: {
			t1: 'perf(settings): load org members in pages — Big orgs wait.',
			t2: 'feat(api): rename user id to account id',
			t3: 'Cache org settings',
			t4: 'docs: add a contributing guide'
		}
	});
	expect(Object.keys(requests[0]!.questions)).toEqual(['t1', 't2', 't3', 't4']);
});

test('treats a likely but uncertain same goal as an overlap', async () => {
	const matches = await findSimilar(
		async () => ({ answers: { t1: answer(0.62, 0.1, 0.2) } }),
		'Page members',
		candidates.slice(0, 1)
	);
	expect(matches).toEqual([{ thread: 'members', relation: 'overlap', probability: 0.72 }]);
});

test('skips the call when there is nothing to compare', async () => {
	const decide = async () => {
		throw new Error('should not be called');
	};
	expect(await findSimilar(decide, 'Page members', [])).toEqual([]);
	expect(await findSimilar(decide, '  ', candidates)).toEqual([]);
});

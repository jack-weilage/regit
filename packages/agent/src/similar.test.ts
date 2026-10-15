import { expect, test } from 'bun:test';
import { assessRequest, type JevRequest } from './similar.ts';

const candidates = [
	{
		id: 'members',
		headline: 'perf(settings): load org members in pages',
		purpose: 'Big orgs wait.',
		doneWhen: ['Members load 50 at a time', 'Scrolling loads the next page']
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
	const { similar, size } = await assessRequest(
		async (request) => {
			requests.push(request);
			return {
				answers: {
					size: { probabilities: { small: 0.1, medium: 0.2, large: 0.7 } },
					t1: answer(0.93, 0.06, 0.01),
					t2: answer(0.41, 0.53, 0.06),
					t3: answer(0, 0.16, 0.67),
					t4: answer(0, 0, 0.07)
				}
			};
		},
		'Page org members on the settings page',
		candidates
	);

	expect(size).toBe('large');
	expect(similar).toEqual([
		{ thread: 'members', relation: 'same', probability: 0.93 },
		{ thread: 'rename', relation: 'overlap', probability: 0.94 },
		{ thread: 'cache', relation: 'related', probability: 0.83 }
	]);
	expect(requests[0]!.state).toEqual({
		new_intent: 'Page org members on the settings page',
		threads: {
			t1: 'perf(settings): load org members in pages — Big orgs wait. Done when: Members load 50 at a time; Scrolling loads the next page',
			t2: 'feat(api): rename user id to account id',
			t3: 'Cache org settings',
			t4: 'docs: add a contributing guide'
		}
	});
	expect(Object.keys(requests[0]!.questions)).toEqual(['size', 't1', 't2', 't3', 't4']);
});

test('treats a likely but uncertain same goal as an overlap', async () => {
	const { similar, size } = await assessRequest(
		async () => ({ answers: { t1: answer(0.62, 0.1, 0.2) } }),
		'Page members',
		candidates.slice(0, 1)
	);
	expect(similar).toEqual([{ thread: 'members', relation: 'overlap', probability: 0.72 }]);
	expect(size).toBe('medium');
});

const numbered = (count: number) =>
	Array.from({ length: count }, (_, index) => ({
		id: `thread${index + 1}`,
		headline: `Thread ${index + 1}`
	}));

test('caps the list at five matches, strongest relations first', async () => {
	const { similar } = await assessRequest(
		async () => ({
			answers: {
				t1: answer(0, 0.1, 0.6),
				t2: answer(0, 0.1, 0.8),
				t3: answer(0, 0.1, 0.85),
				t4: answer(0, 0.1, 0.75),
				t5: answer(0, 0.7, 0.2),
				t6: answer(0.1, 0.6, 0.2),
				t7: answer(0, 0.55, 0.3),
				t8: answer(0, 0.5, 0.3),
				t9: answer(0.9, 0.05, 0.05),
				t10: answer(0, 0.2, 0.5)
			}
		}),
		'A long request touching many areas',
		numbered(10)
	);
	expect(similar).toEqual([
		{ thread: 'thread9', relation: 'same', probability: 0.9 },
		{ thread: 'thread5', relation: 'overlap', probability: 0.7 },
		{ thread: 'thread6', relation: 'overlap', probability: 0.7 },
		{ thread: 'thread7', relation: 'overlap', probability: 0.55 },
		{ thread: 'thread8', relation: 'overlap', probability: 0.5 }
	]);
});

test('shows at most two clearly related threads', async () => {
	const { similar } = await assessRequest(
		async () => ({
			answers: {
				t1: answer(0, 0.1, 0.8),
				t2: answer(0, 0.1, 0.85),
				t3: answer(0, 0.1, 0.75),
				t4: answer(0, 0.1, 0.65)
			}
		}),
		'Something nearby',
		numbered(4)
	);
	expect(similar).toEqual([
		{ thread: 'thread2', relation: 'related', probability: 0.95 },
		{ thread: 'thread1', relation: 'related', probability: 0.9 }
	]);
});

test('shows archived or stale threads only when definitely related', async () => {
	const { similar } = await assessRequest(
		async () => ({
			answers: {
				t1: answer(0.85, 0.1, 0.05),
				t2: answer(0.3, 0.55, 0.1),
				t3: answer(0.1, 0.6, 0.2),
				t4: answer(0, 0.1, 0.9)
			}
		}),
		'Page org members on the settings page',
		candidates.map((candidate) => ({ ...candidate, inactive: true }))
	);
	expect(similar).toEqual([
		{ thread: 'members', relation: 'same', probability: 0.85 },
		{ thread: 'rename', relation: 'overlap', probability: 0.85 }
	]);
});

test('sizes a request even with no other threads, and skips empty requests', async () => {
	const requests: JevRequest[] = [];
	const decide = async (request: JevRequest) => {
		requests.push(request);
		return { answers: { size: { probabilities: { small: 0.8, medium: 0.15, large: 0.05 } } } };
	};
	expect(await assessRequest(decide, 'Fix a typo in the README', [])).toEqual({
		similar: [],
		size: 'small'
	});
	expect(Object.keys(requests[0]!.questions)).toEqual(['size']);
	expect(await assessRequest(decide, '  ', candidates)).toEqual({ similar: [], size: 'medium' });
	expect(requests).toHaveLength(1);
});

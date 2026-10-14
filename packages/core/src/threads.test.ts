import { expect, test } from 'bun:test';
import { needsYou, type ThreadSummary } from './threads.ts';

const quiet: Pick<ThreadSummary, 'status' | 'failure' | 'changes' | 'behind'> = {
	status: 'idle',
	failure: null,
	changes: { files: 0, additions: 0, deletions: 0 },
	behind: null
};
const behind = { branch: 'main', commits: 1, sha: 'abc', headline: 'Better notes' };

test('flags idle threads with a failure, changes, a conflict or unmet checks', () => {
	expect(needsYou(quiet, 0)).toBe(false);
	expect(needsYou({ ...quiet, changes: null }, 0)).toBe(false);
	expect(needsYou({ ...quiet, behind: { ...behind, conflicts: [] } }, 0)).toBe(false);
	expect(
		needsYou({ ...quiet, failure: { at: 1, title: 'Stopped', error: 'x', resumable: true } }, 0)
	).toBe(true);
	expect(needsYou({ ...quiet, changes: { files: 1, additions: 1, deletions: 0 } }, 0)).toBe(true);
	expect(needsYou({ ...quiet, behind: { ...behind, conflicts: ['notes.md'] } }, 0)).toBe(true);
	expect(needsYou(quiet, 1)).toBe(true);
});

test('never flags threads that are not idle', () => {
	const flagged = { ...quiet, changes: { files: 1, additions: 1, deletions: 0 } };
	for (const status of ['working', 'shipping', 'shipped', 'archived'] as const)
		expect(needsYou({ ...flagged, status }, 1)).toBe(false);
});

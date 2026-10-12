import { expect, test } from 'vitest';
import { canonicalPush } from '../src/landing.ts';

// Shaped like the event a Workflow receives, captured from a live push.
const push = (repoName: string, ref = 'refs/heads/main', after = 'b'.repeat(40)) => ({
	id: '087e052d-165b-4431-a01a-226039d4ed63',
	type: 'cf.artifacts.repo.pushed',
	source: { namespace: 'regit', repoName },
	payload: {
		ref,
		before: 'a'.repeat(40),
		after,
		commits: [
			{
				id: 'b'.repeat(40),
				message: 'docs: add a title\n\nReaders need one.',
				messageTruncated: false,
				timestamp: '2026-10-12T21:53:35.000Z',
				author: { name: 'Sam', email: 'sam@example.com' },
				committer: { name: 'Sam', email: 'sam@example.com' },
				parents: ['c'.repeat(40)]
			},
			{ id: 'c'.repeat(40), message: 'Earlier change', parents: ['a'.repeat(40)] }
		],
		totalCommitsCount: 2,
		commitsTruncated: false
	}
});

test('turns a push to a canonical branch into a landing', () => {
	expect(canonicalPush(push('notes'))).toEqual({
		repo: 'notes',
		ref: 'refs/heads/main',
		after: 'b'.repeat(40),
		headline: 'docs: add a title'
	});
});

test('ignores thread and candidate forks, tags, deleted branches and other events', () => {
	expect(canonicalPush(push('notes--3f2a9c1b7d4e'))).toBeNull();
	expect(canonicalPush(push('notes--candidate-1'))).toBeNull();
	expect(canonicalPush(push('notes', 'refs/tags/v1'))).toBeNull();
	expect(canonicalPush(push('notes', 'refs/heads/main', '0'.repeat(40)))).toBeNull();
	expect(canonicalPush({ ...push('notes'), type: 'cf.artifacts.repo.fetched' })).toBeNull();
});

test('fails loudly on an event shape it does not recognise', () => {
	expect(() => canonicalPush({ payload: push('notes') })).toThrow(
		/Unrecognised Artifacts event: \{"payload":\{"id":"087e052d/
	);
});

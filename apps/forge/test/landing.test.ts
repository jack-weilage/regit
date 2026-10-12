import { expect, test } from 'vitest';
import { canonicalPush, type ArtifactsPush } from '../src/landing.ts';

const push = (repoName: string, ref = 'refs/heads/main'): ArtifactsPush => ({
	type: 'cf.artifacts.repo.pushed',
	source: { namespace: 'regit', repoName },
	payload: {
		ref,
		before: 'a'.repeat(40),
		after: 'b'.repeat(40),
		commits: [
			{ id: 'c'.repeat(40), message: 'Earlier change' },
			{ id: 'b'.repeat(40), message: 'docs: add a title\n\nReaders need one.' }
		]
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

test('ignores thread and candidate forks, tags and other events', () => {
	expect(canonicalPush(push('notes--3f2a9c1b7d4e'))).toBeNull();
	expect(canonicalPush(push('notes--candidate-1'))).toBeNull();
	expect(canonicalPush(push('notes', 'refs/tags/v1'))).toBeNull();
	expect(canonicalPush({ ...push('notes'), type: 'cf.artifacts.repo.fetched' })).toBeNull();
});

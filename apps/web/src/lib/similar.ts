import type { SimilarMatch, ThreadSummary } from '@regit/core';
import type { SimilarThread } from '@regit/ui';

export function similarThreads(
	repo: string,
	matches: SimilarMatch[],
	threads: ThreadSummary[]
): SimilarThread[] {
	return matches.flatMap((match) => {
		const thread = threads.find((thread) => thread.id === match.thread);
		if (!thread) return [];
		const sha = thread.status === 'shipped' ? thread.shipped?.sha : undefined;
		return [
			{
				kind: 'thread',
				handle: thread.id,
				label: thread.headline || 'New thread',
				href: `/${repo}/${thread.id}`,
				relation: match.relation,
				status: thread.status,
				...(sha && { detail: `Shipped in ${sha.slice(0, 7)}` })
			}
		];
	});
}

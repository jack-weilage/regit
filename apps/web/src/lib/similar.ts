import type { SimilarMatch, ThreadSummary } from '@regit/core';

export function similarThreads(repo: string, matches: SimilarMatch[], threads: ThreadSummary[]) {
	return matches.flatMap((match) => {
		const thread = threads.find((thread) => thread.id === match.thread);
		if (!thread) return [];
		const sha = thread.status === 'shipped' ? thread.shipped?.sha : undefined;
		return [
			{
				kind: 'thread' as const,
				handle: thread.id,
				number: thread.number,
				label: thread.headline || 'New thread',
				href: `/${repo}/${thread.number}`,
				relation: match.relation,
				status: thread.status,
				...(sha && { detail: `Shipped in ${sha.slice(0, 7)}` })
			}
		];
	});
}

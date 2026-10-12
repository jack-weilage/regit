export interface ArtifactsPush {
	id: string;
	type: string;
	source: { namespace: string; repoName: string };
	payload: {
		ref: string;
		before: string;
		after: string;
		commits: { id: string; message: string }[];
		totalCommitsCount: number;
		commitsTruncated: boolean;
	};
}

export interface Landing {
	repo: string;
	ref: string;
	after: string;
	headline: string;
}

// Thread and candidate forks share the namespace; their names always contain a double hyphen.
export function canonicalPush(event: unknown): Landing | null {
	const { type, source, payload } = (event ?? {}) as Partial<ArtifactsPush>;
	if (
		typeof source?.repoName !== 'string' ||
		typeof payload?.ref !== 'string' ||
		typeof payload.after !== 'string'
	)
		throw new Error(`Unrecognised Artifacts event: ${JSON.stringify(event).slice(0, 1000)}`);
	if (type !== 'cf.artifacts.repo.pushed' || source.repoName.includes('--')) return null;
	if (!payload.ref.startsWith('refs/heads/') || /^0+$/.test(payload.after)) return null;
	const head = payload.commits.find((commit) => commit.id === payload.after);
	const headline = head?.message.split('\n')[0]?.trim() ?? '';
	return { repo: source.repoName, ref: payload.ref, after: payload.after, headline };
}

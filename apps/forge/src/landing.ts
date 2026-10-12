export interface ArtifactsPush {
	type: string;
	source: { namespace: string; repoName: string };
	payload: {
		ref: string;
		before: string;
		after: string;
		commits: { id: string; message: string }[];
	};
}

export interface Landing {
	repo: string;
	ref: string;
	after: string;
	headline: string;
}

// Thread and candidate forks share the namespace; their names always contain a double hyphen.
export function canonicalPush({ type, source, payload }: ArtifactsPush): Landing | null {
	if (type !== 'cf.artifacts.repo.pushed' || source.repoName.includes('--')) return null;
	if (!payload.ref.startsWith('refs/heads/')) return null;
	const last = payload.commits.at(-1)?.message.split('\n')[0]?.trim() ?? '';
	return { repo: source.repoName, ref: payload.ref, after: payload.after, headline: last };
}

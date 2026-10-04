import type { SimilarMatch } from '@regit/core';

export type { SimilarMatch };

export interface JevRequest {
	state: unknown;
	questions: Record<
		string,
		{ type: 'choice'; instructions: string; criteria: Record<string, string> }
	>;
}

export interface JevResponse {
	answers: Record<string, { probabilities?: Record<string, number> } | undefined>;
}

export type Decide = (request: JevRequest) => Promise<JevResponse>;

export interface SimilarCandidate {
	id: string;
	headline: string;
	purpose?: string;
}

export const maxSimilarCandidates = 40;

const relations = {
	same: 'Same goal; doing both would duplicate work',
	overlap: 'Different goals that change the same code or behavior',
	related: 'Same area, but independent work',
	unrelated: 'Unrelated'
};

const order = ['same', 'overlap', 'related'];
const round = (value: number) => Math.round(value * 100) / 100;

export async function findSimilar(
	decide: Decide,
	text: string,
	candidates: SimilarCandidate[]
): Promise<SimilarMatch[]> {
	const shortlist = candidates.slice(0, maxSimilarCandidates);
	if (!text.trim() || !shortlist.length) return [];
	const keys = shortlist.map((_, index) => `t${index + 1}`);
	const threads = Object.fromEntries(
		shortlist.map((candidate, index) => [
			keys[index],
			candidate.purpose ? `${candidate.headline} — ${candidate.purpose}` : candidate.headline
		])
	);
	const { answers } = await decide({
		state: { new_intent: text.trim(), threads },
		questions: Object.fromEntries(
			keys.map((key) => [
				key,
				{
					type: 'choice' as const,
					instructions: `How does \`new_intent\` relate to \`threads.${key}\`?`,
					criteria: relations
				}
			])
		)
	});

	return shortlist
		.flatMap((candidate, index): SimilarMatch[] => {
			const { same = 0, overlap = 0, related = 0 } = answers[keys[index]!]?.probabilities ?? {};
			if (same >= 0.8)
				return [{ thread: candidate.id, relation: 'same', probability: round(same) }];
			if (same + overlap >= 0.5) {
				return [{ thread: candidate.id, relation: 'overlap', probability: round(same + overlap) }];
			}
			if (same + overlap + related >= 0.5) {
				return [
					{
						thread: candidate.id,
						relation: 'related',
						probability: round(same + overlap + related)
					}
				];
			}
			return [];
		})
		.sort(
			(a, b) =>
				order.indexOf(a.relation) - order.indexOf(b.relation) || b.probability - a.probability
		);
}

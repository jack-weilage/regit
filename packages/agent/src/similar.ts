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
	doneWhen?: string[];
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

const sizes = {
	small: 'A quick, contained change: copy or config, a one-file fix, or a question about the code',
	medium: 'A typical feature or bug fix across a few files',
	large:
		'Broad or tricky work: refactors across many files, migrations, architecture, or debugging an unclear problem'
};

export type Size = keyof typeof sizes;

export interface Assessment {
	similar: SimilarMatch[];
	size: Size;
}

export async function assessRequest(
	decide: Decide,
	text: string,
	candidates: SimilarCandidate[]
): Promise<Assessment> {
	if (!text.trim()) return { similar: [], size: 'medium' };
	const shortlist = candidates.slice(0, maxSimilarCandidates);
	const keys = shortlist.map((_, index) => `t${index + 1}`);
	const threads = Object.fromEntries(
		shortlist.map((candidate, index) => [keys[index], describeCandidate(candidate)])
	);
	const { answers } = await decide({
		state: { new_intent: text.trim(), threads },
		questions: {
			size: {
				type: 'choice',
				instructions: 'How much work would it take a coding agent to do `new_intent` well?',
				criteria: sizes
			},
			...Object.fromEntries(
				keys.map((key) => [
					key,
					{
						type: 'choice' as const,
						instructions: `How does \`new_intent\` relate to \`threads.${key}\`?`,
						criteria: relations
					}
				])
			)
		}
	});

	const similar = shortlist
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
	return { similar, size: likeliest(answers.size?.probabilities) };
}

function describeCandidate({ headline, purpose, doneWhen = [] }: SimilarCandidate) {
	const checks = doneWhen.length ? ` Done when: ${doneWhen.join('; ')}` : '';
	return `${purpose ? `${headline} — ${purpose}` : headline}${checks}`;
}

function likeliest(probabilities: Record<string, number> = {}): Size {
	const [best] = Object.entries(probabilities)
		.filter((entry): entry is [Size, number] => entry[0] in sizes)
		.sort((a, b) => b[1] - a[1]);
	return best?.[0] ?? 'medium';
}

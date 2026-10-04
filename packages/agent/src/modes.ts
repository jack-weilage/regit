import type { ReasoningEffort } from './openai/client.ts';

export type Mode = 'small' | 'medium' | 'large';

// TODO: choose dedicated models per mode and per task (search, review) once we have evals, and review with a different model family
export const modes: Record<Mode, { model: string; effort: ReasoningEffort }> = {
	small: { model: 'gpt-6-luna', effort: 'medium' },
	medium: { model: 'gpt-6.1-sol', effort: 'medium' },
	large: { model: 'gpt-6.1-sol', effort: 'high' }
};

export const searcher: { model: string; effort: ReasoningEffort } = {
	model: 'gpt-6-luna',
	effort: 'low'
};

export const reviewers: Record<Mode, { model: string; effort: ReasoningEffort }> = {
	small: { model: 'gpt-6.1-sol', effort: 'medium' },
	medium: { model: 'gpt-6.1-sol', effort: 'high' },
	large: { model: 'gpt-6.1-sol', effort: 'high' }
};

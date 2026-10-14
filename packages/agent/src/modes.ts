import { anthropicModel } from './anthropic/client.ts';
import type { Gateway, Metadata } from './gateway.ts';
import { openaiModel } from './openai/client.ts';
import { models } from './pricing.ts';
import type { ModelClient } from './types.ts';

export type Mode = 'small' | 'medium' | 'large';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh';

export interface ModelChoice {
	model: string;
	effort: Effort;
}

// A thread keeps the model its mode had when it started.
// TODO: choose dedicated models per mode and per task once we have evals
export const modes: Record<Mode, ModelChoice> = {
	small: { model: 'gpt-6-luna', effort: 'medium' },
	medium: { model: 'claude-opus-5-5', effort: 'medium' },
	large: { model: 'gpt-6.1-sol', effort: 'high' }
};

export const searcher: ModelChoice = { model: 'gpt-6-luna', effort: 'low' };

export interface ModelOptions extends ModelChoice {
	gateway: Gateway;
	sessionId: string;
	metadata?: Metadata;
	maxRetries?: number;
	compactThreshold?: number;
	resolveImage?: (url: string) => Promise<string>;
}

export function modelClient(options: ModelOptions): ModelClient {
	return models[options.model]?.provider === 'anthropic'
		? anthropicModel(options)
		: openaiModel(options);
}

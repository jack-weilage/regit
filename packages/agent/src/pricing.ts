import type { Usage } from './types.ts';

interface Rates {
	input: number;
	cachedInput: number;
	cacheWrite: number;
	output: number;
}

export type Provider = 'openai' | 'anthropic';

export interface ModelInfo {
	provider: Provider;
	contextWindow: number;
	perMillion: Rates;
	// Prompts longer than this are billed at the long-context rates.
	longContext?: { from: number; perMillion: Rates };
}

// Standard-tier USD prices from https://developers.openai.com/api/docs/pricing (checked 2026-10-03)
// and https://platform.claude.com/docs/en/about-claude/pricing (checked 2026-10-14; 5-minute cache writes)
export const models: Record<string, ModelInfo> = {
	'gpt-6-luna': {
		provider: 'openai',
		contextWindow: 1_050_000,
		perMillion: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
		longContext: {
			from: 272_000,
			perMillion: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 }
		}
	},
	'gpt-6.1-sol': {
		provider: 'openai',
		contextWindow: 1_050_000,
		perMillion: { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
		longContext: {
			from: 272_000,
			perMillion: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 }
		}
	},
	'claude-opus-5-5': {
		provider: 'anthropic',
		contextWindow: 1_000_000,
		perMillion: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 }
	}
};

// Compact before long-context pricing starts, leaving headroom for the step that crosses it.
// Models priced flat use most of their window, leaving room for a long reply and tool output.
export function compactThreshold(model: string) {
	const info = models[model];
	if (!info) return undefined;
	return Math.floor(
		info.longContext
			? Math.min(info.longContext.from, info.contextWindow * 0.75) * 0.9
			: info.contextWindow * 0.8
	);
}

export function cost(model: string, usage: Usage) {
	const info = models[model];
	if (!info) return null;
	const rates =
		info.longContext && usage.inputTokens > info.longContext.from
			? info.longContext.perMillion
			: info.perMillion;
	const uncached = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
	return (
		(uncached * rates.input +
			usage.cachedInputTokens * rates.cachedInput +
			usage.cacheWriteTokens * rates.cacheWrite +
			usage.outputTokens * rates.output) /
		1_000_000
	);
}

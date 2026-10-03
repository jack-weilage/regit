import type { Usage } from './types.ts';

interface Rates {
	input: number;
	cachedInput: number;
	cacheWrite: number;
	output: number;
}

export interface ModelInfo {
	contextWindow: number;
	longContextFrom: number;
	perMillion: { short: Rates; long: Rates };
}

// Standard-tier USD prices from https://developers.openai.com/api/docs/pricing (checked 2026-10-03)
export const models: Record<string, ModelInfo> = {
	'gpt-6-luna': {
		contextWindow: 1_050_000,
		longContextFrom: 272_000,
		perMillion: {
			short: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
			long: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 }
		}
	},
	'gpt-6.1-sol': {
		contextWindow: 1_050_000,
		longContextFrom: 272_000,
		perMillion: {
			short: { input: 2, cachedInput: 0.1, cacheWrite: 2.5, output: 10 },
			long: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 15 }
		}
	}
};

export function cost(model: string, usage: Usage) {
	const info = models[model];
	if (!info) return null;
	const rates =
		usage.inputTokens > info.longContextFrom ? info.perMillion.long : info.perMillion.short;
	const uncached = usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens;
	return (
		(uncached * rates.input +
			usage.cachedInputTokens * rates.cachedInput +
			usage.cacheWriteTokens * rates.cacheWrite +
			usage.outputTokens * rates.output) /
		1_000_000
	);
}

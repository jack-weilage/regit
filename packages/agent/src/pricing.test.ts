import { expect, test } from 'vitest';
import { cost } from './pricing.ts';

test('prices uncached, cached, cache-write and output tokens separately', () => {
	const usage = {
		inputTokens: 100_000,
		cachedInputTokens: 60_000,
		cacheWriteTokens: 10_000,
		outputTokens: 2_000
	};
	expect(cost('gpt-6.1-sol', usage)).toBeCloseTo(
		(30_000 * 2 + 60_000 * 0.1 + 10_000 * 2.5 + 2_000 * 10) / 1_000_000
	);
});

test('uses long-context rates once the prompt passes 272K tokens', () => {
	const usage = {
		inputTokens: 300_000,
		cachedInputTokens: 0,
		cacheWriteTokens: 0,
		outputTokens: 0
	};
	expect(cost('gpt-6-luna', usage)).toBeCloseTo((300_000 * 0.2) / 1_000_000);
	expect(cost('gpt-6-luna', { ...usage, inputTokens: 272_000 })).toBeCloseTo(
		(272_000 * 0.1) / 1_000_000
	);
});

test('returns null for models without a price', () => {
	const usage = { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 };
	expect(cost('unknown-model', usage)).toBeNull();
});

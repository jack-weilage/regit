import { expect, test } from 'bun:test';
import { compactThreshold, cost } from './pricing.ts';

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

test('prices Claude flat across its window', () => {
	const usage = {
		inputTokens: 500_000,
		cachedInputTokens: 400_000,
		cacheWriteTokens: 50_000,
		outputTokens: 4_000
	};
	expect(cost('claude-opus-5-5', usage)).toBeCloseTo(
		(50_000 * 4 + 400_000 * 0.2 + 50_000 * 5 + 4_000 * 20) / 1_000_000
	);
});

test('compacts under the long-context price jump, or late in a flat-priced window', () => {
	expect(compactThreshold('gpt-6.1-sol')).toBe(244_800);
	expect(compactThreshold('claude-opus-5-5')).toBe(800_000);
	expect(compactThreshold('unknown-model')).toBeUndefined();
});

test('returns null for models without a price', () => {
	const usage = { inputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1 };
	expect(cost('unknown-model', usage)).toBeNull();
});

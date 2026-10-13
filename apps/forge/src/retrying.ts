import { backoff, isTransient, type RetryPolicy } from '@regit/agent';
import type { RetryFailure } from '@regit/core';

const rpc: RetryPolicy = { limit: 3, baseMs: 250, maxMs: 2000 };

// Retries calls between Durable Objects, which can fail while one of them restarts.
export async function retrying<T>(label: string, run: () => Promise<T>, policy = rpc): Promise<T> {
	const failures: RetryFailure[] = [];
	for (let attempt = 1; ; attempt++) {
		try {
			return await run();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			failures.push({ at: Date.now(), label, error: message });
			if (attempt >= policy.limit || !isTransient(error))
				throw new RetriesExhausted(failures, error);
			await scheduler.wait(backoff(attempt, policy.baseMs, policy.maxMs, error));
		}
	}
}

export class RetriesExhausted extends Error {
	override name = 'RetriesExhausted';

	constructor(
		readonly failures: RetryFailure[],
		cause: unknown
	) {
		super(failures.at(-1)?.error ?? 'Failed', { cause });
	}
}

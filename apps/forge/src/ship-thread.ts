import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Ship } from '@regit/core';

// Conflicts and empty ships fail the same way on every retry; the thread's agent has to act first.
export const isFinalShipError = (message: string) =>
	message.startsWith('Ship conflicts with ') || message.includes('Nothing to ship');

const retries = 3;
const delayMs = 10_000;

// RPC results carry a disposer that step outputs can't store.
export const plain = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T;

// Lands the thread on main without waiting for checks; main's deploy checks run once it has landed.
export class ShipThread extends WorkflowEntrypoint<Env, Ship> {
	override async run({ payload: ship }: WorkflowEvent<Ship>, step: WorkflowStep) {
		const repos = () => this.env.REPOS.getByName(ship.repo);
		let shipped: { sha: string; branch: string };
		try {
			shipped = await step.do(
				'ship the thread',
				{ retries: { limit: retries, delay: `${delayMs / 1000} seconds`, backoff: 'exponential' } },
				async ({ attempt }) => {
					try {
						return plain<{ sha: string; branch: string }>(
							await this.env.REPOSITORY_GIT.getByName(`ship-${ship.repo}`).ship(ship)
						);
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						if (isFinalShipError(message)) throw new NonRetryableError(message);
						if (attempt <= retries) {
							const next = { attempt: attempt + 1, limit: retries + 1 };
							await repos()
								.shipRetrying(ship, {
									error: message,
									...next,
									delayMs: delayMs * 2 ** (attempt - 1)
								})
								.catch((cause: unknown) => console.warn('Could not report the ship retry', cause));
						}
						throw error;
					}
				}
			);
		} catch (error) {
			const message = (error instanceof Error ? error.message : String(error)).replace(
				/^NonRetryableError: /,
				''
			);
			await step.do('report the failure', () => repos().shipFailed(ship, message));
			return;
		}
		await step.do('record the ship', () => repos().shipped(ship, shipped));
	}
}

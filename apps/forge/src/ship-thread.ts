import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';
import type { Ship } from '@regit/core';

// Conflicts and empty ships fail the same way on every retry; the thread's agent has to act first.
export const isFinalShipError = (message: string) =>
	message.startsWith('Ship conflicts with main') || message.includes('Nothing to ship');

export class ShipThread extends WorkflowEntrypoint<Env, Ship> {
	override async run({ payload: ship }: WorkflowEvent<Ship>, step: WorkflowStep) {
		const repos = () => this.env.REPOS.getByName(ship.repo);
		let shipped: { sha: string; branch: string };
		try {
			shipped = await step.do(
				'ship to main',
				{ retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } },
				async ({ attempt }) => {
					try {
						const { sha, branch } = await this.env.REPOSITORY_GIT.getByName(
							`ship-${ship.repo}`
						).ship(ship, attempt);
						return { sha, branch };
					} catch (error) {
						const message = error instanceof Error ? error.message : String(error);
						throw isFinalShipError(message) ? new NonRetryableError(message) : error;
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

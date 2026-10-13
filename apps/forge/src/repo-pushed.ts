import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { canonicalPush, type ArtifactsPush } from './landing.ts';

export class RepoPushed extends WorkflowEntrypoint<Env, ArtifactsPush> {
	override async run(event: WorkflowEvent<ArtifactsPush>, step: WorkflowStep) {
		const landing = canonicalPush(event.payload);
		if (!landing) return;
		console.log('Branch moved', landing);
		await step.do(
			'queue a CI run',
			{ retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } },
			() => this.env.CI.getByName(landing.repo).landed(landing)
		);
		await step.do(
			'compare threads with the default branch',
			{ retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } },
			() => this.env.REPOS.getByName(landing.repo).landed(landing)
		);
	}
}

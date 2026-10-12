import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { canonicalPush, type ArtifactsPush } from './landing.ts';

export class RepoPushed extends WorkflowEntrypoint<Env, ArtifactsPush> {
	override async run(event: WorkflowEvent<ArtifactsPush>, step: WorkflowStep) {
		const landing = canonicalPush(event.payload);
		if (!landing) return;
		console.log('Main moved', landing);
		await step.do(
			'check threads against main',
			{ retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' } },
			() => this.env.REPOS.getByName(landing.repo).landed(landing)
		);
	}
}

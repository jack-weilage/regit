import { WorkerEntrypoint } from 'cloudflare:workers';
import type { AttemptInput, AttemptSnapshot } from './attempt-sandbox.ts';

export { AttemptSandbox } from './attempt-sandbox.ts';
export { Models } from './models.ts';

export default class Forge extends WorkerEntrypoint<Env> {
	override async fetch() {
		return new Response(null, { status: 404 });
	}

	async startAttempt(thread: string, input: AttemptInput) {
		await this.env.ATTEMPTS.getByName(thread).start(input);
	}

	async attempt(thread: string): Promise<AttemptSnapshot | null> {
		return this.env.ATTEMPTS.getByName(thread).snapshot();
	}

	async cancelAttempt(thread: string) {
		await this.env.ATTEMPTS.getByName(thread).cancel();
	}
}

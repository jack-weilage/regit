import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GatewayRequest } from '@regit/agent';

export class Models extends WorkerEntrypoint<Env> {
	run(request: GatewayRequest) {
		return this.env.AI.gateway(this.env.AI_GATEWAY).run(request as AIGatewayUniversalRequest);
	}
}

import { WorkerEntrypoint } from 'cloudflare:workers';
import type { GatewayRequest, JevRequest, JevResponse } from '@regit/agent';

export class Models extends WorkerEntrypoint<Env> {
	run(request: GatewayRequest) {
		return this.env.AI.gateway(this.env.AI_GATEWAY).run(request as AIGatewayUniversalRequest);
	}

	async decide(request: JevRequest): Promise<JevResponse> {
		const response = (await this.env.AI.run('typesafe/jev' as never, request as never, {
			gateway: { id: this.env.AI_GATEWAY }
		})) as unknown as JevResponse | { result: JevResponse };
		return 'result' in response ? response.result : response;
	}
}

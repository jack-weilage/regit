export interface GatewayRequest {
	provider: string;
	endpoint: string;
	headers: Record<string, string | Record<string, string | number | boolean>>;
	query: unknown;
}

export interface Gateway {
	run(request: GatewayRequest): Promise<Response>;
}

export type Metadata = Record<string, string | number | boolean>;

export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function gatewayFetch(gateway: Gateway, provider: string, metadata: Metadata = {}): Fetch {
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		return gateway.run({
			provider,
			endpoint: url.pathname.replace(/^\/v1\//, ''),
			headers: { 'content-type': 'application/json', 'cf-aig-metadata': metadata },
			query: JSON.parse(String(init?.body))
		});
	};
}

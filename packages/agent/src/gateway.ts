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

// SDK clients use this as their base URL; the gateway keeps the provider's key and real host.
export const gatewayBase = 'https://ai-gateway.invalid';

// TODO: move off the deprecated Universal Endpoint to provider-native gateway URLs once forge has a cf-aig-authorization token
export function gatewayFetch(gateway: Gateway, provider: string, metadata: Metadata = {}): Fetch {
	return async (input, init) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		const forwarded = Object.fromEntries(
			[...new Headers(init?.headers).entries()].filter(([name]) => name.startsWith(`${provider}-`))
		);
		return gateway.run({
			provider,
			endpoint: url.pathname.slice(1),
			headers: { ...forwarded, 'content-type': 'application/json', 'cf-aig-metadata': metadata },
			query: JSON.parse(String(init?.body))
		});
	};
}

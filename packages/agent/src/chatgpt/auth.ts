const tokenUrl = 'https://auth.openai.com/oauth/token';
const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann';
const refreshWindow = 5 * 60 * 1000;

export interface ChatGPTTokens {
	accessToken: string;
	refreshToken: string;
	accountId: string;
	idToken?: string;
}

export interface TokenSource {
	tokens(): Promise<ChatGPTTokens>;
	refresh(): Promise<ChatGPTTokens>;
}

export interface TokenStore {
	load(): Promise<ChatGPTTokens>;
	save(tokens: ChatGPTTokens): Promise<void>;
}

export interface AuthOptions {
	fetch?: typeof fetch;
	now?: () => number;
}

export class ChatGPTAuth implements TokenSource {
	#store: TokenStore;
	#fetch: typeof fetch;
	#now: () => number;
	#refreshing?: Promise<ChatGPTTokens>;

	constructor(store: TokenStore, { fetch = globalThis.fetch, now = Date.now }: AuthOptions = {}) {
		this.#store = store;
		this.#fetch = fetch;
		this.#now = now;
	}

	async tokens() {
		const tokens = await this.#store.load();
		const expiresAt = tokenExpiry(tokens.accessToken);
		return expiresAt !== undefined && expiresAt - this.#now() < refreshWindow
			? this.refresh()
			: tokens;
	}

	refresh() {
		this.#refreshing ??= this.#refresh().finally(() => (this.#refreshing = undefined));
		return this.#refreshing;
	}

	async #refresh() {
		const current = await this.#store.load();
		const response = await this.#fetch(tokenUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_id: clientId,
				grant_type: 'refresh_token',
				refresh_token: current.refreshToken
			})
		});
		if (!response.ok)
			throw new Error(`Refreshing the ChatGPT token failed with ${response.status}`);

		const body = (await response.json()) as {
			access_token?: string;
			refresh_token?: string;
			id_token?: string;
		};
		const tokens: ChatGPTTokens = {
			...current,
			accessToken: body.access_token ?? current.accessToken,
			refreshToken: body.refresh_token ?? current.refreshToken,
			idToken: body.id_token ?? current.idToken
		};
		await this.#store.save(tokens);
		return tokens;
	}
}

function tokenExpiry(jwt: string) {
	try {
		const payload = jwt.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/');
		const { exp } = JSON.parse(atob(payload)) as { exp?: number };
		return exp === undefined ? undefined : exp * 1000;
	} catch {
		return undefined;
	}
}

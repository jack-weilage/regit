import { DurableObject } from 'cloudflare:workers';
import { ChatGPTAuth, type ChatGPTTokens } from '@regit/agent';

export class ChatGPTAccount extends DurableObject<Env> {
	#auth = new ChatGPTAuth({
		load: async () => {
			const row = this.ctx.storage.sql
				.exec<{ value: string }>('SELECT value FROM tokens')
				.toArray()[0];
			if (!row) throw new Error('ChatGPT is not connected');
			return JSON.parse(row.value) as ChatGPTTokens;
		},
		save: async (tokens) => this.saveTokens(tokens)
	});

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(
			'CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)'
		);
	}

	saveTokens(tokens: ChatGPTTokens) {
		this.ctx.storage.sql.exec(
			'INSERT INTO tokens (id, value) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET value = excluded.value',
			JSON.stringify(tokens)
		);
	}

	tokens() {
		return this.#auth.tokens();
	}

	refresh() {
		return this.#auth.refresh();
	}
}

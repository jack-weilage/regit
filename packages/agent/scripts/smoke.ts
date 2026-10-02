import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ChatGPTAuth, chatgptModel, runAgent, type TokenStore } from '../src/index.ts';

const path = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');

const codexStore: TokenStore = {
	async load() {
		const { tokens } = JSON.parse(await readFile(path, 'utf8'));
		return {
			accessToken: tokens.access_token,
			refreshToken: tokens.refresh_token,
			accountId: tokens.account_id,
			idToken: tokens.id_token
		};
	},
	async save(tokens) {
		const file = JSON.parse(await readFile(path, 'utf8'));
		file.tokens = {
			...file.tokens,
			access_token: tokens.accessToken,
			refresh_token: tokens.refreshToken,
			id_token: tokens.idToken
		};
		file.last_refresh = new Date().toISOString();
		await writeFile(path, JSON.stringify(file, null, 2));
	}
};

const files: Record<string, string> = { 'src/greeting.ts': "export const greeting = 'hello';\n" };

const run = runAgent({
	model: chatgptModel({
		auth: new ChatGPTAuth(codexStore),
		model: process.argv[2] ?? 'gpt-6.1-sol',
		sessionId: crypto.randomUUID(),
		effort: 'low'
	}),
	tools: {
		specs: [
			{
				name: 'read_file',
				description: 'Read a file from the repository',
				parameters: {
					type: 'object',
					properties: { path: { type: 'string' } },
					required: ['path']
				}
			}
		],
		async execute(call) {
			const { path } = JSON.parse(call.arguments);
			return files[path] ?? `No such file: ${path}`;
		}
	},
	instructions: 'You are ReGit, a coding agent. Use tools to inspect the repository. Be brief.',
	history: [{ role: 'user', text: 'What does src/greeting.ts export? Read it first.' }],
	maxSteps: 4
});

for await (const event of run) {
	if (event.type === 'text') process.stdout.write(event.delta);
	if (event.type === 'call') console.log(`\n→ ${event.call.name}(${event.call.arguments})`);
	if (event.type === 'step') console.log(`\n· usage ${JSON.stringify(event.usage)}`);
}

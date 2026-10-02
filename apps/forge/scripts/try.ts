import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatGPTTokens } from '@regit/agent';
import { createTestHarness } from 'wrangler';
import type Forge from '../src/index.ts';
import { serveGit } from '../test/git-server.ts';

const task =
	process.argv[2] ?? 'Add a farewell export next to the greeting, with a test using node:test';
const codexAuth = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');

const dir = await mkdtemp(join(tmpdir(), 'regit-try-'));
const seed = join(dir, 'seed');
const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
git(dir, 'init', '--initial-branch', 'main', seed);
await writeFile(join(seed, 'greeting.js'), "export const greeting = 'hello';\n");
await writeFile(join(seed, 'package.json'), '{ "type": "module" }\n');
git(seed, 'add', '.');
git(seed, '-c', 'user.name=Sam', '-c', 'user.email=sam@example.com', 'commit', '-m', 'init');
git(dir, 'clone', '--bare', '--quiet', seed, 'repo.git');
const server = await serveGit(dir);

const harness = createTestHarness({ workers: [{ configPath: './wrangler.jsonc' }] });
await harness.listen();
const worker = harness.getWorker<Env, { default: typeof Forge }>();
const api = await worker.getExport();

const file = JSON.parse(await readFile(codexAuth, 'utf8'));
await api.connectChatGPT({
	accessToken: file.tokens.access_token,
	refreshToken: file.tokens.refresh_token,
	accountId: file.tokens.account_id,
	idToken: file.tokens.id_token
});

await api.startAttempt('try', {
	task,
	mode: 'small',
	repo: {
		remote: `http://host.docker.internal:${server.port}/repo.git`,
		token: 'local',
		branch: 'main'
	}
});

let shown = 0;
for (;;) {
	const snapshot = (await api.attempt('try'))!;
	for (const step of snapshot.steps.slice(shown)) {
		for (const turn of step.turns) {
			if (turn.role === 'assistant') {
				if (turn.text) console.log(`\n${turn.text}`);
				for (const call of turn.calls)
					console.log(`→ ${call.name} ${call.arguments.slice(0, 160)}`);
			}
		}
		if (step.checkpoint) console.log(`✓ checkpoint ${step.checkpoint.slice(0, 7)}`);
	}
	shown = snapshot.steps.length;
	if (!['queued', 'running'].includes(snapshot.status)) {
		console.log(`\n${snapshot.status}${snapshot.error ? `: ${snapshot.error}` : ''}`);
		break;
	}
	await new Promise((resolve) => setTimeout(resolve, 500));
}

console.log(`\n${git(join(dir, 'repo.git'), 'log', '--format=%h %an: %s', 'main')}`);

const storage = await worker.getDurableObjectStorage('CHATGPT', { name: 'default' });
const [row] = await storage.exec<{ value: string }>('SELECT value FROM tokens');
const tokens = JSON.parse(row!.value) as ChatGPTTokens;
if (tokens.refreshToken !== file.tokens.refresh_token) {
	file.tokens = {
		...file.tokens,
		access_token: tokens.accessToken,
		refresh_token: tokens.refreshToken,
		id_token: tokens.idToken
	};
	file.last_refresh = new Date().toISOString();
	await writeFile(codexAuth, JSON.stringify(file, null, 2));
}

await harness.close();
await server.close();

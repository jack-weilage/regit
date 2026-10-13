import { spawn } from 'node:child_process';
import type { IncomingHttpHeaders } from 'node:http';
import { once } from 'node:events';

export async function startGitServer(root: string) {
	const child = spawn(
		process.execPath,
		[new URL('./git-daemon.ts', import.meta.url).pathname, root],
		{
			stdio: ['ignore', 'pipe', 'inherit']
		}
	);
	const [line] = (await once(child.stdout, 'data')) as [Buffer];
	const port = Number(line.toString().trim());
	return {
		port,
		async requests() {
			const response = await fetch(`http://127.0.0.1:${port}/_control/requests`);
			return (await response.json()) as IncomingHttpHeaders[];
		},
		async paths() {
			const response = await fetch(`http://127.0.0.1:${port}/_control/paths`);
			return (await response.json()) as string[];
		},
		close() {
			child.kill();
		}
	};
}

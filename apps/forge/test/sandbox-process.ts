import { spawn } from 'node:child_process';
import { once } from 'node:events';

export async function startSandbox(root: string) {
	const child = spawn('bun', [new URL('./sandbox-daemon.ts', import.meta.url).pathname, root], {
		stdio: ['ignore', 'pipe', 'inherit']
	});
	const [line] = (await once(child.stdout, 'data')) as [Buffer];
	return {
		port: Number(line.toString().trim()),
		close() {
			child.kill();
		}
	};
}

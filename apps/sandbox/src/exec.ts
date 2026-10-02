import { spawn } from 'node:child_process';

export interface ExecOptions {
	cwd: string;
	env?: Record<string, string>;
	timeout?: number;
}

export interface ExecResult {
	code: number | null;
	output: string;
	timedOut: boolean;
}

export function exec(
	command: string,
	args: string[],
	{ cwd, env, timeout = 120_000 }: ExecOptions
) {
	return new Promise<ExecResult>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		let timedOut = false;
		const append = (chunk: Buffer) => (output += chunk);
		child.stdout.on('data', append);
		child.stderr.on('data', append);

		const timer = setTimeout(() => {
			timedOut = true;
			process.kill(-child.pid!, 'SIGKILL');
		}, timeout);

		child.on('error', reject);
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, output, timedOut });
		});
	});
}

export async function git(cwd: string, args: string[], env?: Record<string, string>) {
	const result = await exec('git', args, { cwd, env });
	if (result.code !== 0) throw new Error(`git ${args[0]} failed: ${result.output.trim()}`);
	return result.output.trim();
}

export function truncate(text: string, max = 20_000) {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n… ${text.length - max} characters omitted …\n${text.slice(-half)}`;
}

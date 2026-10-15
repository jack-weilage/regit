import { spawn } from 'node:child_process';

export interface ExecOptions {
	cwd: string;
	env?: Record<string, string>;
	timeout?: number;
	signal?: AbortSignal;
	onOutput?: (chunk: string) => void;
}

export interface ExecResult {
	code: number | null;
	output: string;
	stdout: string;
	timedOut: boolean;
}

export function exec(
	command: string,
	args: string[],
	{ cwd, env, timeout = 120_000, signal, onOutput }: ExecOptions
) {
	return new Promise<ExecResult>((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env: { ...process.env, ...env },
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		let stdout = '';
		let timedOut = false;
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			output += chunk;
			stdout += chunk;
			onOutput?.(chunk);
		});
		child.stderr.on('data', (chunk: string) => {
			output += chunk;
			onOutput?.(chunk);
		});

		const kill = () => {
			try {
				process.kill(-child.pid!, 'SIGKILL');
			} catch {
				/* Already exited. */
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			kill();
		}, timeout);
		signal?.addEventListener('abort', kill, { once: true });

		child.on('error', reject);
		child.on('close', (code) => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', kill);
			resolve({ code, output, stdout, timedOut });
		});
	});
}

export const noHooks = ['-c', 'core.hooksPath=/dev/null'];

export async function git(cwd: string, args: string[], env?: Record<string, string>) {
	const result = await exec('git', [...noHooks, ...args], { cwd, env });
	const command = args.find((arg, index) => arg !== '-c' && args[index - 1] !== '-c');
	if (result.code !== 0) throw new Error(`git ${command} failed: ${result.output.trim()}`);
	return result.output.trim();
}

export function truncate(text: string, max = 20_000) {
	if (text.length <= max) return text;
	const half = Math.floor(max / 2);
	return `${text.slice(0, half)}\n… ${text.length - max} characters omitted …\n${text.slice(-half)}`;
}

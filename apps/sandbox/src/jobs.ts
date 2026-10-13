import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { JobRead, JobReadRequest, JobStartRequest } from '@regit/agent';
import { ToolError } from './tools.ts';

interface Job {
	child: ChildProcess;
	running: boolean;
	exitCode: number | null;
	exited: Promise<void>;
}

const maxRead = 64 * 1024;
const ansi = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

// Long-running commands, such as a deploy, that outlive any one request; their output is read incrementally.
export function createJobs(root: string, logs = join(homedir(), '.regit', 'jobs')) {
	const jobs = new Map<string, Job>();
	const logFile = (name: string) => join(logs, `${name}.log`);

	async function start({ name, command, env }: JobStartRequest) {
		if (!/^[\w.-]+$/.test(name))
			throw new ToolError('Job names may only use letters, digits, ., - and _');
		if (jobs.get(name)?.running) throw new ToolError(`${name} is already running`);
		await mkdir(logs, { recursive: true });
		const log = openSync(logFile(name), 'w');
		const child = spawn('bash', ['-c', command], {
			cwd: root,
			env: { ...process.env, CI: 'true', ...env },
			detached: true,
			stdio: ['ignore', log, log]
		});
		closeSync(log);
		const exited = new Promise<void>((done) =>
			child.on('exit', (code) => {
				job.running = false;
				job.exitCode = code ?? 137;
				done();
			})
		);
		const job: Job = { child, running: true, exitCode: null, exited };
		jobs.set(name, job);
		return {};
	}

	async function read({ name, offset = 0 }: JobReadRequest): Promise<JobRead> {
		const job = jobs.get(name);
		if (!job) return { status: 'unknown', exitCode: null, output: '', offset };
		const running = job.running;
		const file = await open(logFile(name), 'r');
		try {
			const bytes = Buffer.alloc(maxRead);
			const { bytesRead } = await file.read(bytes, 0, maxRead, offset);
			const length = wholeCharacters(bytes.subarray(0, bytesRead));
			return {
				status: running ? 'running' : 'exited',
				exitCode: job.exitCode,
				output: bytes.toString('utf8', 0, length).replace(ansi, ''),
				offset: offset + length
			};
		} finally {
			await file.close();
		}
	}

	async function stop({ name }: { name: string }) {
		const job = jobs.get(name);
		if (!job?.running) return {};
		signal(job.child, 'SIGTERM');
		const killed = setTimeout(() => signal(job.child, 'SIGKILL'), 5000);
		await job.exited;
		clearTimeout(killed);
		return {};
	}

	async function stopAll() {
		await Promise.all([...jobs.keys()].map((name) => stop({ name })));
	}

	return { start, read, stop, stopAll };
}

// Stops short of a UTF-8 sequence cut off at the end, so it is read whole next time.
function wholeCharacters(bytes: Buffer) {
	for (let back = 1; back <= Math.min(3, bytes.length); back++) {
		const byte = bytes[bytes.length - back]!;
		if ((byte & 0xc0) === 0x80) continue;
		const size = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
		return size > back ? bytes.length - back : bytes.length;
	}
	return bytes.length;
}

function signal(child: ChildProcess, name: NodeJS.Signals) {
	try {
		process.kill(-child.pid!, name);
	} catch {
		// The process group already exited.
	}
}

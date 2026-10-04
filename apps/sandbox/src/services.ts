import { spawn, type ChildProcess } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServiceInfo, ServiceSpec } from '@regit/agent';
import { ToolError } from './tools.ts';

export const servicesFile = '.agents/services.yml';

interface Running {
	spec: ServiceSpec;
	saved: boolean;
	child: ChildProcess;
	status: 'starting' | 'running' | 'exited';
	exitCode: number | null;
	startedAt: number;
	exited: Promise<void>;
}

export interface ServicesOptions {
	logs?: string;
	readyTimeoutMs?: number;
}

export function createServices(
	root: string,
	{ logs = join(homedir(), '.regit', 'logs'), readyTimeoutMs = 180_000 }: ServicesOptions = {}
) {
	const running = new Map<string, Running>();

	async function saved() {
		const text = await readFile(join(root, servicesFile), 'utf8').catch(() => null);
		return text === null ? [] : parseServices(text);
	}

	function info(entry: Running): ServiceInfo {
		return {
			...entry.spec,
			saved: entry.saved,
			status: entry.status,
			exitCode: entry.exitCode,
			startedAt: entry.startedAt
		};
	}

	async function list(): Promise<ServiceInfo[]> {
		const specs = await saved();
		const names = new Set(specs.map((spec) => spec.name));
		return [
			...specs.map((spec) => {
				const entry = running.get(spec.name);
				return entry ? info(entry) : { ...spec, saved: true, status: 'stopped' as const };
			}),
			...[...running.values()].filter((entry) => !names.has(entry.spec.name)).map(info)
		];
	}

	async function start(request: ServiceSpec | { name: string }): Promise<ServiceInfo> {
		const specs = await saved();
		const spec =
			'command' in request ? request : specs.find((service) => service.name === request.name);
		if (!spec)
			throw new ToolError(`There is no saved service named ${request.name} in ${servicesFile}`);
		if (!/^[\w.-]+$/.test(spec.name))
			throw new ToolError('Service names may only use letters, digits, ., - and _');
		const current = running.get(spec.name);
		if (current && current.status !== 'exited') return info(current);

		await mkdir(logs, { recursive: true });
		const log = openSync(join(logs, `${spec.name}.log`), 'w');
		const child = spawn('sh', ['-c', spec.command], {
			cwd: resolve(root, spec.cwd ?? '.'),
			env: { ...process.env, HOST: '0.0.0.0', ...spec.env, PORT: String(spec.port) },
			detached: true,
			stdio: ['ignore', log, log]
		});
		closeSync(log);
		const entry: Running = {
			spec,
			saved: specs.some((service) => service.name === spec.name),
			child,
			status: 'starting',
			exitCode: null,
			startedAt: Date.now(),
			exited: new Promise((done) =>
				child.on('exit', (code) => {
					entry.status = 'exited';
					entry.exitCode = code;
					done();
				})
			)
		};
		running.set(spec.name, entry);

		const deadline = Date.now() + readyTimeoutMs;
		while (Date.now() < deadline) {
			if (entry.status === 'exited') {
				throw new ToolError(
					`${spec.name} exited with code ${entry.exitCode} before port ${spec.port} opened:\n${await tail(spec.name, 30)}`
				);
			}
			if (await listening(spec.port)) {
				entry.status = 'running';
				return info(entry);
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		await stop(spec.name);
		throw new ToolError(
			`${spec.name} did not open port ${spec.port} within ${readyTimeoutMs / 1000}s:\n${await tail(spec.name, 30)}`
		);
	}

	async function stop(name: string) {
		const entry = running.get(name);
		if (!entry) return;
		if (entry.status !== 'exited') {
			signal(entry.child, 'SIGTERM');
			const killed = setTimeout(() => signal(entry.child, 'SIGKILL'), 5000);
			await entry.exited;
			clearTimeout(killed);
		}
		running.delete(name);
	}

	async function restart(name: string) {
		const spec = running.get(name)?.spec;
		await stop(name);
		return start(spec ?? { name });
	}

	async function tail(name: string, lines = 100) {
		const text = await readFile(join(logs, `${name}.log`), 'utf8').catch(() => '');
		return text
			.replace(ansi, '')
			.split('\n')
			.slice(-lines - 1)
			.join('\n')
			.trimEnd();
	}

	async function stopAll() {
		await Promise.all([...running.keys()].map(stop));
	}

	async function pausedDuring<T>(change: () => Promise<T>) {
		const resume = [...running.values()]
			.filter((entry) => entry.status !== 'exited')
			.map((entry) => (entry.saved ? { name: entry.spec.name } : entry.spec));
		await stopAll();
		const result = await change();
		for (const request of resume) start(request).catch(() => {});
		return result;
	}

	return { list, start, stop, restart, logs: tail, stopAll, pausedDuring };
}

export type Services = ReturnType<typeof createServices>;

const ansi = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

function signal(child: ChildProcess, name: NodeJS.Signals) {
	try {
		process.kill(-child.pid!, name);
	} catch {
		// The process group already exited.
	}
}

function listening(port: number) {
	return new Promise<boolean>((resolve) => {
		const socket = connect({ port, host: '127.0.0.1' });
		socket.once('connect', () => {
			socket.destroy();
			resolve(true);
		});
		socket.once('error', () => resolve(false));
	});
}

export function parseServices(text: string): ServiceSpec[] {
	const root = parseYaml(text);
	const services = root.services;
	if (services === undefined) return [];
	if (!isMap(services))
		throw new ToolError(`${servicesFile}: services must be a map of names to services`);
	return Object.entries(services).map(([name, value]) => {
		if (!isMap(value)) throw new ToolError(`${servicesFile}: ${name} must be a map`);
		const port = Number(value.port);
		if (typeof value.command !== 'string' || !value.command) {
			throw new ToolError(`${servicesFile}: ${name} needs a command`);
		}
		if (!Number.isInteger(port) || port <= 0)
			throw new ToolError(`${servicesFile}: ${name} needs a port`);
		const env = value.env === undefined ? undefined : value.env;
		if (env !== undefined && !isMap(env))
			throw new ToolError(`${servicesFile}: ${name}.env must be a map`);
		return {
			name,
			command: value.command,
			port,
			...(typeof value.cwd === 'string' && { cwd: value.cwd }),
			...(env && {
				env: Object.fromEntries(Object.entries(env).map(([key, val]) => [key, String(val)]))
			})
		};
	});
}

type YamlMap = { [key: string]: string | YamlMap };

const isMap = (value: unknown): value is YamlMap => typeof value === 'object' && value !== null;

function parseYaml(text: string): YamlMap {
	const root: YamlMap = {};
	const stack: { indent: number; map: YamlMap }[] = [{ indent: -1, map: root }];
	for (const [index, raw] of text.split('\n').entries()) {
		const line = raw.replace(/\s+#.*$/, '').trimEnd();
		if (!line.trim() || line.trim().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		const match = /^([\w.-]+):(?:\s+(.*))?$/.exec(line.trim());
		if (!match) throw new ToolError(`${servicesFile}:${index + 1}: expected "key: value"`);
		while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
		const parent = stack.at(-1)!.map;
		const [, key, value] = match;
		if (value === undefined || value === '') {
			const child: YamlMap = {};
			parent[key!] = child;
			stack.push({ indent, map: child });
		} else {
			parent[key!] = unquote(value);
		}
	}
	return root;
}

function unquote(value: string) {
	const quoted = /^(['"])(.*)\1$/.exec(value);
	return quoted ? quoted[2]! : value;
}

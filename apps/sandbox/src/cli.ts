import type { ServiceInfo } from '@regit/agent';

const usage = `Usage:
  regit services                                   List saved and running services
  regit services start <name>                      Start a service from .agents/services.yml
  regit services run <name> --port <port> [--cwd <dir>] -- <command...>
                                                   Start a one-off service
  regit services stop <name>
  regit services restart <name>
  regit services logs <name> [--lines <n>]`;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function services(
	args: string[],
	{
		fetch = globalThis.fetch as Fetch,
		base = 'http://127.0.0.1:8080',
		preview = process.env.REGIT_PREVIEW_HOST
	} = {}
): Promise<{ code: number; output: string }> {
	const call = async <T>(name: string, body: object = {}) => {
		const response = await fetch(`${base}/services/${name}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const result = (await response.json()) as T & { error?: string };
		if (!response.ok) throw new Error(result.error ?? response.statusText);
		return result;
	};
	const link = (name: string) => (preview ? `https://${preview.replace('{name}', name)}` : '');
	const describe = (service: ServiceInfo) =>
		[
			service.name,
			service.status === 'exited' ? `exited (${service.exitCode})` : service.status,
			`:${service.port}`,
			service.saved ? 'saved' : 'one-off',
			service.status === 'running' ? link(service.name) : ''
		]
			.filter(Boolean)
			.join('  ');

	const [command = 'list', name, ...rest] = args;
	try {
		if (command === 'list') {
			const { services } = await call<{ services: ServiceInfo[] }>('list');
			return {
				code: 0,
				output: services.length ? services.map(describe).join('\n') : 'No services.'
			};
		}
		if (!name) return { code: 2, output: usage };
		if (command === 'start' || command === 'restart') {
			const { service } = await call<{ service: ServiceInfo }>(command, { name });
			return { code: 0, output: describe(service) };
		}
		if (command === 'run') {
			const split = rest.indexOf('--');
			const flags = split === -1 ? rest : rest.slice(0, split);
			const line = split === -1 ? [] : rest.slice(split + 1);
			const flag = (key: string) => {
				const index = flags.indexOf(`--${key}`);
				return index === -1 ? undefined : flags[index + 1];
			};
			const port = Number(flag('port'));
			if (!line.length || !Number.isInteger(port)) return { code: 2, output: usage };
			const { service } = await call<{ service: ServiceInfo }>('start', {
				name,
				port,
				command: line.length === 1 ? line[0]! : line.map(quote).join(' '),
				...(flag('cwd') && { cwd: flag('cwd') })
			});
			return { code: 0, output: describe(service) };
		}
		if (command === 'stop') {
			await call('stop', { name });
			return { code: 0, output: `Stopped ${name}.` };
		}
		if (command === 'logs') {
			const lines = Number(rest[rest.indexOf('--lines') + 1]) || undefined;
			const { logs } = await call<{ logs: string }>('logs', { name, lines });
			return { code: 0, output: logs || `No output from ${name} yet.` };
		}
		return { code: 2, output: usage };
	} catch (cause) {
		return { code: 1, output: cause instanceof Error ? cause.message : String(cause) };
	}
}

function quote(arg: string) {
	return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { services } from './cli.ts';
import { createSandbox } from './server.ts';

const port = Number(process.env.PORT ?? 8080);

if (process.argv[2] === 'services') {
	const { code, output } = await services(process.argv.slice(3), {
		base: `http://127.0.0.1:${port}`
	});
	console.log(output);
	process.exit(code);
}

const root = resolve(process.env.SANDBOX_ROOT ?? '/workspace');
await mkdir(root, { recursive: true });

const server = Bun.serve({ port, fetch: createSandbox(root) });
console.log(`Sandbox serving ${root} on ${server.url}`);

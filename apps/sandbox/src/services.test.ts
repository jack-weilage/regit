import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { services as cli } from './cli.ts';
import { git } from './exec.ts';
import { createSandbox } from './server.ts';
import { parseServices } from './services.ts';

let root: string;
let logs: string;
let sandbox: ReturnType<typeof createSandbox>;

const fetch = (url: string, init?: RequestInit) => sandbox(new Request(url, init));
const server = (message: string) =>
	`node -e "console.log('booting'); require('http').createServer((q, s) => s.end('${message}')).listen(process.env.PORT)"`;

function freePort() {
	return new Promise<number>((resolve) => {
		const probe = createServer().listen(0, () => {
			const { port } = probe.address() as { port: number };
			probe.close(() => resolve(port));
		});
	});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'regit-services-'));
	logs = join(root, '.logs');
	sandbox = createSandbox(root, { services: { logs, readyTimeoutMs: 10_000, portGraceMs: 300 } });
});

afterEach(async () => {
	await sandbox.services.stopAll();
	await rm(root, { recursive: true, force: true });
});

describe('services.yml', () => {
	test('parses saved services with comments, quotes and env', () => {
		expect(
			parseServices(`# Services people and agents run in a thread
services:
  storybook:
    command: bun run storybook  # the component explorer
    cwd: packages/ui
    port: 6006
  web:
    command: "bun run dev --host"
    port: '5173'
    env:
      MODE: dev
`)
		).toEqual([
			{ name: 'storybook', command: 'bun run storybook', cwd: 'packages/ui', port: 6006 },
			{ name: 'web', command: 'bun run dev --host', port: 5173, env: { MODE: 'dev' } }
		]);
	});

	test('rejects services without a command or port', () => {
		expect(() => parseServices('services:\n  web:\n    port: 1\n')).toThrow('web needs a command');
		expect(() => parseServices('services:\n  web:\n    command: x\n')).toThrow('web needs a port');
	});
});

test('starts a saved service, serves it through the preview path and stops it', async () => {
	const port = await freePort();
	await mkdir(join(root, '.agents'));
	await writeFile(
		join(root, '.agents/services.yml'),
		`services:\n  hello:\n    command: ${server('hi')}\n    port: ${port}\n`
	);
	expect(await sandbox.services.list()).toMatchObject([
		{ name: 'hello', saved: true, status: 'stopped' }
	]);

	expect(await sandbox.services.start({ name: 'hello' })).toMatchObject({
		status: 'running',
		port
	});
	const preview = await fetch(`http://sandbox/preview/${port}/anything?x=1`);
	expect(await preview.text()).toBe('hi');
	expect(await readFile(join(logs, 'hello.log'), 'utf8')).toContain('booting');
	expect(await sandbox.services.logs('hello')).toBe('booting');

	await sandbox.services.stop('hello');
	expect(await sandbox.services.list()).toMatchObject([{ name: 'hello', status: 'stopped' }]);
	expect((await fetch(`http://sandbox/preview/${port}/`)).status).toBe(502);
});

test('refuses to start a service on a port another process holds, and restarts on its own port', async () => {
	const port = await freePort();
	await mkdir(join(root, '.agents'));
	await writeFile(
		join(root, '.agents/services.yml'),
		`services:\n  hello:\n    command: ${server('hi')}\n    port: ${port}\n`
	);
	const holder = createServer().listen(port);
	await new Promise((resolve) => holder.once('listening', resolve));

	const startedAt = Date.now();
	await expect(sandbox.services.start({ name: 'hello' })).rejects.toThrow(
		`Port ${port} is already in use by another process, so hello can't start on it.`
	);
	expect(Date.now() - startedAt).toBeLessThan(5000);
	expect(await sandbox.services.list()).toMatchObject([{ name: 'hello', status: 'stopped' }]);

	await new Promise((resolve) => holder.close(resolve));
	expect(await sandbox.services.start({ name: 'hello' })).toMatchObject({ status: 'running' });
	expect(await sandbox.services.restart('hello')).toMatchObject({ status: 'running' });
	expect(await (await fetch(`http://sandbox/preview/${port}/`)).text()).toBe('hi');
});

test('runs one-off services from the CLI', async () => {
	const port = await freePort();
	const options = { fetch, base: 'http://sandbox', preview: 'p1-{name}.regit.run' };

	const started = await cli(['run', 'api', '--port', String(port), '--', server('api')], options);
	expect(started).toEqual({
		code: 0,
		output: `api  running  :${port}  one-off  https://p1-api.regit.run`
	});
	expect((await cli([], options)).output).toContain('api  running');
	expect(await cli(['logs', 'api', '--lines', '5'], options)).toEqual({
		code: 0,
		output: 'booting'
	});
	expect(await cli(['stop', 'api'], options)).toEqual({ code: 0, output: 'Stopped api.' });
	expect(await cli([], options)).toEqual({ code: 0, output: 'No services.' });
	expect((await cli(['start', 'missing'], options)).output).toContain(
		'no saved service named missing'
	);
	expect((await cli(['run', 'api'], options)).code).toBe(2);
});

test('keeps the arguments of a one-off command intact', async () => {
	const port = await freePort();
	await mkdir(join(root, 'web'));
	const serveCwd = `node -e "require('http').createServer((q, s) => s.end(process.cwd())).listen(process.env.PORT)"`;

	const options = { fetch, base: 'http://sandbox' };

	const line = ['sh', '-c', `cd web && ${serveCwd}`];
	expect((await cli(['run', 'web', '--port', String(port), '--', ...line], options)).code).toBe(0);
	expect(await (await fetch(`http://sandbox/preview/${port}/`)).text()).toEndWith('/web');
	await cli(['stop', 'web'], options);
});

test('reports the log tail when a service exits before its port opens', async () => {
	await expect(
		sandbox.services.start({
			name: 'broken',
			command: `printf '\\033[31mmissing\\033[0m module\\n'; exit 3`,
			port: await freePort()
		})
	).rejects.toThrow(/exited with code 3 before port \d+ opened:\nmissing module/);
});

test('reports a missing cwd as a failure of that service and keeps serving', async () => {
	const options = { fetch, base: 'http://sandbox' };
	await mkdir(join(root, '.agents'));
	await writeFile(
		join(root, '.agents/services.yml'),
		`services:\n  web:\n    command: ${server('hi')}\n    cwd: missing/dir\n    port: ${await freePort()}\n`
	);

	const started = await cli(['start', 'web'], options);
	expect(started.code).toBe(1);
	expect(started.output).toContain("web can't start: its cwd missing/dir");
	expect(started.output).toContain('is not a directory');
	expect((await cli(['run', 'api', '--port', '1', '--cwd', 'nope', '--', 'true'], options)).output)
		.toContain("api can't start: its cwd nope");

	const port = await freePort();
	expect(await sandbox.services.start({ name: 'ok', command: server('ok'), port })).toMatchObject({
		status: 'running'
	});
	expect(await (await fetch(`http://sandbox/preview/${port}/`)).text()).toBe('ok');
});

test('restart re-reads services.yml so edits take effect', async () => {
	const [before, after] = await Promise.all([freePort(), freePort()]);
	await mkdir(join(root, '.agents'));
	await mkdir(join(root, 'web'));
	const serve = `node -e "require('http').createServer((q, s) => s.end(process.env.GREETING + ' from ' + require('path').basename(process.cwd()))).listen(process.env.PORT)"`;
	const save = (port: number, cwd: string, greeting: string) =>
		writeFile(
			join(root, '.agents/services.yml'),
			`services:\n  web:\n    command: ${serve}\n    cwd: ${cwd}\n    port: ${port}\n    env:\n      GREETING: ${greeting}\n`
		);

	await save(before, '.', 'hi');
	await sandbox.services.start({ name: 'web' });
	expect(await (await fetch(`http://sandbox/preview/${before}/`)).text()).toStartWith('hi from ');

	await save(after, 'web', 'hello');
	expect(
		await cli(['restart', 'web'], { fetch, base: 'http://sandbox', preview: 'p1-{name}.regit.run' })
	).toEqual({ code: 0, output: `web  running  :${after}  saved  https://p1-web.regit.run` });
	expect(await (await fetch(`http://sandbox/preview/${after}/`)).text()).toBe('hello from web');
	expect((await fetch(`http://sandbox/preview/${before}/`)).status).toBe(502);
});

test('restarts running services in the new checkout when the workspace is recloned', async () => {
	const port = await freePort();
	const remote = async (message: string) => {
		const dir = await mkdtemp(join(tmpdir(), 'regit-remote-'));
		await mkdir(join(dir, '.agents'));
		await writeFile(
			join(dir, '.agents/services.yml'),
			`services:\n  web:\n    command: node server.js\n    port: ${port}\n`
		);
		await writeFile(
			join(dir, 'server.js'),
			`const fs = require('fs');
fs.mkdirSync('cache', { recursive: true });
setInterval(() => fs.writeFileSync('cache/' + Math.random(), ''), 2);
require('http').createServer((q, s) => s.end('${message}')).listen(process.env.PORT);\n`
		);
		await git(dir, ['init', '--initial-branch', 'main']);
		await git(dir, ['add', '.']);
		await git(dir, [
			'-c',
			'user.name=Sam',
			'-c',
			'user.email=sam@example.com',
			'commit',
			'-m',
			'init'
		]);
		return dir;
	};
	const clone = (remote: string) =>
		fetch('http://sandbox/workspace/clone', { method: 'POST', body: JSON.stringify({ remote }) });

	const [base, fork] = await Promise.all([remote('from base'), remote('from fork')]);
	expect((await clone(base)).status).toBe(200);
	await sandbox.services.start({ name: 'web' });
	expect(await (await fetch(`http://sandbox/preview/${port}/`)).text()).toBe('from base');

	expect((await clone(fork)).status).toBe(200);
	let served = '';
	for (let i = 0; i < 50 && served !== 'from fork'; i++) {
		await Bun.sleep(200);
		served = await fetch(`http://sandbox/preview/${port}/`)
			.then((response) => response.text())
			.catch(() => '');
	}
	expect(served).toBe('from fork');
	await Promise.all([base, fork].map((dir) => rm(dir, { recursive: true, force: true })));
});

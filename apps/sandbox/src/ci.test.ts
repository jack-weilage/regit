import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sandboxWorkspace, type JobRead } from '@regit/agent';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createSandbox } from './server.ts';

let root: string;
let sandbox: ReturnType<typeof createSandbox>;
const workspace = sandboxWorkspace((url, init) => sandbox(new Request(url, init)));

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'regit-jobs-'));
	sandbox = createSandbox(root, { jobs: join(root, '.jobs') });
});

afterEach(async () => {
	await sandbox.jobs.stopAll();
	await rm(root, { recursive: true, force: true });
});

async function finished(name: string) {
	let output = '';
	let read: JobRead = { status: 'running', exitCode: null, output: '', offset: 0 };
	while (read.status === 'running') {
		read = await workspace.readJob({ name, offset: read.offset });
		output += read.output;
		await Bun.sleep(20);
	}
	return { ...read, output };
}

test('runs a job in the background with its environment and reads its output incrementally', async () => {
	await workspace.startJob({
		name: 'deploy',
		command:
			'echo "start $SECRET $CI $(pwd)"; sleep 0.3; printf "\\x1b[32mdone ✓\\x1b[0m\\n"; exit 3',
		env: { SECRET: 'shh' }
	});
	const first = await workspace.readJob({ name: 'deploy' });
	expect(first.status).toBe('running');

	const done = await finished('deploy');
	expect(done).toMatchObject({ status: 'exited', exitCode: 3 });
	expect(done.output).toBe(`start shh true ${root}\ndone ✓\n`);
	expect(await workspace.readJob({ name: 'deploy', offset: done.offset })).toMatchObject({
		output: '',
		offset: done.offset
	});
	expect(await workspace.readJob({ name: 'missing' })).toMatchObject({ status: 'unknown' });
});

test('refuses a second run while one is going and stops the whole process group', async () => {
	await workspace.startJob({ name: 'deploy', command: 'sleep 30 & sleep 30; echo never' });
	await expect(workspace.startJob({ name: 'deploy', command: 'true' })).rejects.toThrow(
		'deploy is already running'
	);
	await workspace.stopJob('deploy');
	const stopped = await workspace.readJob({ name: 'deploy' });
	expect(stopped.status).toBe('exited');
	expect(stopped.output).not.toContain('never');

	await workspace.startJob({ name: 'deploy', command: 'echo again' });
	expect(await finished('deploy')).toMatchObject({ exitCode: 0, output: 'again\n' });
});

test('reads ordered CI steps in short and long form', async () => {
	expect(await workspace.ci()).toEqual({ steps: null });
	await mkdir(join(root, '.agents'));
	await writeFile(
		join(root, '.agents/ci.yml'),
		`# Runs on each commit that lands
steps:
  check: bun run check
  deploy:
    run: "bash .agents/deploy"
`
	);
	expect(await workspace.ci()).toEqual({
		steps: [
			{ name: 'check', command: 'bun run check' },
			{ name: 'deploy', command: 'bash .agents/deploy' }
		]
	});
	await writeFile(join(root, '.agents/ci.yml'), 'steps:\n  Prepare: true\n');
	await expect(workspace.ci()).rejects.toThrow('not Prepare');
	await writeFile(join(root, '.agents/ci.yml'), 'steps:\n');
	await expect(workspace.ci()).rejects.toThrow('steps must map step names to commands');
});

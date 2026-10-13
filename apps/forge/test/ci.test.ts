import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { CiRuns } from '@regit/core';
import { setup } from './support.ts';

const { dir, worker, sh, seed, commit } = await setup();

const sam = { id: 'owner', name: 'Sam', kind: 'person' as const };

async function ciRepo(name: string, files: Record<string, string>) {
	const work = await seed(name, files);
	const env = await worker.getEnv();
	await env.DB.prepare('INSERT INTO repos (name, created_at) VALUES (?, ?)')
		.bind(name, Date.now())
		.run();
	await env.DB.prepare('INSERT INTO repo_members (repo, principal_id, role) VALUES (?, ?, ?)')
		.bind(name, 'owner', 'owner')
		.run();
	const ci = env.CI.getByName(name);
	const push = (branch = 'main') => sh(work, 'push', '--quiet', join(dir, `${name}.git`), branch);
	const land = async (branch = 'main', headline = '') => {
		const after = sh(join(dir, `${name}.git`), 'rev-parse', branch);
		await ci.landed({ repo: name, ref: `refs/heads/${branch}`, after, headline });
		return after;
	};
	return { work, ci, push, land };
}

async function until(ci: { runs(): Promise<CiRuns> | CiRuns }, check: (runs: CiRuns) => boolean) {
	for (let i = 0; i < 300; i++) {
		const runs = await ci.runs();
		if (check(runs)) return runs;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`CI never got there: ${JSON.stringify(await ci.runs())}`);
}

const steps = (yaml: string) => ({ '.agents/ci.yml': `steps:\n${yaml}` });

test('runs the configured steps with secrets at commits that land on the default branch', async () => {
	const { work, ci, push, land } = await ciRepo(
		'ci',
		steps(`  check: echo "checked $(git rev-parse HEAD) on $REGIT_BRANCH"
  deploy:
    run: echo "deploying with $TOKEN after [$REGIT_LAST_PASSED_SHA]"
`)
	);
	await expect(ci.setSecret('TOKEN', 'shh', { ...sam, id: 'someone' })).rejects.toThrow();
	await expect(ci.setSecret('REGIT_SHA', 'x', sam)).rejects.toThrow();
	await ci.setSecret('TOKEN', 'shh', sam);
	expect(await ci.secrets()).toEqual(['TOKEN']);

	const first = await land('main', 'init');
	const passed = await until(ci, ({ runs }) => runs[0]?.status === 'passed');
	const [run] = passed.runs;
	expect(run).toMatchObject({
		sha: first,
		branch: 'main',
		headline: 'init',
		by: null,
		error: null
	});
	expect(run!.steps.map(({ name, status, exitCode }) => [name, status, exitCode])).toEqual([
		['Prepare', 'passed', null],
		['check', 'passed', 0],
		['deploy', 'passed', 0]
	]);
	expect(await ci.log(run!.id, 'Prepare')).toContain(
		'▸ Run .agents/setup\nThere is no .agents/setup'
	);
	expect(await ci.log(run!.id, 'check')).toBe(`checked ${first} on main\n`);
	expect(await ci.log(run!.id, 'deploy')).toBe('deploying with shh after []\n');

	await land('main');
	await new Promise((resolve) => setTimeout(resolve, 500));
	expect((await ci.runs()).runs).toHaveLength(1);

	sh(work, 'checkout', '--quiet', '-b', 'feature');
	await commit(work, { 'notes.md': 'Feature\n' }, 'Feature work');
	push('feature');
	await land('feature');
	await until(ci, ({ queued }) => !queued);

	sh(work, 'checkout', '--quiet', 'main');
	await commit(
		work,
		steps(`  check: echo broken >&2; exit 4
  deploy: echo never
`),
		'Break the check'
	);
	push();
	const broken = await land('main', 'Break the check');
	const failed = await until(ci, ({ runs }) => runs[0]?.status === 'failed');
	expect(failed.runs.map(({ sha, status }) => [sha, status])).toEqual([
		[broken, 'failed'],
		[first, 'passed']
	]);
	expect(failed.runs[0]).toMatchObject({ error: 'check exited with code 4' });
	expect(failed.runs[0]!.steps.map(({ status }) => status)).toEqual([
		'passed',
		'failed',
		'skipped'
	]);
	expect(await ci.log(failed.runs[0]!.id, 'check')).toBe('broken\n');

	await commit(work, { '.agents/ci.yml': 'steps:\n  Prepare: true\n' }, 'Misconfigure CI');
	push();
	await land('main');
	const invalid = await until(ci, ({ runs }) => runs.length === 3 && runs[0]!.status === 'failed');
	expect(invalid.runs[0]!.error).toContain('not Prepare');
});

test('queues the latest landing behind a running run, cancels and runs again', async () => {
	const { work, ci, push, land } = await ciRepo(
		'ci-queue',
		steps('  slow: echo "started $(git rev-parse --short HEAD)"; sleep 30\n')
	);
	const first = await land();
	const running = await until(ci, ({ runs }) => runs[0]?.steps[1]?.status === 'running');
	const id = running.runs[0]!.id;
	for (let i = 0; i < 100 && !(await ci.log(id, 'slow'))?.includes('started'); i++)
		await new Promise((resolve) => setTimeout(resolve, 100));
	expect(await ci.log(id, 'slow')).toBe(`started ${first.slice(0, 7)}\n`);

	await commit(work, { 'notes.md': 'Second\n' }, 'Second');
	push();
	const second = await land('main', 'Second');
	expect((await ci.runs()).queued).toEqual({ sha: second, branch: 'main', headline: 'Second' });

	await ci.cancel(id, sam);
	const next = await until(
		ci,
		({ runs, queued }) => !queued && runs[0]?.sha === second && runs[0].status === 'running'
	);
	expect(next.runs[1]).toMatchObject({ id, status: 'cancelled', error: 'Cancelled by Sam' });
	expect(next.runs[1]!.steps.map(({ status }) => status)).toEqual(['passed', 'cancelled']);

	await ci.cancel(next.runs[0]!.id, sam);
	await ci.rerun(id, sam);
	const again = await until(ci, ({ runs }) => runs.length === 3 && runs[0]?.status === 'running');
	expect(again.runs[0]).toMatchObject({ sha: first, by: 'Sam' });
	await ci.cancel(again.runs[0]!.id, sam);
});

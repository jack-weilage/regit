import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilMain, untilThread, writeNotes } from './support.ts';

const { dir, sandboxes, script, modelRequests, sh, commit, startedThread } = await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const titled = {
	'notes.md': '# Notes\n',
	'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
`
};
const shipInput = (by: { id: string; name: string; kind: 'person' }) => ({
	by,
	email: 'sam@example.com',
	title: 'docs: drop the title',
	body: ''
});
const events = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) => (entry.type === 'event' ? [entry.text] : []));

async function greenStart(name: string, steps: object[][], files: Record<string, string> = {}) {
	const started = await startedThread(name, steps, undefined, { ...titled, ...files });
	const seeded = sh(join(dir, `${name}.git`), 'rev-parse', 'main');
	await started.repo.landed({
		repo: name,
		ref: 'refs/heads/main',
		after: seeded,
		headline: 'init'
	});
	await untilMain(started.repo, (main) => main.green?.sha === seeded && !main.verifying);
	await untilThread(started.repo, started.id, (detail) => detail.summary.status === 'needs-you');
	return { ...started, seeded };
}

test('ships without waiting for checks, then hands a failure on main back to the thread that broke it', async () => {
	const { repo, sam, id, seeded } = await greenStart('broke-main', [
		writeNotes('No title\\n'),
		say('Done.')
	]);
	const canonical = join(dir, 'broke-main.git');
	await script('broke-main', [writeNotes('# Notes\\n\\nNo title\\n'), say('Restored the title.')]);

	await repo.ship(id, shipInput(sam));
	const red = await untilMain(repo, (main) => main.verified?.passed === false);
	const broken = red.verified!.sha;
	expect(sh(canonical, 'rev-parse', `${broken}^`)).toBe(seeded);
	expect(red.verified).toMatchObject({
		culprit: { sha: broken, headline: 'docs: drop the title', thread: id },
		results: [{ name: 'title', status: 'failed' }]
	});
	expect(red.green?.sha).toBe(seeded);

	const fixed = await untilMain(repo, (main) => main.green?.sha !== seeded, 180_000);
	expect(fixed.green?.sha).toBe(sh(canonical, 'rev-parse', 'main'));
	expect(sh(canonical, 'log', '--format=%s', 'main')).toBe(
		'Fix main after "docs: drop the title"\ndocs: drop the title\ninit'
	);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes\n\nNo title');
	const detail = await untilThread(
		repo,
		id,
		(detail) => detail.summary.shipped?.verdict === 'passed'
	);
	expect(events(detail)).toContain(
		`Deploy checks failed on main after this shipped as ${broken.slice(0, 7)}: title. Handing it back to the agent to fix.`
	);
	const notice = JSON.stringify((await modelRequests('broke-main')).at(-2)!.query);
	expect(notice).toContain('the deploy checks from .agents/checks.yml failed on `main`');
	expect(notice).toContain('## title (failed)');
});

test("reverts what a thread shipped when its agent can't fix what it broke", async () => {
	const { repo, sam, id, seeded } = await greenStart('unfixable', [
		writeNotes('No title\\n'),
		say('Done.')
	]);
	await script('unfixable', [say("I can't tell what's wrong.")]);

	await repo.ship(id, shipInput(sam));
	const canonical = join(dir, 'unfixable.git');
	const reverted = await untilThread(
		repo,
		id,
		(detail) => detail.summary.shipped?.verdict === 'reverted'
	);
	expect(reverted.summary.failure).toMatchObject({ title: 'Reverted' });
	expect(sh(canonical, 'log', '--format=%s', 'main')).toBe(
		'Revert "docs: drop the title"\ndocs: drop the title\ninit'
	);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
	const main = await untilMain(repo, (main) => main.green?.sha !== seeded);
	expect(main.green?.sha).toBe(sh(canonical, 'rev-parse', 'main'));
});

test('bisects to the commit that broke main, rules out flakes, and starts new threads from the last green commit', async () => {
	const { env, repo, sam, seeded } = await greenStart('bisecting', [say('Nothing to do.')], {
		'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [deploy]
  - name: flaky
    run: f="$(git rev-parse --git-common-dir)/flaked"; test -e "$f" && rm "$f" || { touch "$f"; exit 1; }
    when: [other.md]
    before: [deploy]
`
	});
	const work = join(dir, 'bisecting-work');
	const canonical = join(dir, 'bisecting.git');
	await commit(work, { 'other.md': 'Other\n' }, 'Add other notes');
	await commit(work, { 'notes.md': 'No title\n' }, 'Drop the title');
	const culprit = sh(work, 'rev-parse', 'HEAD');
	await commit(work, { 'more.md': 'More\n' }, 'Add more notes');
	sh(work, 'push', '--quiet', canonical, 'main');
	const tip = sh(canonical, 'rev-parse', 'main');

	await repo.landed({ repo: 'bisecting', ref: 'refs/heads/main', after: tip, headline: '' });
	const red = await untilMain(repo, (main) => main.verified?.sha === tip);
	expect(red.verified).toMatchObject({
		passed: false,
		culprit: { sha: culprit, headline: 'Drop the title', thread: null }
	});
	expect(red.verified!.results).toMatchObject([
		{ name: 'title', status: 'failed' },
		{ name: 'flaky', status: 'warned', output: expect.stringContaining('may be flaky') }
	]);
	expect(red.green?.sha).toBe(seeded);

	await script('bisecting', [say('Looked.')]);
	const { id } = await repo.openThread({
		repo: 'bisecting',
		author: sam,
		text: 'Look around.',
		mode: 'small',
		machine: 'standard-1'
	});
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	expect((await env.ATTEMPTS.getByName(id).revision())?.base).toBe(seeded);
	expect(sh(canonical, 'rev-parse', 'main')).toBe(tip);
});

test('checks only the newest of the commits that land while a check runs', async () => {
	const { repo, seeded } = await greenStart('queueing', [say('Nothing to do.')], {
		'.agents/checks.yml': `checks:
  - name: slow
    run: git rev-parse HEAD >> "$(git rev-parse --git-common-dir)/checked"; sleep 2
    before: [deploy]
`
	});
	const work = join(dir, 'queueing-work');
	const canonical = join(dir, 'queueing.git');
	const landed: string[] = [];
	for (const n of [1, 2, 3]) {
		await commit(work, { [`n${n}.md`]: `${n}\n` }, `Note ${n}`);
		sh(work, 'push', '--quiet', canonical, 'main');
		landed.push(sh(canonical, 'rev-parse', 'main'));
		await repo.landed({
			repo: 'queueing',
			ref: 'refs/heads/main',
			after: landed.at(-1)!,
			headline: ''
		});
	}
	await untilMain(repo, (main) => main.green?.sha === landed[2] && !main.verifying);
	const checked = await readFile(join(sandboxes!, 'main-queueing/.git/checked'), 'utf8');
	expect(checked.trim().split('\n')).toEqual([seeded, landed[0], landed[2]]);
});

import { join } from 'node:path';
import { expect, test } from 'vitest';
import type { ThreadDetail } from '@regit/core';
import { setup, untilThread, writeNotes } from './support.ts';

const { dir, script, modelRequests, scriptDecisions, decisionRequests, sh, commit, startedThread } =
	await setup();

const say = (delta: string) => [{ type: 'response.output_text.delta', delta }];
const shipInput = (by: { id: string; name: string; kind: 'person' }) => ({
	by,
	email: 'sam@example.com',
	title: 'docs: add a title',
	body: ''
});
const events = (detail: ThreadDetail) =>
	detail.entries.flatMap((entry) => (entry.type === 'event' ? [entry.text] : []));

test('a failing ship check hands the thread back, and it ships once the agent fixes it', async () => {
	const { repo, sam, id } = await startedThread(
		'ship-gate',
		[writeNotes('No title\\n'), say('Done.')],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: title
    run: grep -q '^# ' notes.md
    before: [ship]
`
		}
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const canonical = join(dir, 'ship-gate.git');
	const original = sh(canonical, 'rev-parse', 'main');

	await script('ship-gate', [writeNotes('# Notes\\n'), say('Fixed the title.')]);
	await repo.ship(id, shipInput(sam));
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');
	expect(events(shipped)).toEqual(
		expect.arrayContaining([
			'Ship checks: title failed',
			'Checks failed: title. Handing it back to the agent to fix.',
			'Ship checks: title passed'
		])
	);
	const notice = JSON.stringify((await modelRequests('ship-gate')).at(-2)!.query);
	expect(notice).toContain(
		'Shipping stopped because checks from .agents/checks.yml failed on this thread merged with main'
	);
	expect(notice).toContain('## title (failed)\\nexit code 1');
	expect(sh(canonical, 'rev-parse', 'main^')).toBe(original);
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
});

test('checks the thread merged with the main it ships onto, and advisory warnings do not block', async () => {
	const { repo, sam, id } = await startedThread(
		'ship-merged',
		[writeNotes('# Notes\\n'), say('Done.')],
		undefined,
		{
			'.agents/checks.yml': `checks:
  - name: merged
    run: grep -q Main main.md && grep -q '^# ' notes.md
    before: [ship]
  - name: docs
    ask: Changes to notes come with a changelog entry
    before: [ship]
`
		}
	);
	await untilThread(repo, id, (detail) => detail.summary.status === 'needs-you');
	const work = join(dir, 'ship-merged-work');
	await commit(work, { 'main.md': 'Main\n' }, 'Main moved');
	sh(work, 'push', '--quiet', join(dir, 'ship-merged.git'), 'main');

	await scriptDecisions('ship-merged', [
		{ answers: { holds: { probabilities: { yes: 0.1, no: 0.9 } } } }
	]);
	await repo.ship(id, shipInput(sam));
	const shipped = await untilThread(repo, id, (detail) => detail.summary.status === 'shipped');
	expect(events(shipped)).toContain('Ship checks: merged passed, docs warned');
	expect(shipped.summary.checks).toMatchObject({
		action: 'ship',
		results: [
			{ name: 'merged', status: 'passed' },
			{ name: 'docs', kind: 'ask', status: 'warned' }
		]
	});
	const [asked] = await decisionRequests('ship-merged');
	expect(asked!.state).toMatchObject({ check: 'Changes to notes come with a changelog entry' });
	expect(JSON.stringify(asked!.state)).toContain('+# Notes');
	expect(JSON.stringify(asked!.state)).not.toContain('main.md');
	const canonical = join(dir, 'ship-merged.git');
	expect(sh(canonical, 'show', 'main:notes.md')).toBe('# Notes');
	expect(sh(canonical, 'show', 'main:main.md')).toBe('Main');
});

import { describe, expect, test } from 'bun:test';
import {
	askRequest,
	askVerdict,
	brokeMainNotice,
	checksNotice,
	checksTone,
	describeChecks,
	evidenceKey,
	missingIntent,
	runChecks,
	type Evidence
} from './checks.ts';
import type { PlannedCheck } from './sandbox/protocol.ts';

const check = (overrides: Partial<PlannedCheck>): PlannedCheck => ({
	name: 'tests',
	run: 'bun test',
	before: ['handoff', 'deploy'],
	blocking: true,
	applies: true,
	inputsHash: 'tree-1',
	...overrides
});

function memory(): Evidence & { keys: Set<string> } {
	const keys = new Set<string>();
	return { keys, passed: (key) => keys.has(key), record: (key) => void keys.add(key) };
}

describe('running checks', () => {
	test('runs only checks due for the action that apply to the change', async () => {
		const ran: string[] = [];
		const results = await runChecks({
			checks: [
				check({ name: 'types' }),
				check({ name: 'deploy-only', before: ['deploy'] }),
				check({ name: 'untouched', applies: false })
			],
			action: 'handoff',
			environment: 'bun 1.4',
			evidence: memory(),
			run: async ({ name }) => (ran.push(name), { ok: true, output: 'exit code 0' }),
			ask: async () => ({ ok: true, output: '' })
		});
		expect(ran).toEqual(['types']);
		expect(results).toEqual([
			{ name: 'types', kind: 'run', status: 'passed', reused: false, output: 'exit code 0' }
		]);
	});

	test('reuses a pass while its inputs and environment are unchanged, but reruns failures', async () => {
		const evidence = memory();
		let calls = 0;
		const once = (overrides: Partial<PlannedCheck>, environment = 'bun 1.4', ok = true) =>
			runChecks({
				checks: [check(overrides)],
				action: 'deploy',
				environment,
				evidence,
				run: async () => (calls++, { ok, output: ok ? 'exit code 0' : 'exit code 1' }),
				ask: async () => ({ ok: true, output: '' })
			});
		await once({});
		expect((await once({ name: 'renamed' }))[0]).toMatchObject({ status: 'passed', reused: true });
		expect(calls).toBe(1);
		await once({ inputsHash: 'tree-2' });
		await once({}, 'bun 1.5');
		await once({ run: 'bun test --bail' });
		expect(calls).toBe(4);
		expect((await once({ inputsHash: 'tree-3' }, 'bun 1.4', false))[0]!.status).toBe('failed');
		await once({ inputsHash: 'tree-3' }, 'bun 1.4', false);
		expect(calls).toBe(6);
	});

	test('fails blocking checks and only warns for advisory ones', async () => {
		const results = await runChecks({
			checks: [
				check({ name: 'tests' }),
				check({ name: 'lint', blocking: false }),
				check({ name: 'docs', run: undefined, ask: 'Docs are updated', blocking: false })
			],
			action: 'handoff',
			environment: '',
			evidence: memory(),
			run: async ({ name }) => ({
				ok: false,
				output: 'exit code 1',
				log: `.git/regit-checks/${name}.log`
			}),
			ask: async () => ({ ok: false, output: '90% likely that the change breaks this check' })
		});
		expect(results.map(({ name, kind, status }) => [name, kind, status])).toEqual([
			['tests', 'run', 'failed'],
			['lint', 'run', 'warned'],
			['docs', 'ask', 'warned']
		]);
		expect(describeChecks('handoff', results)).toBe(
			'Checks: tests failed, lint warned, docs warned'
		);
		expect(describeChecks('deploy', results.slice(0, 1))).toBe('Deploy checks: tests failed');
		expect(checksTone(results)).toBe('danger');
		expect(checksTone(results.slice(1))).toBe('warning');
		expect(checksTone([])).toBeUndefined();
		const notice = checksNotice(results)!;
		expect(notice).toContain('- tests: failed\n- lint: warned\n- docs: warned\n');
		expect(notice).toContain(
			'## tests (failed)\nFull log: .git/regit-checks/tests.log\nexit code 1'
		);
		expect(notice).toContain(
			'## docs (warning, not blocking)\n90% likely that the change breaks this check'
		);
		expect(notice).toContain('reply without changing files and the thread hands off');
		expect(checksNotice(results.slice(1))).toBeNull();

		const broke = brokeMainNotice({ branch: 'main', sha: 'a'.repeat(40), results });
		expect(broke).toContain('After this thread shipped as aaaaaaa, the deploy checks');
		expect(broke).toContain('## tests (failed)\nFull log: .git/regit-checks/tests.log');
		expect(broke).toContain('the commit is reverted instead');
	});

	test('gives {intent} rules the intent, rerunning them when it changes', async () => {
		const evidence = memory();
		const asked: (string | undefined)[] = [];
		let lookups = 0;
		const once = (intent: { headline: string; purpose: string; doneWhen: string[] } | null) =>
			runChecks({
				checks: [
					check({ name: 'scope', run: undefined, ask: 'The change does what {intent} says' }),
					check({ name: 'docs', run: undefined, ask: 'Docs are updated' }),
					check({ name: 'focus', run: undefined, ask: 'Nothing outside {intent} changed' })
				],
				action: 'handoff',
				environment: '',
				evidence,
				intent: async () => (lookups++, intent),
				run: async () => ({ ok: true, output: '' }),
				ask: async (_, context) => (asked.push(context), { ok: true, output: '' })
			});
		const intent = {
			headline: 'fix: a',
			purpose: 'Because.',
			doneWhen: ['It works', 'Tests pass']
		};

		await once(intent);
		expect(lookups).toBe(1);
		expect(asked).toEqual([
			'fix: a\n\nBecause.\n\nDone when:\n- It works\n- Tests pass',
			undefined,
			'fix: a\n\nBecause.\n\nDone when:\n- It works\n- Tests pass'
		]);
		expect((await once(intent)).every(({ reused }) => reused)).toBe(true);
		await once({ ...intent, purpose: 'Changed.' });
		expect(asked).toHaveLength(5);
	});

	test('fails or warns {intent} rules when the thread has no intent', async () => {
		const results = await runChecks({
			checks: [
				check({ name: 'scope', run: undefined, ask: 'Matches {intent}', blocking: true }),
				check({ name: 'focus', run: undefined, ask: 'Only {intent}', blocking: false })
			],
			action: 'handoff',
			environment: '',
			evidence: memory(),
			intent: async () => null,
			run: async () => ({ ok: true, output: '' }),
			ask: async () => {
				throw new Error('should not ask without an intent');
			}
		});
		expect(results.map(({ status, output }) => [status, output])).toEqual([
			['failed', missingIntent],
			['warned', missingIntent]
		]);
	});

	test('keys evidence by command, inputs and environment', async () => {
		const key = await evidenceKey(check({}), 'env');
		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(await evidenceKey(check({ name: 'other', blocking: false }), 'env')).toBe(key);
		expect(await evidenceKey(check({ inputsHash: 'tree-2' }), 'env')).not.toBe(key);
	});
});

describe('asking about a change', () => {
	test('asks whether the diff satisfies the check and fails it when it likely breaks', () => {
		const request = askRequest('Public API changes update the docs', 'x'.repeat(70_000));
		expect(request.state).toMatchObject({ check: 'Public API changes update the docs' });
		expect((request.state as { change: string }).change).toEndWith('… truncated');
		expect(Object.keys(request.questions.holds!.criteria)).toEqual(['yes', 'no']);
		expect(askVerdict({ answers: { holds: { probabilities: { yes: 0.2, no: 0.8 } } } })).toEqual({
			ok: false,
			output: '80% likely that the change breaks this check'
		});
		expect(askVerdict({ answers: { holds: { probabilities: { yes: 0.7, no: 0.3 } } } }).ok).toBe(
			true
		);
		expect(askVerdict({ answers: {} }).ok).toBe(true);
	});

	test('refers {intent} to the intent, passed as data', () => {
		const request = askRequest('The change does what {intent} says', 'diff', 'fix: a');
		expect(request.state).toEqual({
			change: 'diff',
			check: 'The change does what `intent` says',
			intent: 'fix: a'
		});
		expect(request.questions.holds!.instructions).toContain('`intent` is what the change');
		expect(askRequest('Docs are updated', 'diff').state).toEqual({
			change: 'diff',
			check: 'Docs are updated'
		});
	});
});

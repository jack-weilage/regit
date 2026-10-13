import { describe, expect, test } from 'bun:test';
import {
	askRequest,
	askVerdict,
	brokeMainNotice,
	checksNotice,
	describeChecks,
	evidenceKey,
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
});

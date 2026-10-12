import { describe, expect, test } from 'vitest';
import { StepActivity, toolTarget } from './activity.ts';

const call = (id: string, name: string, args: object) =>
	({ type: 'call', call: { id, name, arguments: JSON.stringify(args) } }) as const;
const result = (callId: string, output: string) =>
	({ type: 'result', result: { callId, output } }) as const;

describe('toolTarget', () => {
	test('names what each tool works on', () => {
		expect(toolTarget('read_file', '{"path":"src/a.ts"}')).toBe('src/a.ts');
		expect(toolTarget('find_files', '{"pattern":"**/*.svelte"}')).toBe('**/*.svelte');
		expect(toolTarget('run', '{"command":"bun run check"}')).toBe('bun run check');
		expect(toolTarget('update_intent', '{"headline":"fix: x"}')).toBe('fix: x');
		expect(toolTarget('run', 'not json')).toBe('');
	});

	test('keeps long commands to their first line', () => {
		expect(toolTarget('run', JSON.stringify({ command: 'cd a\nbun test' }))).toBe('cd a …');
	});
});

describe('StepActivity', () => {
	test('streams text and times tool calls until the step ends', () => {
		let now = 1000;
		const activity = new StepActivity(() => now);

		activity.apply({ type: 'text', delta: 'Checking ' });
		activity.apply({ type: 'text', delta: 'it.' });
		activity.apply(call('a', 'read_file', { path: 'src/a.ts' }));
		activity.apply(call('b', 'run', { command: 'bun test' }));
		now = 1400;
		activity.apply(result('a', 'export const a = 1;'));

		expect(activity.text).toBe('Checking it.');
		expect(activity.calls).toEqual([
			{
				id: 'a',
				tool: 'read_file',
				target: 'src/a.ts',
				status: 'done',
				startedAt: 1000,
				finishedAt: 1400
			},
			{ id: 'b', tool: 'run', target: 'bun test', status: 'running', startedAt: 1000 }
		]);

		now = 9000;
		activity.apply(result('b', 'exit code 0\n3 pass'));
		expect(activity.take()).toEqual([
			expect.objectContaining({ id: 'a' }),
			expect.objectContaining({
				id: 'b',
				status: 'done',
				finishedAt: 9000,
				output: 'exit code 0\n3 pass'
			})
		]);
		expect(activity.text).toBe('');
		expect(activity.calls).toEqual([]);
	});

	test('marks errors, failing commands and timeouts as failed, keeping their output', () => {
		const activity = new StepActivity(() => 0);
		activity.apply(call('a', 'edit_file', { path: 'a.ts' }));
		activity.apply(call('b', 'run', { command: 'bun test' }));
		activity.apply(call('c', 'run', { command: 'sleep 999' }));
		activity.apply(call('d', 'search', { pattern: 'x' }));
		activity.apply(result('a', 'Error: old_string was not found'));
		activity.apply(result('b', 'exit code 1\n1 fail'));
		activity.apply(result('c', 'timed out after 120s'));
		activity.apply(result('d', 'a.ts:1: x'));

		expect(activity.calls.map(({ status, output }) => ({ status, output }))).toEqual([
			{ status: 'failed', output: 'Error: old_string was not found' },
			{ status: 'failed', output: 'exit code 1\n1 fail' },
			{ status: 'failed', output: 'timed out after 120s' },
			{ status: 'done', output: undefined }
		]);
	});

	test('keeps the end of long command output', () => {
		const activity = new StepActivity(() => 0);
		activity.apply(call('a', 'run', { command: 'bun test' }));
		activity.apply(result('a', `exit code 0\n${'x'.repeat(10_000)}done`));
		const output = activity.calls[0]!.output!;
		expect(output.length).toBeLessThanOrEqual(4000);
		expect(output.endsWith('done')).toBe(true);
	});
});

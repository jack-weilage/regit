import type { CheckAction, CheckResult } from '@regit/core';
import type { PlannedCheck } from './sandbox/protocol.ts';
import type { JevRequest, JevResponse } from './similar.ts';

// Passing results, keyed by what they depend on, so unchanged checks aren't run again.
export interface Evidence {
	passed(key: string): boolean;
	record(key: string): void;
}

export interface CheckOutcome {
	ok: boolean;
	output: string;
	log?: string;
}

export interface RunChecksInput {
	checks: PlannedCheck[];
	action: CheckAction;
	signal?: AbortSignal;
	environment: string;
	evidence: Evidence;
	run(check: PlannedCheck): Promise<CheckOutcome>;
	ask(check: PlannedCheck): Promise<CheckOutcome>;
}

export const maxAskDiffChars = 60_000;

export const dueChecks = (checks: PlannedCheck[], action: CheckAction) =>
	checks.filter((check) => check.applies && check.before.includes(action));

export async function evidenceKey(check: PlannedCheck, environment: string) {
	const subject = JSON.stringify([check.run ?? check.ask, check.inputsHash, environment]);
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function runChecks({
	checks,
	action,
	signal,
	environment,
	evidence,
	run,
	ask
}: RunChecksInput): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	for (const check of dueChecks(checks, action)) {
		if (signal?.aborted) break;
		const kind = check.run ? 'run' : 'ask';
		const key = await evidenceKey(check, environment);
		if (evidence.passed(key)) {
			results.push({ name: check.name, kind, status: 'passed', reused: true, output: '' });
			continue;
		}
		const { ok, output, log } = await (check.run ? run(check) : ask(check));
		if (ok) evidence.record(key);
		const status = ok ? 'passed' : check.blocking ? 'failed' : 'warned';
		results.push({ name: check.name, kind, status, reused: false, output, ...(log && { log }) });
	}
	return results;
}

export function askRequest(question: string, diff: string): JevRequest {
	const change =
		diff.length > maxAskDiffChars ? `${diff.slice(0, maxAskDiffChars)}\n… truncated` : diff;
	return {
		state: { change, check: question },
		questions: {
			holds: {
				type: 'choice',
				instructions: 'Does `change`, a diff, satisfy `check`? Judge only what the diff shows.',
				criteria: {
					yes: 'The change satisfies the check, or the check does not apply to it',
					no: 'The change breaks the check'
				}
			}
		}
	};
}

export function askVerdict({ answers }: JevResponse): CheckOutcome {
	const breaks = answers.holds?.probabilities?.no ?? 0;
	return {
		ok: breaks < 0.5,
		output: `${Math.round(breaks * 100)}% likely that the change breaks this check`
	};
}

export const blockingFailures = (results: CheckResult[]) =>
	results.filter((result) => result.status === 'failed');

export function describeChecks(action: CheckAction, results: CheckResult[]) {
	const label = action === 'deploy' ? 'Deploy checks' : 'Checks';
	const parts = results.map(
		({ name, status, reused }) => `${name} ${status}${reused ? ' (unchanged)' : ''}`
	);
	return `${label}: ${parts.join(', ')}`;
}

function failureSections(results: CheckResult[]) {
	const summary = results.map(
		({ name, status, reused }) => `- ${name}: ${status}${reused ? ' (unchanged)' : ''}`
	);
	const sections = results
		.filter(({ status }) => status !== 'passed')
		.map(({ name, status, output, log }) =>
			[
				`## ${name} (${status === 'failed' ? 'failed' : 'warning, not blocking'})`,
				...(log ? [`Full log: ${log}`] : []),
				output
			].join('\n')
		);
	return `${summary.join('\n')}\n\n${sections.join('\n\n')}`;
}

// What the agent is told when handoff checks fail: every result, then the end of each failure's output and where its full log is.
export function checksNotice(results: CheckResult[]) {
	if (!blockingFailures(results).length) return null;
	return `Checks from .agents/checks.yml that must pass before you hand off failed.\n${failureSections(results)}\n\nRead or search a full log when its end isn't enough. Fix the failures, then reply with the outcome. If you stopped on purpose, to ask the person something or because the work isn't finished, reply without changing files and the thread hands off with these failures shown.`;
}

// What a shipped thread's agent is told when main's deploy checks fail and the failure was traced to its commit.
export function brokeMainNotice({
	branch,
	sha,
	results
}: {
	branch: string;
	sha: string;
	results: CheckResult[];
}) {
	return `After this thread shipped as ${sha.slice(0, 7)}, the deploy checks from .agents/checks.yml failed on \`${branch}\`, and bisecting traced the failure to that commit. Nothing deploys until \`${branch}\` passes again.\n${failureSections(results)}\n\nThese logs are from ReGit's checkout of \`${branch}\`, not your workspace, so run the failing checks yourself to reproduce them. Fix the cause on top of what shipped, then reply with the outcome; the fix ships as soon as you finish. If you can't fix it, reply without changing files and the commit is reverted instead.`;
}

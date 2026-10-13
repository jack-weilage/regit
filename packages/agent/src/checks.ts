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
	environment,
	evidence,
	run,
	ask
}: RunChecksInput): Promise<CheckResult[]> {
	const results: CheckResult[] = [];
	for (const check of dueChecks(checks, action)) {
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
	const label = action === 'ship' ? 'Ship checks' : 'Checks';
	const parts = results.map(
		({ name, status, reused }) => `${name} ${status}${reused ? ' (unchanged)' : ''}`
	);
	return `${label}: ${parts.join(', ')}`;
}

// What the agent is told when checks it must pass fail: every result, then the end of each failure's output and where its full log is.
export function checksNotice(action: CheckAction, results: CheckResult[]) {
	const failed = blockingFailures(results);
	if (!failed.length) return null;
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
	const intro =
		action === 'ship'
			? 'Shipping stopped because checks from .agents/checks.yml failed on this thread merged with main.'
			: 'Checks from .agents/checks.yml that must pass before you hand off failed.';
	const next =
		action === 'ship'
			? 'Fix the failures; the thread ships again once you finish.'
			: 'Fix the failures, then reply with the outcome.';
	return `${intro}\n${summary.join('\n')}\n\n${sections.join('\n\n')}\n\nRead or search a full log when its end isn't enough. ${next}`;
}

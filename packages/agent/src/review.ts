import type { Intent } from './intent.ts';
import { runAgent } from './loop.ts';
import { combineTools } from './tools.ts';
import type { ModelClient, ToolExecutor, Usage } from './types.ts';

export type CheckVerdict = 'met' | 'unmet' | 'unverified';

export interface Review {
	verdict: 'pass' | 'fail' | 'needs-human';
	checks: { state: CheckVerdict; evidence: string }[];
	findings: string[];
}

const instructions = `You review a coding agent's work against the intent it was given. You have a read-only clone of the repository with the agent's commits on top of the commit the work started from.

- Inspect the change with git: git diff <base>, git log <base>..HEAD.
- Decide each done-when item: met, unmet, or unverified. Re-run the repository's own checks (tests, lint, type checks) yourself instead of trusting the agent's summary. Use unverified only when the sandbox truly cannot check an item, such as one that needs an external service or a device, and say why.
- Treat gaming as unmet: tests weakened or deleted to pass, checks skipped, scope quietly dropped, or unrelated changes.
- findings: concrete problems the agent must fix, each one sentence. No style nitpicks.
- verdict: pass when every item is met and nothing blocking was found; needs-human when an item cannot be decided in the sandbox or the intent is ambiguous; otherwise fail.

Never edit files. Call submit_review exactly once when you are done.`;

const verdicts = ['pass', 'fail', 'needs-human'] as const;
const states = ['met', 'unmet', 'unverified'] as const;

const submit = {
	name: 'submit_review',
	description: 'Submit the review. Call exactly once.',
	parameters: {
		type: 'object',
		properties: {
			checks: {
				type: 'array',
				description: 'One entry per done-when item, in order',
				items: {
					type: 'object',
					properties: {
						state: { type: 'string', enum: states },
						evidence: { type: 'string', description: 'What you ran or read that decided it' }
					},
					required: ['state', 'evidence']
				}
			},
			findings: { type: 'array', items: { type: 'string' } },
			verdict: { type: 'string', enum: verdicts }
		},
		required: ['checks', 'findings', 'verdict']
	}
};

export interface ReviewOptions {
	model: ModelClient;
	tools: ToolExecutor;
	intent: Intent;
	base: string | null;
	summary: string;
	maxSteps?: number;
	signal?: AbortSignal;
}

export async function reviewIntent({
	model,
	tools,
	intent,
	base,
	summary,
	maxSteps = 40,
	signal
}: ReviewOptions) {
	let review: Review | undefined;
	const usage: Usage[] = [];
	const submitter: ToolExecutor = {
		specs: [submit],
		async execute(call) {
			review = parseReview(call.arguments, intent.doneWhen.length);
			return 'Submitted.';
		}
	};
	const checks = intent.doneWhen.map((check, index) => `${index + 1}. ${check}`).join('\n');
	const task = `Intent: ${intent.headline}\n\n${intent.purpose}\n\nDone when:\n${checks}\n\nThe work started from commit ${base ?? 'unknown (use git log)'}.\n\nThe agent's summary:\n${summary || '(none)'}`;

	for await (const event of runAgent({
		model,
		tools: combineTools(tools, submitter),
		instructions,
		history: [{ role: 'user', text: task }],
		maxSteps,
		signal
	})) {
		if (event.type !== 'step') continue;
		if (event.usage) usage.push(event.usage);
		if (review) break;
	}
	if (!review) throw new Error('The reviewer did not submit a review');
	return { review, usage };
}

function parseReview(json: string, count: number): Review {
	const raw = JSON.parse(json) as Partial<{
		checks: { state?: string; evidence?: string }[];
		findings: unknown[];
		verdict: string;
	}>;
	const checks = Array.from({ length: count }, (_, index) => {
		const check = raw.checks?.[index];
		const state = states.find((value) => value === check?.state) ?? 'unverified';
		return { state, evidence: String(check?.evidence ?? '').trim() };
	});
	const verdict = verdicts.find((value) => value === raw.verdict) ?? 'needs-human';
	const findings = (raw.findings ?? []).map((finding) => String(finding).trim()).filter(Boolean);
	const blocked = checks.some((check) => check.state === 'unmet')
		? 'fail'
		: checks.some((check) => check.state === 'unverified')
			? 'needs-human'
			: null;
	return { verdict: verdict === 'pass' && blocked ? blocked : verdict, checks, findings };
}

export function reviewFeedback(intent: Intent, review: Review) {
	const labels = { met: 'met', unmet: 'not met', unverified: "couldn't be checked" };
	const checks = intent.doneWhen
		.map((check, index) => {
			const { state, evidence } = review.checks[index]!;
			return `- [${labels[state]}] ${check}${evidence && state !== 'met' ? `: ${evidence}` : ''}`;
		})
		.join('\n');
	const findings = review.findings.map((finding) => `- ${finding}`).join('\n');
	return `A reviewer checked your work against the intent and sent it back.\n\nDone when:\n${checks}${findings ? `\n\nFindings:\n${findings}` : ''}\n\nFix these, re-run the checks, then finish with a summary.`;
}

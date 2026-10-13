import type { DoneWhenStatus } from '@regit/core';
import type { ToolExecutor, ToolSpec } from './types.ts';

export interface Intent {
	headline: string;
	purpose: string;
	doneWhen: string[];
}

export interface DoneWhenReport {
	check: number;
	status: DoneWhenStatus;
	evidence: string;
}

export const intentParameters = {
	type: 'object',
	properties: {
		headline: {
			type: 'string',
			description:
				'A conventional commit summary such as "fix(settings): load members lazily", at most 72 characters'
		},
		purpose: {
			type: 'string',
			description: 'One or two plain sentences on why the change matters'
		},
		doneWhen: {
			type: 'array',
			items: { type: 'string' },
			description: 'One to five concrete, checkable conditions that mean the work is finished'
		}
	},
	required: ['headline', 'purpose', 'doneWhen']
};

const statuses: DoneWhenStatus[] = ['met', 'unmet', 'unverified'];
const maxEvidenceChars = 500;

const specs: ToolSpec[] = [
	{
		name: 'update_intent',
		description:
			"Record what this thread is doing: the change, why it matters and when it's done. Call it once the goal of the work is clear and again whenever it changes. People read it to follow the thread, and other agents use it to spot duplicate or overlapping work and to understand the changes later.",
		parameters: intentParameters
	},
	{
		name: 'record_done_when',
		description:
			"Record what you found for the intent's done-when checks after verifying them. People see each check's status before shipping. Results apply to the files as they are now, so record again after changing files.",
		parameters: {
			type: 'object',
			properties: {
				results: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							check: {
								type: 'integer',
								description: 'The done-when check, numbered from 1 in the order of the intent'
							},
							status: {
								type: 'string',
								enum: statuses,
								description:
									'met or unmet when you observed it, unverified when you could not check it'
							},
							evidence: {
								type: 'string',
								description:
									'What established it: the command and decisive output, or what you inspected. For unverified, why it could not be checked.'
							}
						},
						required: ['check', 'status', 'evidence']
					}
				}
			},
			required: ['results']
		}
	}
];

export function intentTools({
	update,
	record
}: {
	update: (intent: Intent) => void | Promise<void>;
	record: (results: DoneWhenReport[]) => string | Promise<string>;
}): ToolExecutor {
	return {
		specs,
		async execute(call) {
			if (call.name === 'record_done_when') {
				const { results = [] } = JSON.parse(call.arguments) as { results?: DoneWhenReport[] };
				if (results.some((result) => !statuses.includes(result.status)))
					return `Error: status must be one of ${statuses.join(', ')}`;
				return await record(
					results.map(({ check, status, evidence }) => ({
						check,
						status,
						evidence: (evidence ?? '').trim().slice(0, maxEvidenceChars)
					}))
				);
			}
			const { headline, purpose, doneWhen } = JSON.parse(call.arguments) as Intent;
			await update({
				headline: headline.trim(),
				purpose: purpose.trim(),
				doneWhen: doneWhen.map((check) => check.trim()).filter(Boolean)
			});
			return 'Recorded the intent.';
		}
	};
}

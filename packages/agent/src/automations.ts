import { describeTrigger, threadEvents, type Automation } from '@regit/core';
import type { ToolExecutor, ToolSpec } from './types.ts';

export interface AutomationControl {
	create(spec: unknown): Promise<Automation>;
	list(): Promise<Automation[]>;
	cancel(id: string): Promise<Automation>;
}

const specs: ToolSpec[] = [
	{
		name: 'create_automation',
		description:
			'Schedule a message to this thread, which you then act on: after this thread ships, passes main\'s checks, deploys, fails or is reverted, at a time, after a delay or on a schedule. Use it when a person asks you to check on something later, such as "check on these changes after they deploy". It can only message this thread, and ends after its runs or when it expires, whichever comes first.',
		parameters: {
			type: 'object',
			properties: {
				name: { type: 'string', description: 'A short name, such as post-deploy-check' },
				on: {
					type: 'object',
					description:
						'When it runs: exactly one of event, at, after or schedule (with an optional timezone)',
					properties: {
						event: {
							type: 'string',
							enum: [...threadEvents],
							description: "A moment in what this thread shipped's life"
						},
						at: {
							type: 'string',
							description: 'An ISO 8601 time with a zone, such as 2026-11-01T09:00Z'
						},
						after: { type: 'string', description: 'A duration from now, such as 30m, 2h or 3d' },
						schedule: {
							type: 'string',
							description: 'A five-field cron schedule, such as "0 9 * * 1-5"'
						},
						timezone: {
							type: 'string',
							description:
								'An IANA time zone for the schedule, such as Europe/Berlin; UTC by default'
						}
					}
				},
				delay: {
					type: 'string',
					description:
						'For an event: how long to wait after it before running, such as 15m to let a deploy settle'
				},
				message: {
					type: 'string',
					description:
						'What you will be told when it runs: what to check or do, written for yourself later'
				},
				expires: {
					type: 'object',
					description:
						'When it ends, whichever comes first. Without either, an event, at or after runs once and a schedule ends after 7 days. At most 50 runs and 30 days.',
					properties: {
						runs: { type: 'integer', minimum: 1, maximum: 50 },
						after: { type: 'string', description: 'A duration such as 7d, or an ISO 8601 time' }
					}
				}
			},
			required: ['name', 'on', 'message']
		}
	},
	{
		name: 'list_automations',
		description: "List this thread's automations: active ones, then recently ended ones.",
		parameters: { type: 'object', properties: {} }
	},
	{
		name: 'cancel_automation',
		description: "Cancel one of this thread's automations so it stops running.",
		parameters: {
			type: 'object',
			properties: { id: { type: 'string', description: 'The id, from list_automations' } },
			required: ['id']
		}
	}
];

function time(at: number) {
	return new Date(at).toISOString().replace(/:\d{2}\.\d{3}Z$/, 'Z');
}

export function describeAutomation(automation: Automation) {
	const { id, name, on, delayMs, runs, nextAt, expiresAt, ended } = automation;
	const when = describeTrigger(on, delayMs);
	const progress = `${runs.done} of ${runs.limit} runs`;
	if (ended)
		return `${id} · ${name} · ${when} · ${progress} · ended (${ended.reason}) ${time(ended.at)}`;
	const next = nextAt === null ? 'waiting for the event' : `next ${time(nextAt)}`;
	return `${id} · ${name} · ${when} · ${progress} · ${next} · expires ${time(expiresAt)}`;
}

export function automationTools(control: AutomationControl): ToolExecutor {
	return {
		specs,
		async execute(call) {
			if (call.name === 'list_automations') {
				const automations = await control.list();
				if (!automations.length) return 'This thread has no automations.';
				return automations.map(describeAutomation).join('\n');
			}
			if (call.name === 'cancel_automation') {
				const { id } = JSON.parse(call.arguments) as { id?: string };
				if (!id?.trim()) throw new Error('Say which automation to cancel');
				return `Cancelled: ${describeAutomation(await control.cancel(id.trim()))}`;
			}
			const automation = await control.create(JSON.parse(call.arguments));
			return `Set up: ${describeAutomation(automation)}. It messages this thread when it runs.`;
		}
	};
}

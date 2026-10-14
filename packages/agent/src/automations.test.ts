import { expect, test } from 'bun:test';
import type { Automation } from '@regit/core';
import { automationTools } from './automations.ts';

const automation: Automation = {
	id: 'a1b2c3d4',
	thread: 't1',
	name: 'post-deploy-check',
	on: { event: 'deployed' },
	delayMs: 15 * 60_000,
	message: 'Check error rates.',
	runs: { done: 0, limit: 1 },
	createdAt: Date.parse('2026-10-14T10:00:00Z'),
	expiresAt: Date.parse('2026-11-13T10:00:00Z'),
	nextAt: null,
	lastRunAt: null,
	ended: null
};

test('passes what the agent asked for to the coordinator and says when it runs', async () => {
	const created: unknown[] = [];
	const tools = automationTools({
		create: async (spec) => {
			created.push(spec);
			return automation;
		},
		list: async () => [],
		cancel: async () => automation
	});
	expect(tools.specs.map((spec) => spec.name)).toEqual([
		'create_automation',
		'list_automations',
		'cancel_automation'
	]);
	const spec = {
		name: 'post-deploy-check',
		on: { event: 'deployed' },
		delay: '15m',
		message: 'Check error rates.'
	};
	const output = await tools.execute({
		id: 'c1',
		name: 'create_automation',
		arguments: JSON.stringify(spec)
	});
	expect(created).toEqual([spec]);
	expect(output).toBe(
		'Set up: a1b2c3d4 · post-deploy-check · 15m after what this thread shipped deploys · 0 of 1 runs · waiting for the event · expires 2026-11-13T10:00Z. It messages this thread when it runs.'
	);
});

test('lists active and ended automations and cancels by id', async () => {
	const cancelled: string[] = [];
	const ended = {
		...automation,
		id: 'e5f6',
		name: 'daily',
		on: { schedule: '0 9 * * *' },
		delayMs: 0,
		runs: { done: 3, limit: 3 },
		ended: { at: Date.parse('2026-10-17T09:00:00Z'), reason: 'runs' as const }
	};
	const tools = automationTools({
		create: async () => automation,
		list: async () => [{ ...automation, nextAt: Date.parse('2026-10-14T12:15:00Z') }, ended],
		cancel: async (id) => {
			cancelled.push(id);
			return { ...automation, ended: { at: 0, reason: 'cancelled' } };
		}
	});
	expect(await tools.execute({ id: 'l', name: 'list_automations', arguments: '{}' })).toBe(
		[
			'a1b2c3d4 · post-deploy-check · 15m after what this thread shipped deploys · 0 of 1 runs · next 2026-10-14T12:15Z · expires 2026-11-13T10:00Z',
			'e5f6 · daily · On schedule 0 9 * * * (UTC) · 3 of 3 runs · ended (runs) 2026-10-17T09:00Z'
		].join('\n')
	);
	expect(
		await tools.execute({ id: 'c', name: 'cancel_automation', arguments: '{"id":" a1b2c3d4 "}' })
	).toStartWith('Cancelled: a1b2c3d4');
	expect(cancelled).toEqual(['a1b2c3d4']);
	const empty = automationTools({
		create: async () => automation,
		list: async () => [],
		cancel: async () => automation
	});
	expect(await empty.execute({ id: 'l', name: 'list_automations', arguments: '{}' })).toBe(
		'This thread has no automations.'
	);
});

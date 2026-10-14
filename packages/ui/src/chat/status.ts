import type { ThreadStatus } from './types.ts';

export type StatusIconState =
	'pending' | 'running' | 'shipping' | 'attention' | 'passed' | 'failed';

export const statuses: Record<ThreadStatus, { label: string; icon: StatusIconState }> = {
	working: { label: 'Working', icon: 'running' },
	idle: { label: 'Idle', icon: 'pending' },
	shipping: { label: 'Shipping', icon: 'shipping' },
	shipped: { label: 'Shipped', icon: 'passed' },
	archived: { label: 'Archived', icon: 'pending' }
};

export const needsYou = { label: 'Needs you', icon: 'attention' } as const;

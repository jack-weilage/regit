import type { ThreadStatus } from './types.ts';

export type StatusIconState =
	'pending' | 'running' | 'shipping' | 'attention' | 'passed' | 'failed';

export const statuses: Record<ThreadStatus, { label: string; icon: StatusIconState }> = {
	draft: { label: 'Not started', icon: 'pending' },
	running: { label: 'Running', icon: 'running' },
	'needs-you': { label: 'Needs you', icon: 'attention' },
	shipping: { label: 'Shipping', icon: 'shipping' },
	shipped: { label: 'Shipped', icon: 'passed' },
	discarded: { label: 'Discarded', icon: 'failed' }
};

import type { CiStatus, CiStepStatus } from '@regit/core';
import type { StatusIconState } from './chat/status.ts';

type Status = { label: string; icon: StatusIconState };

export const ciStatuses: Record<CiStatus, Status> = {
	preparing: { label: 'Preparing', icon: 'running' },
	running: { label: 'Running', icon: 'running' },
	passed: { label: 'Passed', icon: 'passed' },
	failed: { label: 'Failed', icon: 'failed' },
	cancelled: { label: 'Cancelled', icon: 'pending' }
};

export const ciStepStatuses: Record<CiStepStatus, Status> = {
	pending: { label: 'Pending', icon: 'pending' },
	running: { label: 'Running', icon: 'running' },
	passed: { label: 'Passed', icon: 'passed' },
	failed: { label: 'Failed', icon: 'failed' },
	skipped: { label: 'Skipped', icon: 'pending' },
	cancelled: { label: 'Cancelled', icon: 'pending' }
};

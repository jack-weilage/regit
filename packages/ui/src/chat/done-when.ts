import type { DoneWhenResult } from '@regit/core';
import type { StatusIconState } from './status.ts';

const states = {
	met: { icon: 'passed', label: 'Met' },
	unmet: { icon: 'failed', label: 'Not met' },
	unverified: { icon: 'attention', label: 'Unverified' }
} as const satisfies Record<DoneWhenResult['status'], { icon: StatusIconState; label: string }>;

// A result recorded before the files last changed no longer counts as met or unmet.
export function doneWhenState(result?: DoneWhenResult): {
	icon: StatusIconState;
	label: string | null;
	met: boolean;
} {
	if (!result) return { icon: 'pending', label: null, met: false };
	if (result.stale) return { icon: 'attention', label: 'Outdated', met: false };
	return { ...states[result.status], met: result.status === 'met' };
}

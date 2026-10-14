import { expect, test, vi } from 'vitest';
import { idlePhase, type ThreadActivity, type ThreadSummary } from '@regit/core';
import { repoLiveHandlers } from '../src/lib/live.ts';

function setup() {
	// This is the page data resolved from /demo/42, not the numeric URL parameter.
	let current: string | undefined = 'abcdef012345';
	const activities: Record<string, ThreadActivity | null> = {};
	const main = vi.fn();
	const reloadMain = vi.fn();
	const reloadThreads = vi.fn();
	const reloadThread = vi.fn();
	const notice = vi.fn();
	const handlers = repoLiveHandlers({
		activities,
		current: () => current,
		main,
		reloadMain,
		reloadThreads,
		reloadThread,
		notice
	});
	return {
		activities,
		main,
		reloadMain,
		reloadThreads,
		reloadThread,
		notice,
		handlers,
		navigate(id: string | undefined) {
			current = id;
		}
	};
}

test('a numbered page refreshes the current thread using its internal ID', () => {
	const { handlers, reloadThread, reloadThreads } = setup();
	handlers.message(JSON.stringify({ type: 'entry', thread: 'abcdef012345', entry: {} }));
	expect(reloadThread).toHaveBeenCalledExactlyOnceWith('abcdef012345');
	handlers.message(JSON.stringify({ type: 'entry', thread: 'other', entry: {} }));
	handlers.message(JSON.stringify({ type: 'entry', thread: '42', entry: {} }));
	expect(reloadThread).toHaveBeenCalledTimes(1);
	expect(reloadThreads).not.toHaveBeenCalled();
});

test('summary updates refresh the sidebar and current detail; activity remains keyed by internal ID', () => {
	const { handlers, activities, reloadThreads, reloadThread, notice } = setup();
	const summary = { id: 'abcdef012345', number: 42 } as ThreadSummary;
	handlers.message(JSON.stringify({ type: 'thread', summary }));
	expect(notice).toHaveBeenCalledWith(summary);
	expect(reloadThreads).toHaveBeenCalledOnce();
	expect(reloadThread).toHaveBeenCalledWith(summary.id);
	const activity: ThreadActivity = { agent: idlePhase, retry: null, ship: null };
	handlers.message(JSON.stringify({ type: 'activity', thread: summary.id, activity }));
	expect(activities[summary.id]).toEqual(activity);
	expect(activities['42']).toBeUndefined();
	handlers.message(JSON.stringify({ type: 'activity', thread: summary.id, activity: null }));
	expect(activities[summary.id]).toBeNull();
});

test('reconnection clears stale activity and reloads the current internal ID after navigation', () => {
	const { handlers, activities, navigate, reloadMain, reloadThreads, reloadThread, main } = setup();
	activities.abcdef012345 = null;
	navigate('fedcba543210');
	handlers.reconnected();
	expect(activities).toEqual({});
	expect(main).toHaveBeenCalledWith(null);
	expect(reloadMain).toHaveBeenCalledOnce();
	expect(reloadThreads).toHaveBeenCalledOnce();
	expect(reloadThread).toHaveBeenCalledExactlyOnceWith('fedcba543210');
	navigate(undefined);
	handlers.reconnected();
	expect(reloadThread).toHaveBeenCalledTimes(1);
});

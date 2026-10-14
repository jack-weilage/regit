import { createContext } from 'svelte';
import type { ThreadActivity, ToolCallRecord } from '@regit/core';
import type { ToolCallView } from '@regit/ui';

export const [getLiveActivity, setLiveActivity] =
	createContext<Record<string, ThreadActivity | null>>();

const verbs: Record<string, [running: string, done: string]> = {
	read_file: ['Reading', 'Read'],
	write_file: ['Writing', 'Wrote'],
	edit_file: ['Editing', 'Edited'],
	find_files: ['Finding', 'Found'],
	search: ['Searching for', 'Searched for'],
	run: ['Running', 'Ran'],
	update_intent: ['Updating the intent to', 'Updated the intent to'],
	record_done_when: ['Recording done-when results', 'Recorded done-when results'],
	suggest_thread: ['Suggesting', 'Suggested'],
	launch_thread: ['Starting', 'Started'],
	list_threads: ['Listing threads', 'Listed threads'],
	message_thread: ['Messaging thread', 'Messaged thread'],
	ask_threads: ['Asking about threads', 'Asked about threads'],
	load_skill: ['Loading skill', 'Loaded skill']
};

export function toolView(call: ToolCallRecord): ToolCallView {
	const [running, done] = verbs[call.tool] ?? [call.tool, call.tool];
	return { ...call, verb: call.status === 'running' ? running : done };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function summarizeTools(calls: ToolCallRecord[]) {
	const count = (...tools: string[]) => calls.filter((call) => tools.includes(call.tool)).length;
	const searches = count('search', 'find_files');
	const parts = [
		count('read_file') && `read ${plural(count('read_file'), 'file', 'files')}`,
		searches && `searched ${searches === 1 ? 'once' : `${searches} times`}`,
		count('edit_file', 'write_file') &&
			`edited ${plural(count('edit_file', 'write_file'), 'file', 'files')}`,
		count('run') && `ran ${plural(count('run'), 'command', 'commands')}`,
		count('update_intent') && 'updated the intent',
		count('record_done_when') && 'recorded done-when results',
		count('suggest_thread') && `suggested ${plural(count('suggest_thread'), 'thread', 'threads')}`,
		count('launch_thread') && `started ${plural(count('launch_thread'), 'thread', 'threads')}`,
		count('list_threads') && 'listed threads',
		count('message_thread') && `messaged ${plural(count('message_thread'), 'thread', 'threads')}`,
		count('ask_threads') && 'asked about threads',
		count('load_skill') && `loaded ${plural(count('load_skill'), 'skill', 'skills')}`
	].filter(Boolean);
	const failed = calls.filter((call) => call.status === 'failed').length;
	const text = parts.join(', ') || plural(calls.length, 'tool call', 'tool calls');
	return `${text[0]!.toUpperCase()}${text.slice(1)}${failed ? ` · ${failed} failed` : ''}`;
}

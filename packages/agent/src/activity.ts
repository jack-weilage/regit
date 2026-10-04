import type { ToolCallRecord } from '@regit/core';
import type { AgentEvent } from './types.ts';

const targets: Record<string, string> = {
	read_file: 'path',
	write_file: 'path',
	edit_file: 'path',
	find_files: 'pattern',
	search: 'pattern',
	run: 'command',
	propose_intent: 'headline',
	update_intent: 'headline',
	suggest_thread: 'headline'
};

const kept = 4000;

export function toolTarget(name: string, args: string) {
	try {
		const value = (JSON.parse(args) as Record<string, unknown>)[targets[name] ?? ''];
		if (typeof value !== 'string') return '';
		const [first = '', ...rest] = value.trim().split('\n');
		return rest.length ? `${first} …` : first;
	} catch {
		return '';
	}
}

function failed(output: string) {
	return /^(Error: |exit code [1-9]|timed out after )/.test(output);
}

export class StepActivity {
	text = '';
	calls: ToolCallRecord[] = [];

	constructor(private now: () => number = Date.now) {}

	apply(event: AgentEvent) {
		if (event.type === 'text') this.text += event.delta;
		if (event.type === 'call') {
			const { id, name, arguments: args } = event.call;
			this.calls.push({
				id,
				tool: name,
				target: toolTarget(name, args),
				status: 'running',
				startedAt: this.now()
			});
		}
		if (event.type === 'result') {
			const call = this.calls.find((call) => call.id === event.result.callId);
			if (!call) return;
			const { output } = event.result;
			call.status = failed(output) ? 'failed' : 'done';
			call.finishedAt = this.now();
			if (call.tool === 'run' || call.status === 'failed') call.output = output.slice(-kept);
		}
	}

	take() {
		const calls = this.calls;
		this.text = '';
		this.calls = [];
		return calls;
	}
}

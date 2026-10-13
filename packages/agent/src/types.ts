export interface ToolSpec {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
}

export interface ToolCall {
	id: string;
	name: string;
	arguments: string;
}

export interface ToolResult {
	callId: string;
	output: string;
	imageUrl?: string;
}

export type ToolOutput = string | { text: string; imageUrl: string };

export type Turn =
	| { role: 'user'; text: string }
	| { role: 'notification'; text: string }
	| {
			role: 'assistant';
			text: string;
			calls: ToolCall[];
			reasoning?: string[];
			// The model's summary of everything before this reply, replayed in place of it.
			compaction?: string;
	  }
	| { role: 'tool'; results: ToolResult[] };

export interface Usage {
	inputTokens: number;
	cachedInputTokens: number;
	cacheWriteTokens: number;
	outputTokens: number;
}

export type ModelEvent =
	| { type: 'text'; delta: string }
	| { type: 'call'; call: ToolCall }
	| { type: 'reasoning'; data: string }
	| { type: 'compacting' }
	| { type: 'compaction'; data: string }
	| { type: 'done'; usage: Usage };

export interface ModelRequest {
	instructions: string;
	history: Turn[];
	tools: ToolSpec[];
}

export interface ModelClient {
	respond(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}

export interface ToolExecutor {
	specs: ToolSpec[];
	execute(call: ToolCall, signal?: AbortSignal): Promise<ToolOutput>;
}

export type Reply = Extract<Turn, { role: 'assistant' }>;

// A step whose reply arrived but whose tool calls didn't all finish.
export interface InflightStep {
	reply: Reply;
	usage?: Usage;
	results: ToolResult[];
}

export interface Step {
	turns: Turn[];
	usage?: Usage;
}

export type AgentEvent =
	| { type: 'text'; delta: string }
	| { type: 'call'; call: ToolCall }
	| { type: 'compacting' }
	| { type: 'reply'; reply: Reply; usage?: Usage }
	| { type: 'result'; result: ToolResult }
	| { type: 'retry'; label: string; error: string; attempt: number; limit: number; delayMs: number }
	| ({ type: 'step' } & Step);

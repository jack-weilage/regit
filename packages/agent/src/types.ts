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
	| { role: 'assistant'; text: string; calls: ToolCall[]; reasoning?: string[] }
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
	| { type: 'done'; usage: Usage };

export interface ModelRequest {
	instructions: string;
	history: Turn[];
	tools: ToolSpec[];
	allowedTools?: string[];
}

export interface ModelClient {
	respond(request: ModelRequest, signal?: AbortSignal): AsyncIterable<ModelEvent>;
}

export interface ToolExecutor {
	specs: ToolSpec[];
	execute(call: ToolCall, signal?: AbortSignal): Promise<ToolOutput>;
}

export interface Step {
	turns: Turn[];
	usage?: Usage;
}

export type AgentEvent =
	| { type: 'text'; delta: string }
	| { type: 'call'; call: ToolCall }
	| { type: 'result'; result: ToolResult }
	| ({ type: 'step' } & Step);

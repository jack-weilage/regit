import type {
	ModelClient,
	ModelEvent,
	ModelRequest,
	ToolCall,
	ToolExecutor,
	ToolSpec
} from './types.ts';

export function scriptedModel(replies: ModelEvent[][]) {
	const requests: ModelRequest[] = [];
	const model: ModelClient = {
		async *respond(request) {
			requests.push(structuredClone(request));
			const reply = replies.shift();
			if (!reply) throw new Error('The scripted model ran out of replies');
			yield* reply;
		}
	};
	return { model, requests };
}

export function fakeTools(
	handlers: Record<string, (args: Record<string, unknown>) => string | Promise<string>>
) {
	const calls: ToolCall[] = [];
	const specs: ToolSpec[] = Object.keys(handlers).map((name) => ({
		name,
		description: name,
		parameters: {}
	}));
	const tools: ToolExecutor = {
		specs,
		async execute(call) {
			calls.push(call);
			const handler = handlers[call.name];
			if (!handler) throw new Error(`Unknown tool ${call.name}`);
			return handler(JSON.parse(call.arguments));
		}
	};
	return { tools, calls };
}

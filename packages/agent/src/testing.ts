import type {
	ModelClient,
	ModelEvent,
	ModelRequest,
	ToolCall,
	ToolExecutor,
	ToolSpec
} from './types.ts';

// A reply can fail partway: an Error in it is thrown once the events before it have streamed.
export function scriptedModel(replies: (ModelEvent | Error)[][]) {
	const requests: ModelRequest[] = [];
	const model: ModelClient = {
		async *respond(request) {
			requests.push(structuredClone(request));
			const reply = replies.shift();
			if (!reply) throw new Error('The scripted model ran out of replies');
			for (const event of reply) {
				if (event instanceof Error) throw event;
				yield event;
			}
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

type Block =
	| { type: 'text'; text: string }
	| { type: 'thinking'; thinking: string; signature: string }
	| { type: 'tool_use'; id: string; name: string; input: object }
	| { type: 'compaction'; content: string };

interface Ending {
	stop_reason?: string;
	stop_details?: object;
	usage?: object;
}

const usage = {
	input_tokens: 20,
	cache_read_input_tokens: 100,
	cache_creation_input_tokens: 10,
	output_tokens: 30
};

// The stream events the Messages API sends for a reply made of these blocks.
export function messageEvents(content: Block[], ending: Ending = {}) {
	const events: object[] = [
		{
			type: 'message_start',
			message: {
				id: 'msg_1',
				type: 'message',
				role: 'assistant',
				model: 'claude-opus-5-5',
				content: [],
				stop_reason: null,
				stop_sequence: null,
				usage: { ...usage, output_tokens: 1 }
			}
		}
	];
	content.forEach((block, index) => {
		const start = (content_block: object) =>
			events.push({ type: 'content_block_start', index, content_block });
		const delta = (delta: object) => events.push({ type: 'content_block_delta', index, delta });
		if (block.type === 'text') {
			start({ type: 'text', text: '' });
			delta({ type: 'text_delta', text: block.text });
		} else if (block.type === 'thinking') {
			start({ type: 'thinking', thinking: '', signature: '' });
			if (block.thinking) delta({ type: 'thinking_delta', thinking: block.thinking });
			delta({ type: 'signature_delta', signature: block.signature });
		} else if (block.type === 'tool_use') {
			start({ type: 'tool_use', id: block.id, name: block.name, input: {} });
			delta({ type: 'input_json_delta', partial_json: JSON.stringify(block.input) });
		} else {
			start({ type: 'compaction', content: null });
			delta({ type: 'compaction_delta', content: block.content });
		}
		events.push({ type: 'content_block_stop', index });
	});
	events.push(
		{
			type: 'message_delta',
			delta: {
				stop_reason:
					ending.stop_reason ??
					(content.some((block) => block.type === 'tool_use') ? 'tool_use' : 'end_turn'),
				stop_sequence: null,
				stop_details: ending.stop_details ?? null
			},
			usage: ending.usage ?? usage
		},
		{ type: 'message_stop' }
	);
	return events;
}

export function sse(events: object[]) {
	return new Response(
		events
			.map((event) => {
				const type = (event as { type: string }).type;
				return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
			})
			.join(''),
		{ headers: { 'Content-Type': 'text/event-stream' } }
	);
}

export function reply(content: Block[], ending?: Ending) {
	return sse(messageEvents(content, ending));
}

import { error } from '@sveltejs/kit';
import { env } from 'cloudflare:workers';
import type { RequestHandler } from './$types';

const heartbeat = 25_000;

export const GET: RequestHandler = async ({ params, request }) => {
	if (!/^[A-Za-z0-9._-]+$/.test(params.repo)) error(404);
	const response = await env.FORGE.fetch(`https://forge/repos/${params.repo}/live`, {
		headers: { Upgrade: 'websocket' }
	});
	const socket = response.webSocket;
	if (!socket) error(502, 'The live connection could not be opened');
	socket.accept();

	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => controller.enqueue(encoder.encode(chunk));
			socket.addEventListener('message', (event) => send(`data: ${event.data}\n\n`));
			socket.addEventListener('close', () => controller.close());
			timer = setInterval(() => send(': ping\n\n'), heartbeat);
			request.signal.addEventListener('abort', () => socket.close());
		},
		cancel() {
			clearInterval(timer);
			socket.close();
		}
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
};

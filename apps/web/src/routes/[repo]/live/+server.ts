import { error } from '@sveltejs/kit';
import { coordinatorFor } from '#lib/server/coordinators.ts';
import { repoExists } from '#lib/server/repos.ts';
import type { RequestHandler } from './$types';

const heartbeat = 25_000;

export const GET: RequestHandler = async ({ params, request }) => {
	if (!(await repoExists(params.repo))) error(404);
	const response = await coordinatorFor(params.repo).fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	const socket = response.webSocket;
	if (!socket) error(502, 'The live connection could not be opened');
	socket.accept();

	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	let closed = false;

	function stop() {
		closed = true;
		clearInterval(timer);
		socket!.close();
	}

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const send = (chunk: string) => {
				if (!closed) controller.enqueue(encoder.encode(chunk));
			};
			socket.addEventListener('message', (event) => send(`data: ${event.data}\n\n`));
			socket.addEventListener('close', () => {
				if (closed) return;
				stop();
				controller.close();
			});
			timer = setInterval(() => send(': ping\n\n'), heartbeat);
			request.signal.addEventListener('abort', stop);
		},
		cancel: stop
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
};

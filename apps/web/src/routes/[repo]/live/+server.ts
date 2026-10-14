import { error } from '@sveltejs/kit';
import { coordinatorFor } from '#lib/server/coordinators.ts';
import { requireRepoAccess } from '#lib/server/access.ts';
import { liveHeartbeatMs as heartbeat } from '#lib/live.ts';
import type { RequestHandler } from './$types';

// Each beat pings both ends: the browser to prove the stream still delivers, and the coordinator to prove its socket
// does. A coordinator that stops answering ends the stream, so the browser reconnects and reloads what it missed.
const unanswered = 2 * heartbeat;

export const GET: RequestHandler = async ({ params, request, locals }) => {
	await requireRepoAccess(params.repo, locals.user?.id);
	const response = await coordinatorFor(params.repo).fetch('https://repo/live', {
		headers: { Upgrade: 'websocket' }
	});
	const socket = response.webSocket;
	if (!socket) error(502, 'The live connection could not be opened');
	socket.accept();

	const encoder = new TextEncoder();
	let timer: ReturnType<typeof setInterval> | undefined;
	let closed = false;
	let answered = Date.now();

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
			const end = () => {
				if (closed) return;
				stop();
				controller.close();
			};
			socket.addEventListener('message', (event) => {
				if (event.data === 'pong') answered = Date.now();
				else send(`data: ${event.data}\n\n`);
			});
			socket.addEventListener('close', end);
			timer = setInterval(() => {
				if (Date.now() - answered > unanswered) return end();
				send('event: ping\ndata:\n\n');
				try {
					socket.send('ping');
				} catch {
					end();
				}
			}, heartbeat);
			request.signal.addEventListener('abort', stop);
		},
		cancel: stop
	});

	return new Response(stream, {
		headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }
	});
};

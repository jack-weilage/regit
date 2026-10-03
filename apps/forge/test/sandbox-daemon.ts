import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createSandbox } from '../../sandbox/src/server.ts';

const root = process.argv[2]!;
const sandboxes = new Map<string, ReturnType<typeof createSandbox>>();

const server = createServer(async (req, res) => {
	const url = new URL(req.url!, 'http://sandbox');
	const [, thread, ...rest] = url.pathname.split('/');
	let sandbox = sandboxes.get(thread!);
	if (!sandbox) {
		mkdirSync(join(root, thread!), { recursive: true });
		sandbox = createSandbox(join(root, thread!));
		sandboxes.set(thread!, sandbox);
	}
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const response = await sandbox(
		new Request(`http://sandbox/${rest.join('/')}`, {
			method: req.method,
			headers: req.headers as Record<string, string>,
			body: chunks.length ? Buffer.concat(chunks) : undefined
		})
	);
	res.writeHead(response.status, Object.fromEntries(response.headers));
	res.end(Buffer.from(await response.arrayBuffer()));
});

server.listen(0, '127.0.0.1', () => console.log((server.address() as AddressInfo).port));

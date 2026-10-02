import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export async function serveGit(root: string) {
	const requests: IncomingHttpHeaders[] = [];
	const server = createServer((req, res) => {
		const url = new URL(req.url!, 'http://git');
		if (url.pathname === '/_control/requests') {
			res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(requests));
			return;
		}
		forkOnFirstUse(root, url.pathname);
		requests.push(req.headers);
		const backend = spawn('git', ['http-backend'], {
			env: {
				...process.env,
				GIT_PROJECT_ROOT: root,
				GIT_HTTP_EXPORT_ALL: '1',
				REMOTE_USER: 'regit',
				PATH_INFO: url.pathname,
				QUERY_STRING: url.search.slice(1),
				REQUEST_METHOD: req.method!,
				CONTENT_TYPE: req.headers['content-type'] ?? '',
				HTTP_CONTENT_ENCODING: req.headers['content-encoding'] ?? '',
				GIT_PROTOCOL: String(req.headers['git-protocol'] ?? '')
			}
		});
		req.pipe(backend.stdin);

		let head = Buffer.alloc(0);
		backend.stdout.on('data', function onData(chunk: Buffer) {
			head = Buffer.concat([head, chunk]);
			const end = head.indexOf('\r\n\r\n');
			if (end === -1) return;
			backend.stdout.off('data', onData);
			const lines = head.subarray(0, end).toString().split('\r\n');
			const headers = Object.fromEntries(
				lines.map((line) => line.split(/:\s*/, 2) as [string, string])
			);
			res.writeHead(Number(headers.Status?.split(' ')[0] ?? 200), headers);
			res.write(head.subarray(end + 4));
			backend.stdout.pipe(res);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '0.0.0.0', resolve));
	return {
		port: (server.address() as AddressInfo).port,
		requests,
		close: () => new Promise<void>((resolve) => server.close(() => resolve()))
	};
}

function forkOnFirstUse(root: string, path: string) {
	const name = path.split('/')[1]?.replace(/\.git$/, '');
	const base = name?.split('--')[0];
	if (!name || !base || base === name || existsSync(join(root, `${name}.git`))) return;
	execFileSync('git', [
		'clone',
		'--quiet',
		'--bare',
		join(root, `${base}.git`),
		join(root, `${name}.git`)
	]);
}

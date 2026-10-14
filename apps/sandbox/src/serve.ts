import { createSandbox } from './server.ts';

// Streamed hook output can go quiet for minutes (dependency installs print nothing), so connections never idle out.
export function serveSandbox(root: string, port: number) {
	return Bun.serve({ port, idleTimeout: 0, fetch: createSandbox(root) });
}

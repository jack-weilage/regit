import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createSandbox } from './server.ts';

const root = resolve(process.env.SANDBOX_ROOT ?? '/workspace');
await mkdir(root, { recursive: true });

const server = Bun.serve({ port: Number(process.env.PORT ?? 8080), fetch: createSandbox(root) });
console.log(`Sandbox serving ${root} on ${server.url}`);

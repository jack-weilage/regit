import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

process.env.NODE_COMPILE_CACHE ??= join(tmpdir(), 'node-compile-cache');

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		testTimeout: 60_000,
		hookTimeout: 120_000
	}
});

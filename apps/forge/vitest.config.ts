import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

process.env.NODE_COMPILE_CACHE ??= join(tmpdir(), 'node-compile-cache');

export default defineConfig({
	test: {
		include: ['test/**/*.test.ts'],
		env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
		testTimeout: 300_000,
		hookTimeout: 300_000
	}
});

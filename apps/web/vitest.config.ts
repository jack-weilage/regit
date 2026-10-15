import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

process.env.NODE_COMPILE_CACHE ??= join(tmpdir(), 'node-compile-cache');

export default defineConfig({
	plugins: [
		svelte({
			configFile: false,
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
				experimental: { async: true }
			}
		})
	],
	test: {
		testTimeout: 60_000,
		hookTimeout: 120_000,
		projects: [
			{
				extends: true,
				test: { name: 'server', include: ['test/**/*.test.ts'], exclude: ['test/browser/**'] }
			},
			{
				extends: true,
				resolve: {
					alias: [
						{
							find: /^#lib\/data\.remote\.ts$/,
							replacement: fileURLToPath(new URL('test/browser/fake-remote.ts', import.meta.url))
						}
					]
				},
				test: {
					name: 'browser',
					include: ['test/browser/**/*.test.ts'],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});

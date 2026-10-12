import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { trustInterception } from './trust.ts';

test('installs the interception CA once it exists and reinstalls it when it changes', async () => {
	const dir = await mkdtemp(join(tmpdir(), 'trust-'));
	const source = join(dir, 'ca.crt');
	const target = join(dir, 'installed.crt');
	const log = join(dir, 'updates');
	const options = { source, target, update: ['sh', '-c', `echo updated >> ${log}`] };

	expect(await trustInterception(options)).toEqual({ trusted: false });

	await writeFile(source, 'first');
	expect(await trustInterception(options)).toEqual({ trusted: true });
	expect(await trustInterception(options)).toEqual({ trusted: true });
	expect(await readFile(target, 'utf8')).toBe('first');

	await writeFile(source, 'second');
	await trustInterception(options);
	expect(await readFile(target, 'utf8')).toBe('second');
	expect((await readFile(log, 'utf8')).trim().split('\n')).toEqual(['updated', 'updated']);
});

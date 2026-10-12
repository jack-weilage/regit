import { readFile, writeFile } from 'node:fs/promises';
import { exec } from './exec.ts';

export interface TrustOptions {
	source?: string;
	target?: string;
	update?: string[];
}

// Cloudflare provides the HTTPS interception CA at runtime, so a container can need it after it started.
export async function trustInterception({
	source = '/etc/cloudflare/certs/cloudflare-containers-ca.crt',
	target = '/usr/local/share/ca-certificates/cloudflare-containers-ca.crt',
	update = ['update-ca-certificates']
}: TrustOptions = {}) {
	const ca = await readFile(source, 'utf8').catch(() => null);
	if (!ca) return { trusted: false };
	if ((await readFile(target, 'utf8').catch(() => null)) !== ca) {
		await writeFile(target, ca);
		const [command = '', ...args] = update;
		const result = await exec(command, args, { cwd: '/' });
		if (result.code !== 0) throw new Error(`Trusting the interception CA failed: ${result.output}`);
	}
	return { trusted: true };
}

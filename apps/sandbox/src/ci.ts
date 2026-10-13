import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CiConfig } from '@regit/agent';
import { ToolError } from './tools.ts';
import { isMap, parseYaml } from './yaml.ts';

export const ciFile = '.agents/ci.yml';

// Steps run in order, each as its own command: `name: command`, or a map with `run`.
export async function readCi(root: string): Promise<CiConfig> {
	const text = await readFile(join(root, ciFile), 'utf8').catch(() => null);
	if (text === null) return { steps: null };
	const { steps } = parseYaml(text, ciFile);
	if (!isMap(steps) || !Object.keys(steps).length)
		throw new ToolError(`${ciFile}: steps must map step names to commands`);
	return {
		steps: Object.entries(steps).map(([name, step]) => {
			const command = isMap(step) ? step.run : step;
			if (!/^[\w.-]+$/.test(name) || name === 'Prepare')
				throw new ToolError(
					`${ciFile}: step names use letters, digits, ., - and _, and not Prepare`
				);
			if (typeof command !== 'string' || !command)
				throw new ToolError(`${ciFile}: ${name} needs a command`);
			return { name, command };
		})
	};
}

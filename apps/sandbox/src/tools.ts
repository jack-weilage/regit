import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import type { ToolArguments, ToolName } from '@regit/agent';
import { exec, truncate } from './exec.ts';

export class ToolError extends Error {}

type Tools = { [Name in ToolName]: (root: string, args: ToolArguments[Name]) => Promise<string> };

const pageSize = 2000;

export const tools: Tools = {
	async read_file(root, { path, offset = 1, limit = pageSize }) {
		const lines = (await read(root, path)).split('\n');
		const start = Math.max(offset, 1);
		const end = Math.min(start + limit - 1, lines.length);
		const page = lines.slice(start - 1, end).join('\n');
		return end < lines.length || start > 1
			? `${page}\n… lines ${start}–${end} of ${lines.length}`
			: page;
	},

	async write_file(root, { path, content }) {
		const file = inside(root, path);
		await mkdir(dirname(file), { recursive: true });
		await writeFile(file, content);
		return `Wrote ${path}`;
	},

	async edit_file(root, { path, old_string, new_string, replace_all = false }) {
		const content = await read(root, path);
		const matches = content.split(old_string).length - 1;
		if (matches === 0) throw new ToolError(`old_string was not found in ${path}`);
		if (matches > 1 && !replace_all) {
			throw new ToolError(
				`old_string matches ${matches} places in ${path}; include more context or set replace_all`
			);
		}
		await writeFile(
			inside(root, path),
			content.replaceAll(old_string, () => new_string)
		);
		return `Edited ${path}`;
	},

	async find_files(root, { pattern }) {
		const { output } = await exec('rg', ['--files', '--hidden', '-g', pattern, '-g', '!.git'], {
			cwd: root
		});
		return truncate(output.split('\n').filter(Boolean).sort().join('\n')) || 'No files found';
	},

	async search(root, { pattern, path = '.', glob }) {
		const args = ['-n', '--no-heading', '--color', 'never', '--hidden'];
		if (glob) args.push('-g', glob);
		args.push('-g', '!.git');
		const { code, output } = await exec('rg', [...args, '-e', pattern, inside(root, path)], {
			cwd: root
		});
		if (code === 1) return 'No matches';
		if (code !== 0) throw new ToolError(output.trim());
		return truncate(output.replaceAll(`${root}/`, '').trimEnd());
	},

	async run(root, { command, timeout_seconds = 120 }) {
		const { code, output, timedOut } = await exec('bash', ['-lc', command], {
			cwd: root,
			timeout: timeout_seconds * 1000
		});
		const status = timedOut ? `timed out after ${timeout_seconds}s` : `exit code ${code}`;
		return `${status}\n${truncate(output)}`.trimEnd();
	}
};

function inside(root: string, path: string) {
	const file = resolve(root, path);
	const rel = relative(root, file);
	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new ToolError(`${path} is outside the repository`);
	}
	return file;
}

async function read(root: string, path: string) {
	try {
		return await readFile(inside(root, path), 'utf8');
	} catch (error) {
		if (error instanceof ToolError) throw error;
		throw new ToolError(`Could not read ${path}`);
	}
}

export function isTool(name: string): name is ToolName {
	return Object.hasOwn(tools, name);
}

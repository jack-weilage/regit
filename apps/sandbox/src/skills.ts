import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SkillInfo } from '@regit/agent';

const folders = ['.agents/skills', '.claude/skills'];
const maxResources = 50;

export async function discoverSkills(root: string): Promise<SkillInfo[]> {
	const skills = new Map<string, SkillInfo>();
	for (const folder of folders) {
		const entries = await readdir(join(root, folder), { withFileTypes: true }).catch(() => []);
		for (const entry of entries.filter((entry) => entry.isDirectory()).sort(byName)) {
			const directory = `${folder}/${entry.name}`;
			const text = await readFile(join(root, directory, 'SKILL.md'), 'utf8').catch(() => null);
			if (text === null) continue;
			const { fields, body } = frontmatter(text);
			const name = fields.name || entry.name;
			if (!fields.description || skills.has(name)) continue;
			const resources = (await files(join(root, directory)))
				.map((path) => relative(join(root, directory), path))
				.filter((path) => path !== 'SKILL.md')
				.sort()
				.slice(0, maxResources);
			skills.set(name, { name, description: fields.description, body, directory, resources });
		}
	}
	return [...skills.values()];
}

function byName(a: { name: string }, b: { name: string }) {
	return a.name.localeCompare(b.name);
}

async function files(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	const nested = await Promise.all(
		entries
			.filter((entry) => !['node_modules', '.git'].includes(entry.name))
			.map((entry) =>
				entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]
			)
	);
	return nested.flat();
}

function frontmatter(text: string) {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
	if (!match) return { fields: {} as Record<string, string>, body: text.trim() };
	const fields: Record<string, string> = {};
	const lines = match[1]!.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const field = /^([\w-]+):\s*(.*)$/.exec(lines[index]!);
		if (!field) continue;
		const [, key, value = ''] = field;
		if (value === '>' || value === '|' || value === '>-' || value === '|-') {
			const block: string[] = [];
			while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1]!))
				block.push(lines[++index]!.trim());
			fields[key!] = block.join(value.startsWith('>') ? ' ' : '\n');
		} else if (value) {
			fields[key!] = value.replace(/^(['"])(.*)\1$/, '$2');
		}
	}
	return { fields, body: match[2]!.trim() };
}

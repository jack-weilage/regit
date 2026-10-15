import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { SkillInfo } from '@regit/agent';

const folders = ['.agents/skills', '.claude/skills'];
const maxResources = 50;

const bun = (globalThis as unknown as { Bun: { YAML: { parse(text: string): unknown } } }).Bun;

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
	const match = /^\uFEFF?---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
	if (!match) return { fields: {}, body: text.trim() };
	const yaml = match[1] ?? '';
	let parsed: unknown;
	try {
		parsed = bun.YAML.parse(yaml);
	} catch {
		parsed = lenient(yaml);
	}
	const fields: { name?: string; description?: string } = {};
	if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
		const { name, description } = parsed as Record<string, unknown>;
		if (typeof name === 'string' && name.trim()) fields.name = name.trim();
		if (typeof description === 'string' && description.trim())
			fields.description = description.trim();
	}
	return { fields, body: match[2]!.trim() };
}

// Skills often hold YAML that isn't strictly valid, like `description: Use when: …`, so read top-level fields line by
// line when the YAML parser rejects it.
function lenient(yaml: string) {
	const fields: Record<string, string> = {};
	const lines = yaml.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const field = /^([\w-]+):\s*(.*)$/.exec(lines[index]!);
		if (!field) continue;
		const [, key, value = ''] = field;
		if (/^[>|][+-]?$/.test(value)) {
			const block: string[] = [];
			while (index + 1 < lines.length && /^(\s+\S|\s*$)/.test(lines[index + 1]!))
				block.push(lines[++index]!.trim());
			fields[key!] = block.join(value.startsWith('>') ? ' ' : '\n').trim();
		} else if (value) {
			fields[key!] = value.replace(/^(['"])(.*)\1$/, '$2');
		}
	}
	return fields;
}

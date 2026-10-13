import { ToolError } from './tools.ts';

export type YamlMap = { [key: string]: string | YamlMap };

export const isMap = (value: unknown): value is YamlMap =>
	typeof value === 'object' && value !== null;

export function parseYaml(text: string, file: string): YamlMap {
	const root: YamlMap = {};
	const stack: { indent: number; map: YamlMap }[] = [{ indent: -1, map: root }];
	for (const [index, raw] of text.split('\n').entries()) {
		const line = raw.replace(/\s+#.*$/, '').trimEnd();
		if (!line.trim() || line.trim().startsWith('#')) continue;
		const indent = line.length - line.trimStart().length;
		const match = /^([\w.-]+):(?:\s+(.*))?$/.exec(line.trim());
		if (!match) throw new ToolError(`${file}:${index + 1}: expected "key: value"`);
		while (stack.length > 1 && indent <= stack.at(-1)!.indent) stack.pop();
		const parent = stack.at(-1)!.map;
		const [, key, value] = match;
		if (value === undefined || value === '') {
			const child: YamlMap = {};
			parent[key!] = child;
			stack.push({ indent, map: child });
		} else {
			parent[key!] = unquote(value);
		}
	}
	return root;
}

function unquote(value: string) {
	const quoted = /^(['"])(.*)\1$/.exec(value);
	return quoted ? quoted[2]! : value;
}

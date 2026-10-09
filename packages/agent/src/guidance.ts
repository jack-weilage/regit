import type { ToolExecutor } from './types.ts';

const maxCharacters = 24_000;

/** Loads repository conventions without granting them authority over the agent's role. */
export async function repositoryGuidance(tools: ToolExecutor) {
	const delivered = new Map<string, string>();

	async function load(directory: string) {
		const parts: string[] = [];
		for (const part of directory.split('/')) {
			if (!part || part === '.') continue;
			if (part === '..') throw new Error('Guidance directory must be inside the repository');
			parts.push(part);
		}
		if (directory.startsWith('/')) throw new Error('Use a repository-relative directory');
		const sections: string[] = [];
		for (let depth = 0; depth <= parts.length; depth++) {
			const scope = parts.slice(0, depth).join('/');
			for (const name of ['AGENTS.md', 'CLAUDE.md']) {
				const path = scope ? `${scope}/${name}` : name;
				let text: string;
				try {
					const output = await tools.execute({
						id: 'repository-guidance',
						name: 'read_file',
						arguments: JSON.stringify({ path, limit: 400 })
					});
					text = typeof output === 'string' ? output : output.text;
				} catch (error) {
					if (error instanceof Error && error.message === `Could not read ${path}`) continue;
					throw error;
				}
				if (delivered.get(scope) !== `${path}\n${text}`) {
					delivered.set(scope, `${path}\n${text}`);
					sections.push(
						`Repository guidance: ${path} (scope: ${scope || '.'} and descendants)\n${text.slice(0, maxCharacters)}${text.length > maxCharacters ? '\n[Truncated; use read_file to read the remaining guidance.]' : ''}`
					);
				}
				break;
			}
		}
		return sections.join('\n\n');
	}

	const instructions = await load('.');
	const guided: ToolExecutor = {
		specs: [
			...tools.specs,
			{
				name: 'read_guidance',
				description:
					'Read scoped repository instructions before shell work in a directory. Returns new or changed AGENTS.md (or CLAUDE.md fallback) guidance from root to that directory.',
				parameters: {
					type: 'object',
					properties: {
						directory: { type: 'string', description: 'Repository-relative directory' }
					},
					required: ['directory']
				}
			}
		],
		async execute(call, signal) {
			if (call.name === 'read_guidance') {
				const { directory } = JSON.parse(call.arguments) as { directory: string };
				return (await load(directory)) || 'No new repository guidance.';
			}
			if (['read_file', 'write_file', 'edit_file'].includes(call.name)) {
				const { path } = JSON.parse(call.arguments) as { path: string };
				const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
				const guidance = await load(directory);
				if (guidance && call.name !== 'read_file') {
					return `${guidance}\n\nThe edit was NOT executed. Read this guidance, then retry if the edit complies.`;
				}
				const output = await tools.execute(call, signal).catch((error: unknown) => {
					if (!guidance) throw error;
					return `Error: ${error instanceof Error ? error.message : String(error)}`;
				});
				return guidance ? `${guidance}\n\nFile contents:\n${output}` : output;
			}
			return tools.execute(call, signal);
		}
	};
	return { instructions, tools: guided };
}

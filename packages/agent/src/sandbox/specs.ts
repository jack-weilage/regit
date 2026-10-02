import type { ToolSpec } from '../types.ts';
import type { ToolName } from './protocol.ts';

const path = { type: 'string', description: 'Path relative to the repository root' };

export const toolSpecs: (ToolSpec & { name: ToolName })[] = [
	{
		name: 'read_file',
		description: 'Read a text file. Long files are returned in pages of lines.',
		parameters: {
			type: 'object',
			properties: {
				path,
				offset: { type: 'integer', description: 'First line to read, starting at 1' },
				limit: { type: 'integer', description: 'Number of lines to read' }
			},
			required: ['path']
		}
	},
	{
		name: 'write_file',
		description: 'Create or overwrite a file with the given content.',
		parameters: {
			type: 'object',
			properties: { path, content: { type: 'string' } },
			required: ['path', 'content']
		}
	},
	{
		name: 'edit_file',
		description:
			'Replace an exact string in a file. old_string must match exactly once unless replace_all is set.',
		parameters: {
			type: 'object',
			properties: {
				path,
				old_string: { type: 'string' },
				new_string: { type: 'string' },
				replace_all: { type: 'boolean' }
			},
			required: ['path', 'old_string', 'new_string']
		}
	},
	{
		name: 'find_files',
		description: 'List files matching a glob such as "src/**/*.ts", respecting .gitignore.',
		parameters: {
			type: 'object',
			properties: { pattern: { type: 'string' } },
			required: ['pattern']
		}
	},
	{
		name: 'search',
		description: 'Search file contents with a regular expression and return matching lines.',
		parameters: {
			type: 'object',
			properties: {
				pattern: { type: 'string' },
				path: { ...path, description: 'Directory or file to search in' },
				glob: { type: 'string', description: 'Only search files matching this glob' }
			},
			required: ['pattern']
		}
	},
	{
		name: 'run',
		description:
			'Run a shell command in the repository root and return its exit code and combined output.',
		parameters: {
			type: 'object',
			properties: {
				command: { type: 'string' },
				timeout_seconds: { type: 'integer', description: 'Defaults to 120' }
			},
			required: ['command']
		}
	}
];

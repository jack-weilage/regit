import { expect, test } from 'vitest';
import { repositoryGuidance } from './guidance.ts';
import { fakeTools } from './testing.ts';

function workspace(files: Record<string, string>) {
	const { tools } = fakeTools({
		read_file: ({ path }) => {
			if (!(String(path) in files)) throw new Error(`Could not read ${path}`);
			return files[String(path)]!;
		},
		write_file: ({ path, content }) => {
			files[String(path)] = String(content);
			return 'Written';
		}
	});
	return tools;
}

test('loads root fallback and scoped guidance before edits, without leaking sibling instructions', async () => {
	const files = {
		'CLAUDE.md': 'Root conventions',
		'src/AGENTS.md': 'Source conventions',
		'src/CLAUDE.md': 'Ignored fallback',
		'src/ui/CLAUDE.md': 'UI conventions',
		'server/AGENTS.md': 'Server only',
		'src/ui/button.ts': 'old'
	};
	const { tools, instructions } = await repositoryGuidance(workspace(files));
	expect(instructions).toContain('CLAUDE.md (scope: . and descendants)');
	expect(instructions).toContain('Root conventions');
	expect(instructions).not.toContain('UI conventions');
	const edit = {
		id: 'edit',
		name: 'write_file',
		arguments: JSON.stringify({ path: 'src/ui/button.ts', content: 'new' })
	};
	const guidance = await tools.execute(edit);
	expect(guidance).toContain('NOT executed');
	expect(guidance).toContain('Source conventions');
	expect(guidance).toContain('UI conventions');
	expect(guidance.indexOf('Source conventions')).toBeLessThan(guidance.indexOf('UI conventions'));
	expect(guidance).not.toContain('Ignored fallback');
	expect(guidance).not.toContain('Server only');
	expect(files['src/ui/button.ts']).toBe('old');
	expect(await tools.execute(edit)).toBe('Written');
	expect(files['src/ui/button.ts']).toBe('new');

	files['src/AGENTS.md'] = 'Updated source conventions';
	const refreshed = await tools.execute({
		id: 'refresh',
		name: 'read_guidance',
		arguments: '{"directory":"src/ui"}'
	});
	expect(refreshed).toContain('Updated source conventions');
	expect(refreshed).not.toContain('UI conventions');
});

test('delivers guidance even for a missing target, bounds long guidance, and rejects escaping paths', async () => {
	const { tools, instructions } = await repositoryGuidance(
		workspace({
			'AGENTS.md': 'a'.repeat(25_000),
			'CLAUDE.md': 'Ignored root fallback',
			'src/AGENTS.md': 'Use strict types'
		})
	);
	expect(instructions).toContain('[Truncated;');
	expect(instructions.length).toBeLessThan(25_000);
	expect(instructions).not.toContain('Ignored root fallback');
	const result = await tools.execute({
		id: 'read',
		name: 'read_file',
		arguments: '{"path":"src/missing.ts"}'
	});
	expect(result).toContain('Use strict types');
	expect(result).toContain('Could not read src/missing.ts');
	for (const directory of ['../outside', '/etc']) {
		await expect(
			tools.execute({
				id: 'escape',
				name: 'read_guidance',
				arguments: JSON.stringify({ directory })
			})
		).rejects.toThrow();
	}
	await expect(
		repositoryGuidance(
			fakeTools({
				read_file: () => {
					throw new Error('Connection lost');
				}
			}).tools
		)
	).rejects.toThrow('Connection lost');
});

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createSandbox } from './server.ts';
import { discoverSkills } from './skills.ts';

let root: string;

async function file(path: string, content: string) {
	await mkdir(dirname(join(root, path)), { recursive: true });
	await writeFile(join(root, path), content);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'regit-skills-'));
});

afterEach(() => rm(root, { recursive: true, force: true }));

test('finds skills in .agents and .claude, reading frontmatter leniently and listing resources', async () => {
	await file(
		'.agents/skills/release/SKILL.md',
		'---\nname: release\ndescription: Cut a release. Use when: asked to publish a version.\nmetadata:\n  owner: ops\n---\n\n# Release\n\nRun scripts/release.sh.\n'
	);
	await file('.agents/skills/release/scripts/release.sh', 'echo release\n');
	await file(
		'.claude/skills/review-ui/SKILL.md',
		'---\ndescription: >\n  Review UI changes in Storybook.\n  Use for component work.\n---\nOpen the stories.\n'
	);
	await file('.claude/skills/broken/SKILL.md', '---\nname: broken\n---\nNo description.\n');
	await file('.agents/skills/README.md', 'Not a skill.\n');

	expect(await discoverSkills(root)).toEqual([
		{
			name: 'release',
			description: 'Cut a release. Use when: asked to publish a version.',
			body: '# Release\n\nRun scripts/release.sh.',
			directory: '.agents/skills/release',
			resources: ['scripts/release.sh']
		},
		{
			name: 'review-ui',
			description: 'Review UI changes in Storybook. Use for component work.',
			body: 'Open the stories.',
			directory: '.claude/skills/review-ui',
			resources: []
		}
	]);
});

test('serves skills from the workspace, and none when the repository has none', async () => {
	const sandbox = createSandbox(root);
	const list = async () =>
		(await (
			await sandbox(new Request('http://sandbox/workspace/skills', { method: 'POST', body: '{}' }))
		).json()) as {
			skills: { name: string }[];
		};
	expect(await list()).toEqual({ skills: [] });
	await file(
		'.agents/skills/deploy/SKILL.md',
		"---\nname: deploy\ndescription: 'Deploy the app.'\n---\nRun bun run deploy.\n"
	);
	expect((await list()).skills.map((skill) => skill.name)).toEqual(['deploy']);
});

import { expect, test } from 'bun:test';
import { mergeSkills, servicesSkill, skillTools, threadsSkill, withSkills } from './skills.ts';

const release = {
	name: 'release',
	description: 'Cut a release. Use when asked to publish a version.',
	body: '# Release\n\nRun scripts/release.sh.',
	directory: '.agents/skills/release',
	resources: ['scripts/release.sh']
};

test('lists skills in the instructions and loads one on demand', async () => {
	const skills = mergeSkills([threadsSkill, servicesSkill], [release]);
	const instructions = withSkills('You are ReGit.', skills);
	expect(instructions).toContain('call load_skill with its name');
	expect(instructions).toContain(`- release: ${release.description}`);
	expect(instructions).toContain('- threads: Work alongside other threads');

	const tools = skillTools(skills);
	expect(tools.specs[0]!.parameters).toMatchObject({
		properties: { name: { enum: ['threads', 'services', 'release'] } }
	});
	const load = (name: string) =>
		tools.execute({ id: name, name: 'load_skill', arguments: JSON.stringify({ name }) });
	expect(await load('release')).toBe(
		'<skill_content name="release">\n# Release\n\nRun scripts/release.sh.\n\nSkill directory: .agents/skills/release\nRelative paths in this skill are relative to the skill directory.\n\n<skill_resources>\n<file>scripts/release.sh</file>\n</skill_resources>\n</skill_content>'
	);
	expect(await load('release')).toBe('The release skill is already loaded above.');
	await expect(load('nope')).rejects.toThrow('There is no skill named nope');
});

test('lets a repository skill replace a built-in one, and adds nothing without skills', () => {
	const custom = {
		name: 'services',
		description: 'Our own way to run services.',
		body: 'Use make dev.'
	};
	expect(mergeSkills([threadsSkill, servicesSkill], [custom])).toEqual([threadsSkill, custom]);
	expect(withSkills('You are ReGit.', [])).toBe('You are ReGit.');
	expect(skillTools([]).specs).toEqual([]);
});

import type { ToolExecutor } from './types.ts';

export interface Skill {
	name: string;
	description: string;
	body: string;
	directory?: string;
	resources?: string[];
}

export const threadsSkill: Skill = {
	name: 'threads',
	description:
		'Work alongside other threads in this repository: find out what they are doing or changed, tell them about changes that affect them, and handle messages they send you.',
	body: `# Working with other threads

Every thread in this repository has its own agent working on one intent. Coordinate with them instead of duplicating or breaking their work.

## Find out what other threads are doing

- Use ask_threads with a specific question: what a thread is doing, what it changed, why it is waiting, or which threads touch a file or feature. It reads their history and diffs without interrupting them.
- Check before you change shared code (APIs, shared components, config) and whenever a message mentions another thread's work.

## Tell a thread when it needs to act

- Use message_thread only when the other thread must do something or answer you: a renamed API, a moved file, a changed shared component, or a question only it can answer. Find its id with list_threads.
- Be specific: say what changed, where (path:line), and what you need.
- Running threads read messages at their next step; draft threads' agents reply in the conversation. Threads waiting for a person (needs-you, shipped, discarded) refuse messages, so tell your person instead.
- A thread accepts at most five thread messages until a person writes in it, so don't chat.

## Messages from other threads

- They arrive as "Thread <id> (<headline>): <text>".
- Act on them when they affect your task, and reply with message_thread when they ask something. Don't reply just to acknowledge.`
};

export const servicesSkill: Skill = {
	name: 'services',
	description:
		'Run long-running processes such as dev servers, Storybook or watchers, share their preview links, and read their logs.',
	body: `# Running services

Long-running processes (dev servers, Storybook, watchers) run under the sandbox's service manager, never in the background with &.

- \`regit services\` lists services: those saved in .agents/services.yml and running one-offs.
- \`regit services start <name>\` starts a saved service; \`regit services restart <name>\` and \`regit services stop <name>\` manage it.
- \`regit services run <name> --port <port> -- <command>\` starts a one-off.
- Services must listen on 0.0.0.0 (for example \`vite --host 0.0.0.0\`); $HOST and $PORT are set for them.
- Starting waits until the port opens and prints a preview link. Share that link, and check the app yourself with curl against http://localhost:<port>.
- Logs are in ~/.regit/logs/<name>.log; \`regit services logs <name>\` shows the end.
- Save a service people will reuse to .agents/services.yml:

\`\`\`yaml
services:
  storybook:
    command: bun run storybook --host 0.0.0.0 --ci --no-open
    cwd: packages/ui
    port: 6006
\`\`\``
};

export const toolchainsSkill: Skill = {
	name: 'toolchains',
	description:
		'Install or switch language toolchains and CLI tools (node, bun, python, go and so on) when a command is missing or the wrong version.',
	body: `# Toolchains

Toolchains come from mise. The versions the repository declares (mise.toml, .tool-versions, .node-version, the packageManager field in package.json and similar) are installed before you start.

- If a command is missing, install it globally with \`mise use -g <tool>@<version>\`, for example \`mise use -g node@lts\` or \`mise use -g python@3.13\`.
- Never edit the repository's version files to work around a missing tool; that changes the project for everyone.
- \`mise ls --current\` shows what is installed and active.`
};

export function mergeSkills(builtIn: Skill[], repo: Skill[]) {
	const names = new Set(repo.map((skill) => skill.name));
	return [...builtIn.filter((skill) => !names.has(skill.name)), ...repo];
}

export function withSkills(instructions: string, skills: Skill[]) {
	if (!skills.length) return instructions;
	const catalog = skills.map((skill) => `- ${skill.name}: ${skill.description}`).join('\n');
	return `${instructions}

Skills hold detailed instructions for specific tasks. When a task matches a skill's description, call load_skill with its name before you start.

${catalog}`;
}

export function skillTools(skills: Skill[]): ToolExecutor {
	const loaded = new Set<string>();
	return {
		specs: skills.length
			? [
					{
						name: 'load_skill',
						description: "Load a skill's full instructions.",
						parameters: {
							type: 'object',
							properties: { name: { type: 'string', enum: skills.map((skill) => skill.name) } },
							required: ['name']
						}
					}
				]
			: [],
		async execute(call) {
			const { name } = JSON.parse(call.arguments) as { name: string };
			const skill = skills.find((skill) => skill.name === name);
			if (!skill) throw new Error(`There is no skill named ${name}`);
			if (loaded.has(name)) return `The ${name} skill is already loaded above.`;
			loaded.add(name);
			const directory = skill.directory
				? `\n\nSkill directory: ${skill.directory}\nRelative paths in this skill are relative to the skill directory.`
				: '';
			const resources = skill.resources?.length
				? `\n\n<skill_resources>\n${skill.resources.map((file) => `<file>${file}</file>`).join('\n')}\n</skill_resources>`
				: '';
			return `<skill_content name="${skill.name}">\n${skill.body}${directory}${resources}\n</skill_content>`;
		}
	};
}

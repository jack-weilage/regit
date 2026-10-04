<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatActivity from './ChatActivity.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import ChatStartup, { type StartupStage } from './ChatStartup.svelte';
	import ChatTools, { type ToolCallView } from './ChatTools.svelte';
	import Markdown from './Markdown.svelte';
	import type { Author } from './types.ts';

	const sam: Author = { name: 'Sam Rivera', kind: 'person' };
	const agent: Author = { name: 'ReGit', kind: 'agent' };

	const plan =
		"Members load all at once in `loadMembers`. I'll page them 50 at a time and check the settings page.";
	const done = 'Members now load in pages of 50, and `bun run check` passes.';
	const end = 118;

	const { Story } = defineMeta({
		title: 'Chat/Live thread',
		tags: ['!autodocs'],
		parameters: { layout: 'fullscreen' }
	});
</script>

<script lang="ts">
	const base = Date.now();
	let playing = $state(0);

	$effect(() => {
		const timer = setInterval(() => {
			playing = playing >= end + 6 ? 0 : playing + 1;
		}, 250);
		return () => clearInterval(timer);
	});

	const time = (second: number) => base + second * 1000;

	function stage(s: number, label: string, from: number, to: number): StartupStage {
		if (s < from) return { label, status: 'pending' };
		if (s < to) return { label, status: 'running', startedAt: time(from) };
		return { label, status: 'done', startedAt: time(from), finishedAt: time(to) };
	}

	function call(
		s: number,
		id: string,
		verb: [string, string],
		target: string,
		from: number,
		to: number
	): ToolCallView[] {
		if (s < from) return [];
		const running = s < to;
		return [
			{
				id,
				verb: running ? verb[0] : verb[1],
				target,
				status: running ? 'running' : 'done',
				startedAt: time(from),
				finishedAt: running ? undefined : time(to)
			}
		];
	}

	function typed(s: number, text: string, from: number, to: number) {
		return text.slice(0, Math.ceil((text.length * Math.min(s - from, to - from)) / (to - from)));
	}

	const stages = (s: number) => [
		stage(s, 'Start a 1 vCPU sandbox', 0, 7),
		stage(s, 'Clone regit', 7, 10),
		stage(s, 'Install node 24, bun 1.4.2', 10, 41),
		stage(s, 'Save the toolchain', 41, 49),
		stage(s, 'Start storybook', 49, 60)
	];

	const exploring = (s: number) => [
		...call(s, 'search', ['Searching for', 'Searched for'], 'loadMembers', 64, 65),
		...call(s, 'read', ['Reading', 'Read'], 'src/lib/members.ts', 65, 66),
		...call(s, 'edit', ['Editing', 'Edited'], 'src/lib/members.ts', 66, 67)
	];
</script>

{#snippet thread({ at }: { at?: number })}
	{@const s = Math.min(at ?? playing, end)}
	{@const now = time(s)}
	{@const checking = call(s, 'check', ['Running', 'Ran'], 'bun run check', 82, 110)}
	<div class="frame">
		<ChatLog label="Thread messages">
			<ChatGroup author={sam} own>
				<ChatMessage>The settings page takes forever to load for big orgs.</ChatMessage>
			</ChatGroup>
			<ChatStartup stages={stages(s)} finished={s >= 60} {now} />
			{#if s >= 64}
				<ChatGroup author={agent}>
					<ChatTools calls={exploring(s)} {now} />
					{#if s >= 67}
						<ChatMessage><Markdown source={typed(s, plan, 67, 80)} /></ChatMessage>
					{/if}
					{#if checking.length}
						<ChatTools calls={checking} {now} />
					{/if}
					{#if s >= 110}
						<ChatMessage><Markdown source={typed(s, done, 110, end)} /></ChatMessage>
					{/if}
				</ChatGroup>
			{:else if s >= 60}
				<ChatActivity since={time(60)} {now}>Thinking</ChatActivity>
			{/if}
		</ChatLog>
	</div>
{/snippet}

<Story name="Playback" template={thread} />

<Story
	name="Starting"
	args={{ at: 30 }}
	template={thread}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('status')).toHaveTextContent('Starting a sandbox · 30s');
		await expect(canvas.getByText('Install node 24, bun 1.4.2')).toBeVisible();
	}}
/>

<Story name="Thinking" args={{ at: 62 }} template={thread} />

<Story name="Streaming" args={{ at: 74 }} template={thread} />

<Story
	name="Running a check"
	args={{ at: 95 }}
	template={thread}
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Sandbox ready · 1m')).toBeVisible();
		await expect(canvas.getByText('bun run check')).toBeVisible();
	}}
/>

<Story name="Done" args={{ at: end }} template={thread} />

<style>
	.frame {
		display: flex;
		flex-direction: column;
		inline-size: 44rem;
		max-inline-size: 100%;
		block-size: 100dvh;
		margin-inline: auto;
		border-inline: 1px solid var(--color-border);
	}
</style>

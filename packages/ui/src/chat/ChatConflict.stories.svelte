<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn } from 'storybook/test';
	import ChatConflict from './ChatConflict.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Conflict',
		component: ChatConflict,
		tags: ['!autodocs'],
		args: {
			headline: 'perf(settings): page the member list',
			files: ['src/settings/members.ts'],
			onupdate: fn()
		}
	});
</script>

<Story
	name="One file"
	play={async ({ args, canvas, userEvent }) => {
		const conflict = canvas.getByRole('region', { name: 'Conflicts with main' });
		await expect(conflict).toHaveTextContent('perf(settings): page the member list landed');
		await expect(conflict).toHaveTextContent('src/settings/members.ts');
		await userEvent.click(canvas.getByRole('button', { name: 'Bring up to date' }));
		await expect(args.onupdate).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="Several files"
	args={{
		files: [
			'src/settings/members.ts',
			'src/settings/MembersList.svelte',
			'src/lib/server/members.test.ts'
		]
	}}
/>

<Story
	name="Updating"
	args={{ updating: true }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('button', { name: 'Updating…' })).toBeDisabled();
	}}
/>

<Story name="Without an action" args={{ onupdate: undefined }} />

<Story name="In thread" asChild>
	<div style="max-inline-size: 46rem; display: grid">
		<ChatLog label="Thread messages">
			<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}>
				<ChatMessage>Members now load as you scroll, and the checks pass.</ChatMessage>
			</ChatGroup>
			<ChatEvent>Checkpoint 4b02e7a</ChatEvent>
			<ChatConflict
				headline="perf(settings): page the member list"
				files={['src/settings/members.ts']}
				onupdate={fn()}
			/>
		</ChatLog>
	</div>
</Story>

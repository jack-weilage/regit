<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect, fn, waitFor } from 'storybook/test';
	import ChatBehindMain from './ChatBehindMain.svelte';
	import ChatEvent from './ChatEvent.svelte';
	import ChatGroup from './ChatGroup.svelte';
	import ChatLog from './ChatLog.svelte';
	import ChatMessage from './ChatMessage.svelte';

	const { Story } = defineMeta({
		title: 'Chat/Behind main',
		component: ChatBehindMain,
		tags: ['!autodocs'],
		args: {
			commits: 3,
			sha: '4b02e7a91c3d5f6e8a0b2c4d6e8f0a1b2c3d4e5f',
			headline: 'perf(settings): page the member list',
			onupdate: fn()
		}
	});
</script>

<Story
	name="Behind"
	play={async ({ args, canvas, userEvent }) => {
		const card = canvas.getByRole('region', { name: 'Main has 3 new commits' });
		await expect(card).toHaveTextContent('4b02e7a');
		await expect(card).toHaveTextContent('perf(settings): page the member list');
		await expect(card).not.toHaveTextContent('Conflicts');
		await userEvent.click(canvas.getByRole('button', { name: 'Bring up to date' }));
		await expect(args.onupdate).toHaveBeenCalledOnce();
	}}
/>

<Story
	name="One commit"
	args={{ commits: 1 }}
	play={async ({ canvas }) => {
		await expect(canvas.getByRole('region', { name: 'Main has 1 new commit' })).toBeVisible();
	}}
/>

<Story
	name="Conflicts"
	args={{ conflicts: ['src/settings/members.ts'] }}
	play={async ({ canvas }) => {
		const card = canvas.getByRole('region', { name: 'Main has 3 new commits' });
		await expect(card).toHaveTextContent('Conflicts in 1 file');
		await expect(card).toHaveTextContent('src/settings/members.ts');
	}}
/>

<Story
	name="Many conflicts"
	args={{
		headline:
			'refactor(settings): move member loading, invitations and role editing into one paginated service',
		conflicts: [
			'src/settings/members.ts',
			'src/settings/MembersList.svelte',
			'src/settings/invitations/InviteDialog.svelte',
			'src/settings/roles.ts',
			'src/lib/server/organizations/members/pagination.test.ts',
			'src/lib/server/organizations/members/queries.ts',
			'src/routes/(app)/[org]/settings/members/+page.server.ts',
			'src/routes/(app)/[org]/settings/members/+page.svelte',
			'package.json'
		]
	}}
	play={async ({ canvas, userEvent }) => {
		const files = () => canvas.getAllByRole('listitem');
		await expect(files()).toHaveLength(4);
		await userEvent.click(canvas.getByRole('button', { name: 'Show 5 more' }));
		await waitFor(() => expect(files()).toHaveLength(9));
		await userEvent.click(canvas.getByRole('button', { name: 'Show fewer' }));
		await waitFor(() => expect(files()).toHaveLength(4));
	}}
/>

<Story
	name="Five conflicts"
	args={{
		conflicts: [
			'src/settings/members.ts',
			'src/settings/MembersList.svelte',
			'src/settings/roles.ts',
			'src/lib/server/members.test.ts',
			'README.md'
		]
	}}
	play={async ({ canvas }) => {
		await expect(canvas.getAllByRole('listitem')).toHaveLength(5);
		await expect(canvas.queryByRole('button', { name: /more/ })).toBeNull();
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
			<ChatEvent
				>Main moved: "perf(settings): page the member list" conflicts with this thread in
				src/settings/members.ts</ChatEvent
			>
			<ChatBehindMain
				commits={3}
				sha="4b02e7a91c3d5f6e8a0b2c4d6e8f0a1b2c3d4e5f"
				headline="perf(settings): page the member list"
				conflicts={['src/settings/members.ts']}
				onupdate={fn()}
			/>
		</ChatLog>
	</div>
</Story>

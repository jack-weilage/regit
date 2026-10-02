<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Avatar from './Avatar.svelte';

	const { Story } = defineMeta({
		title: 'Avatar',
		component: Avatar,
		args: { name: 'Sam Rivera' }
	});
</script>

<Story name="Circle" />
<Story name="Square" args={{ name: 'ReGit', shape: 'square' }} />
<Story name="Palette" asChild>
	<div style="display: flex; gap: 0.5rem; --avatar-size: 2.5rem">
		{#each ['Sam Rivera', 'Ada Okafor', 'Lin Wei', 'Mira Kask', 'Tomás Ruiz', 'Noor Haddad'] as name (name)}
			<Avatar {name} />
		{/each}
	</div>
</Story>

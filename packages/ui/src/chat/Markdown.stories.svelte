<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { expect } from 'storybook/test';
	import ChatGroup from './ChatGroup.svelte';
	import ChatMessage from './ChatMessage.svelte';
	import Markdown from './Markdown.svelte';

	const { Story } = defineMeta({ title: 'Chat/Markdown', component: Markdown });

	const reply = `The repository has one tracked file, \`README\`. It says:

\`\`\`text
Hello World!
\`\`\`

## What I'd change

1. Load members **in pages of 50** instead of all at once.
2. Render the first page *immediately*.
   - Keep the old endpoint working.
   - [x] Existing tests pass
   - [ ] New test for scrolling

> Settings render in under a second for 10k members.

| File | Change |
| --- | ---: |
| \`members.ts\` | +42 −8 |
| \`settings.svelte\` | +6 −1 |

See the [Svelte docs](https://svelte.dev/docs) for \`$state\`.`;
</script>

<Story
	name="In a message"
	asChild
	play={async ({ canvas }) => {
		await expect(canvas.getByText('Hello World!').tagName).toBe('CODE');
		await expect(canvas.getByText('in pages of 50').tagName).toBe('STRONG');
		await expect(canvas.getByRole('table')).toBeVisible();
		await expect(canvas.getByRole('img', { name: 'Done' })).toBeVisible();
		await expect(canvas.getByRole('link', { name: 'Svelte docs' })).toHaveAttribute(
			'href',
			'https://svelte.dev/docs'
		);
	}}
>
	<div style="inline-size: 36rem">
		<ChatGroup author={{ name: 'ReGit', kind: 'agent' }}>
			<ChatMessage><Markdown source={reply} /></ChatMessage>
		</ChatGroup>
	</div>
</Story>

<Story name="Own message" asChild>
	<div style="inline-size: 36rem">
		<ChatGroup author={{ name: 'Sam Rivera', kind: 'person' }} own>
			<ChatMessage><Markdown source={'Can we use `usePager` from **lib/paging**?'} /></ChatMessage>
		</ChatGroup>
	</div>
</Story>

<Story
	name="Unsafe input"
	args={{
		source:
			'<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n[click me](javascript:alert(3)) and ![x](javascript:alert(4))'
	}}
	play={async ({ canvasElement, canvas }) => {
		await expect(canvasElement.querySelector('img, script')).toBeNull();
		await expect(canvas.queryByRole('link')).toBeNull();
		await expect(canvas.getByText(/<img src=x onerror/)).toBeVisible();
		await expect(canvas.getByText(/click me and x/)).toBeVisible();
	}}
/>

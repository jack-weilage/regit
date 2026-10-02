import type { Preview } from '@storybook/svelte-vite';
import '../src/theme.css';

export default {
	tags: ['autodocs'],
	parameters: {
		a11y: { test: 'error' }
	}
} satisfies Preview;

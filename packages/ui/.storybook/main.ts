import type { StorybookConfig } from '@storybook/svelte-vite';

export default {
	framework: '@storybook/svelte-vite',
	stories: ['../src/**/*.stories.svelte'],
	addons: [
		'@storybook/addon-svelte-csf',
		'@storybook/addon-docs',
		'@storybook/addon-a11y',
		'@storybook/addon-vitest'
	]
} satisfies StorybookConfig;

---
name: storybook
description: Write or update Svelte component stories in packages/ui, which are also the component tests. Use when adding or changing a component in packages/ui.
---

# Stories in packages/ui

Every shared component in `packages/ui` has a Svelte CSF story file next to it (`Button.svelte` → `Button.stories.svelte`). Vitest runs every story in Chromium with accessibility checks, so stories are the component tests.

## Writing a story file

- Define the meta in `<script module>` with `defineMeta` from `@storybook/addon-svelte-csf`: a `title` such as `Chat/Thread message`, the `component`, and `tags: ['!autodocs']`.
- Give each meaningful state its own `<Story name="…">`: empty, loading, error and long content, not only the happy path.
- Use fixtures from `src/chat/fixtures.ts` instead of inventing data in each file.
- Pass callbacks as `fn()` from `storybook/test` so play functions can assert on them.

## Interactions

- Cover interactions in a `play` function with `canvas` and `userEvent`, and assert with `expect`.
- Wrap assertions on anything that animates in (popovers, palettes, `chat-enter` elements) in `waitFor`.
- Query by role and accessible name (`getByRole('button', { name: 'Start' })`) so the checks double as accessibility checks.

## Styling and checks

- Style with the tokens in `src/theme.css`; use the `--space-1` to `--space-7` scale for spacing, and em for sizes that belong to text.
- The accessibility check fails on low contrast: don't dim muted text further with opacity.
- Run one file with `bunx vitest run src/chat/<Name>.stories.svelte` from `packages/ui`, and `bun run check` before finishing.

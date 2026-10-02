# ReGit

Bun workspace: `apps/*` (deployables) and `packages/*` (shared code consumed as TypeScript source, no build step). Shared dependency versions live in the root `catalog`; reference them with `"catalog:"`.

## Conventions

- SvelteKit 3, Svelte 5 runes, experimental async and remote functions are on. Config lives in `vite.config.ts`, not `svelte.config.js`.
- Import app code with `#lib/...`, not `$lib`. Read bindings with `import { env } from 'cloudflare:workers'`, not `platform.env`.
- Use the `--space-1` to `--space-7` scale in `theme.css` (2–20px, in rem) for padding, margins and gaps rather than raw values; borders and focus outlines stay in px.
- Shared components live in `packages/ui`, each with a Svelte CSF story (`*.stories.svelte`). Style with the tokens in `theme.css`.
- Durable Objects, Workflows and containers belong in `apps/forge`. `apps/web` binds to them with `script_name: "regit-forge"`.
- `worker-configuration.d.ts` is generated and gitignored. After editing a `wrangler.jsonc`, run `bun run gen`.
- Stories are the component tests: Vitest runs every story in Chromium with accessibility checks, and `play` functions cover interactions. Wrap assertions on anything that animates in with `waitFor`.
- Keep code self-explanatory with minimal comments. Run `bun run check` and `bun run test` before considering work done.

# ReGit

Bun workspace: `apps/*` (deployables) and `packages/*` (shared code consumed as TypeScript source, no build step). Shared dependency versions live in the root `catalog`; reference them with `"catalog:"`.

## Conventions

- SvelteKit 3, Svelte 5 runes, experimental async and remote functions are on. Config lives in `vite.config.ts`, not `svelte.config.js`.
- Import app code with `#lib/...`, not `$lib`. Read bindings with `import { env } from 'cloudflare:workers'`, not `platform.env`.
- Shared components live in `packages/ui`, each with a Svelte CSF story (`*.stories.svelte`). Style with the tokens in `theme.css`.
- Durable Objects, Workflows and containers belong in `apps/forge`. `apps/web` binds to them with `script_name: "regit-forge"`.
- `worker-configuration.d.ts` is generated and gitignored. After editing a `wrangler.jsonc`, run `bun run gen`.
- Keep code self-explanatory with minimal comments. Run `bun run check` before considering work done.

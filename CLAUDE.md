# ReGit

Bun workspace: `apps/*` (deployables) and `packages/*` (shared code consumed as TypeScript source, no build step). Shared dependency versions live in the root `catalog`; reference them with `"catalog:"`.

## Conventions

- SvelteKit 3, Svelte 5 runes, experimental async and remote functions are on. Config lives in `vite.config.ts`, not `svelte.config.js`.
- Import app code with `#lib/...`, not `$lib`. Read bindings with `import { env } from 'cloudflare:workers'`, not `platform.env`. In `apps/web`, touch `env` only inside functions: the build imports server modules where bindings don't exist.
- Use the `--space-1` to `--space-7` scale in `theme.css` (2–20px, in rem) for padding, margins and gaps rather than raw values; borders and focus outlines stay in px. Sizes that belong to text (icons, inline avatars, button, bubble and chip padding) use em so they scale with it; `--chat-inset` aligns content with the composer's text.
- Shared components live in `packages/ui`, each with a Svelte CSF story (`*.stories.svelte`). Style with the tokens in `theme.css`.
- Durable Objects, Workflows and containers belong in `apps/forge`, which has no API of its own. `apps/web` binds to them with `script_name: "regit-forge"` and types them with the interfaces in `@regit/core` (e.g. `RepoCoordinatorApi`, which the class implements).
- In wrangler's test harness, `bindingOverrides` only applies to Workers loaded with `configPath`; on an inline `config` it is silently ignored and the real binding is used.
- The agent loop, model clients and sandbox tool clients live in `packages/agent` as plain TypeScript that takes its model, tools and storage as interfaces, so it is unit tested with fakes. `apps/sandbox` is the container's tool server (`bun run image` builds it); it is tested in-process against a temporary git repo.
- Leave a one-line `// TODO:` where a deferred follow-up belongs.
- The sandbox image is mise-based: toolchains come from the repository's version files (installed and snapshotted per repo by `AttemptSandbox`) plus `apps/sandbox/mise-system.toml`. Locally, containers can't reach the internet over HTTPS (Miniflare's egress sidecar resets it), so tests must not depend on downloads.
- Data shared across repos lives in D1 (`DB`), defined with Drizzle in `packages/db`; forge and web both bind it, and web owns repo creation (D1 plus its own Artifacts binding). After changing `packages/db/src/schema.ts`, run `bun run --filter @regit/db generate`. Per-repo live state stays in Durable Object SQLite. Locally both workers persist to the root `.wrangler/state`, and forge's `dev` applies migrations.
- `worker-configuration.d.ts` is generated and gitignored. After editing a `wrangler.jsonc`, run `bun run gen`.
- Stories are the component tests: Vitest runs every story in Chromium with accessibility checks, and `play` functions cover interactions. Wrap assertions on anything that animates in with `waitFor`.
- Keep code self-explanatory with minimal comments. Run `bun run check` and `bun run test` before considering work done.

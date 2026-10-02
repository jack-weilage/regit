# ReGit

An agent-first Git forge on Cloudflare Workers and Artifacts.

## Layout

| Path            | What                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `apps/web`      | SvelteKit 3 app on Workers: control panel and API (`regit-web`)               |
| `apps/forge`    | Worker for Durable Objects, Workflows, containers and portals (`regit-forge`) |
| `packages/core` | Shared domain types and pure logic                                            |
| `packages/ui`   | Svelte components and theme, developed in Storybook                           |

`web` reaches `forge` through the `FORGE` service binding, and through `script_name` bindings for its Durable Objects and Workflows.

## Develop

Requires [Bun](https://bun.com) 1.4+.

```sh
bun install
bun run dev
```

`bun run dev` starts `forge` on <http://localhost:8787> and `web` on <http://localhost:5173>. Bindings across the two Workers resolve locally through Wrangler's dev registry.

| Command             | What                                                         |
| ------------------- | ------------------------------------------------------------ |
| `bun run storybook` | Storybook for `packages/ui` on <http://localhost:6006>       |
| `bun run check`     | Type-check every workspace                                   |
| `bun run test`      | Run story tests (interactions and accessibility) in Chromium |
| `bun run build`     | Build every workspace                                        |
| `bun run gen`       | Regenerate binding types after a `wrangler.jsonc` change     |
| `bun run format`    | Format with Prettier                                         |

Git hooks run through lefthook: pre-commit formats staged files, and pre-push runs `check`.

## License

[MIT](LICENSE)

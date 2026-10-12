# ReGit

An agent-first Git forge on Cloudflare Workers and Artifacts.

## Layout

| Path            | What                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `apps/web`      | SvelteKit 3 app on Workers: control panel and API (`regit-web`)         |
| `apps/forge`    | Runtime, repository admission, Git ingress and previews (`regit-forge`) |
| `apps/sandbox`  | Container tool server and image consumed by forge                       |
| `packages/core` | Shared domain types and pure logic                                      |
| `packages/ui`   | Svelte components and theme, developed in Storybook                     |

The three deployables are web, forge and the sandbox image. Web reaches forge's Durable Objects through `script_name` bindings. Repository access uses principal membership in D1; canonical writes go exclusively through `RepositoryGit` admission and publication.

Forge serves `git.regit.dev` outside Access, authenticating clone/fetch with hashed, expiring, read-only D1 tokens and current repository membership; receive-pack is always refused. Contribution forks and a local CLI remain deferred.

## Threads and publication

Each thread has one agent, running in its own Durable Object with its own fork of the repository. It answers, investigates and edits whenever someone in the thread asks, and keeps the thread's intent (a headline, purpose and done-when checks) current with `update_intent`. The intent explains what the thread's changes are for: people follow it, and other threads' agents use it to spot duplicate or overlapping work and to understand the changes later.

Preparing a candidate does not publish it. A separate Git-only publisher constructs a single commit against an exact canonical head, and a repository owner explicitly approves that exact candidate. Publication uses a conditional ref update. When main has moved or the candidate conflicts with it, the candidate fails and is handed back to its thread: the agent merges main into the thread, resolves any conflicts and re-runs checks, and a new candidate is prepared for approval, up to three times in a row. Thread containers never receive canonical write authority.

After publication, `refs/notes/regit` records the source revision, the thread's intent and the authorizing principal. Notes publication retries independently of the code update. Operational state remains in SQLite; Git notes are exported provenance, not the mutable coordination database. The next time the thread's agent works, its fork is rebased onto the published commit, so a thread can keep going and publish again.

Every push to a repository's branch arrives as an Artifacts `cf.artifacts.repo.pushed` event, which starts forge's `RepoPushed` Workflow. The repository coordinator then compares each active thread's fork with the new main, recording how many commits behind it is and, through `git merge-tree`, which files now conflict. Each thread repeats that comparison in its own container at the start and end of every turn and after each checkpoint, so it doesn't depend on push events, so warnings also track the thread's own edits. When a file newly conflicts, the agent gets a system notification at its next tool call or message, including in a thread that was idle when main moved; its workspace stays as it is until someone brings it up to date. A thread's fork only takes main when someone brings it up to date or a stale candidate is handed back, and the agent is told what landed each time.

Stacked execution on unpublished revisions, dependencies between threads, standing policies and budgets, an attention inbox, and explicit outcome confirmation are not implemented yet. Local CLI and other-agent contribution access remain TODO.

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

### Bootstrapping ReGit inside ReGit

The repository's `.agents/setup` installs its mise-pinned Bun and Node versions, locked workspace dependencies, and Playwright's matching Chromium. It installs browser system libraries only if a launch check fails. `.agents/resume` checks the installed toolchains, workspace dependencies and browser without downloading anything. Both scripts run automatically in a ReGit sandbox; with mise installed, run them manually from the repository root with `bash .agents/setup` and `bash .agents/resume`.

`bun run test` runs the workspace suites sequentially to fit a small sandbox. Regular forge tests use `apps/forge/test/wrangler.jsonc`, fake model/Artifacts Workers, disposable local D1, and a local sandbox process: no Cloudflare credentials or Docker are required. `bun run --filter @regit/forge test:containers` remains a separate infrastructure check using the deployment configuration and requires Docker plus access to its remote bindings. Full web/forge development still uses the development bindings described above; the local test configuration does not configure a standalone full-stack preview.

The saved Storybook service starts after setup has installed dependencies. Component tests use Playwright's browser, independently of the agent-browser installation used by agents for visual inspection.

## Repository lifecycle scripts

ReGit runs optional `.agents/setup` and `.agents/resume` Bash scripts from the repository root, after installing the repository's mise toolchains and before restoring services or starting the agent. An executable bit is not required. Each runs with `bash -e`, the sandbox environment, and a 15-minute deadline; use `set -euo pipefail` if pipelines should fail too. Exports do not persist into other processes: put persistent configuration in files or service definitions.

- **Setup** installs dependencies and prepares disposable local data. Successful setup is snapshotted before resume or services run. Matching restores preserve setup-created files, including across thread forks, and skip setup. The cache is scoped to the repository and keyed by container image, installed toolchain versions, and exact Git revision; any tracked change invalidates it. A missing, oversized, or unrestorable snapshot falls back to setup.
- **Resume** runs after setup or a matching cache restore. Use it for per-run configuration and readiness checks that must not be cached. Keep long-running processes in `.agents/services.yml`, managed by `regit services`, rather than backgrounding them in a script.
- Reusing an already-ready workspace does not rerun either script. Edits to scripts take effect on the next reconstruction; an agent can run them explicitly when needed. Write both scripts to be idempotent, since failed startup can be retried.
- A missing script is skipped. A nonzero exit or timeout blocks the agent and automatic service restoration; the failure includes bounded stdout/stderr. A failed workspace is not marked ready.
- Startup shows setup execution or cache reuse, snapshot creation, and resume. Expand a script's output after it completes; failed output opens automatically. Output is not streamed while the script runs. Never print secrets or write credentials into a cached setup environment.

For example, `.agents/setup` in a Bun repository could contain:

```bash
set -euo pipefail
bun install --frozen-lockfile
```

The local `SANDBOX_URL` path uses the same toolchain/setup/resume ordering without container snapshots. Git-only publication does not execute these scripts. Hooks execute repository-controlled code with the sandbox's existing permissions; they do not grant deployment or canonical publication authority. Do not use production credentials or shared databases in setup; use disposable local fixtures.

## License

[MIT](LICENSE)

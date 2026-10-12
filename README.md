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

Deployment migration is still required: remove the existing `git.regit.dev/*` route from the shared `regit-git` deployment before assigning that explicit route to forge. The wildcard preview route alone cannot override it. This repository change does not modify or delete the existing remote deployment; web's `GIT_HOST` stays `git.regit.dev`.

## Acceptance and publication

The repository Durable Object owns accepted intent versions, run identities, captured revisions, candidate assessments and publication records. A thread is the conversational view; a run is a separate executor with its own fork. Agents can propose changes to intent, but only a person accepts a new version. Run dispatch is persisted and retried with the same input.

Preparing a candidate does not publish it. A separate Git-only publisher constructs a single commit against an exact canonical head, then an independent read-only verifier assesses that commit. The assessment is model judgment, not trusted executable proof. A repository owner explicitly approves the exact candidate, including any override of an adverse assessment. Publication uses a conditional ref update; a stale base requires preparing and approving a new candidate. Coding and verifier containers never receive canonical write authority.

After publication, `refs/notes/regit` records the source revision, accepted intent, assessment and authorizing principal. Notes publication retries independently of the code update. Operational state remains in SQLite; Git notes are exported provenance, not the mutable coordination database.

Proposals can pin exact revisions of other proposals in the same repository. Runs wait until every prerequisite revision has published; their bases and publication candidates must contain those published commits. Changing pins versions the accepted intent and requires a new run. Accepted upstream intent changes stale dependent pins; pins never advance automatically, and cycles are rejected. Dependency pins are included in the accepted intent exported to Git notes.

This is prerequisite execution, not speculative stacked execution on unpublished revisions. Stacked execution, alternative-revision selection, standing policies and budgets, an attention inbox, and explicit outcome confirmation are not implemented yet. Local CLI and other-agent contribution access remain TODO.

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

- **Setup** installs dependencies and prepares disposable local data. Successful setup is snapshotted before resume or services run. Matching restores preserve setup-created files, including across run forks, and skip setup. The cache is scoped to the repository and keyed by container image, installed toolchain versions, and exact Git revision; any tracked change invalidates it. A missing, oversized, or unrestorable snapshot falls back to setup.
- **Resume** runs after setup or a matching cache restore. Use it for per-run configuration and readiness checks that must not be cached. Keep long-running processes in `.agents/services.yml`, managed by `regit services`, rather than backgrounding them in a script.
- Reusing an already-ready workspace does not rerun either script. Edits to scripts take effect on the next reconstruction; an agent can run them explicitly when needed. Write both scripts to be idempotent, since failed startup can be retried.
- A missing script is skipped. A nonzero exit or timeout blocks the agent and automatic service restoration; the failure includes bounded stdout/stderr. A failed workspace is not marked ready.
- Startup shows setup execution or cache reuse, snapshot creation, and resume. Expand a script's output after it completes; failed output opens automatically. Output is not streamed while the script runs. Never print secrets or write credentials into a cached setup environment.

For example, `.agents/setup` in a Bun repository could contain:

```bash
set -euo pipefail
bun install --frozen-lockfile
```

The local `SANDBOX_URL` path uses the same toolchain/setup/resume ordering without container snapshots. Independent candidate verification bypasses the cache and runs scripts from the exact pinned candidate, not the moving branch tip, and still rejects a modified candidate workspace. Git-only publication does not execute these scripts. Hooks execute repository-controlled code with the sandbox's existing permissions; they do not grant deployment or canonical publication authority. Do not use production credentials or shared databases in setup; use disposable local fixtures.

## Deploying the acceptance migration

This release needs a coordinated maintenance window; do not deploy web and forge independently while users are starting or shipping work.

Before changing production:

1. Run `bun run lint`, `bun run check`, `bun run test`, `bun run build`, and `bun run --filter @regit/forge test:containers`. The forge build is a Wrangler dry run; it does not deploy.
2. Pause new work and let existing runs and legacy shipments finish. Confirm no legacy thread remains `shipping`: the new executor disables legacy shipping, and those threads have no promotion record to reconcile their status. Preserve any unfinished work before proceeding.
3. Record deployed worker versions and routing, back up D1, and retain the current code/container versions. D1 backups do not include Durable Object state or Artifacts repositories.

During the approved maintenance window:

1. Apply the additive D1 migration **before** either new worker. `bun run --filter @regit/forge deploy` applies it before deploying forge and its containers, including the new `RepositoryGit` publisher. Confirm the existing `git.regit.dev/*` route can be transferred from `regit-git` to forge; remove the old assignment as part of this coordinated cutover, not during normal traffic.
2. Run `bun run --filter @regit/web deploy` after forge is available. The new web API requires the new forge methods.
3. Have existing repository owners sign in through Cloudflare Access. Their exact matching legacy email claims repository membership and previously unclaimed tokens. Verify ownership and provision any additional memberships before restoring access; do not assume old shared tokens grant membership.
4. Confirm `git.regit.dev/*` reaches forge. Disable every other public route to the old `regit-git` worker, including any workers.dev endpoint, so it cannot bypass canonical-write admission. Keep the old deployment only as an inaccessible rollback artifact.
5. Smoke-test owner and non-owner access, clone/fetch, rejected direct pushes, and the complete accept → run → prepare → approve flow. Verify the canonical commit and `refs/notes/regit`; verify that a candidate whose base moved cannot publish.

Legacy completed attempts remain readable but have no accepted-intent/run ledger. They cannot be prepared for publication directly: accept the intent and start a new run, preserving or explicitly recovering earlier work as needed. This release does not automatically adopt legacy revisions.

If cutover fails, keep traffic paused and restore a compatible web/forge pair and route configuration. The D1 additions may remain, but restoring older binaries is not a rollback of new Durable Object or Git writes. Do not reopen the old write-capable Git ingress without explicitly accepting that it bypasses the new publication boundary.

## License

[MIT](LICENSE)

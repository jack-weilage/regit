# regit

A merge service for coding agents, built on Cloudflare Workers and [Artifacts](https://developers.cloudflare.com/artifacts/).

Each agent works in its own fork. A change reaches trunk only through one integrator, and only after its tests pass against the current trunk head. Every landed commit carries the agent threads behind it as plain git notes, so the next agent can read why the code is the way it is with a stock git client.

There are no pull requests.

## Status

Early, and built for a demo. The merge path works end to end in local tests: task, fork, submit, verify in a sandbox, targeted tests, land, notes. It has not yet run against the real Cloudflare services, which is what the spikes below are for. There is no dashboard yet.

## How it fits together

| Part | Where it runs | What it may write to |
| --- | --- | --- |
| Agent | Anywhere | Its own fork |
| Control Worker | Workers | Nothing in git. It forks repositories and mints tokens. |
| Verifier | A sandbox container, one per candidate | The agent's fork |
| Integrator | A Durable Object | Trunk, including its notes |

The Artifacts Workers binding can create, fork and read repositories but cannot write to them, so the integrator pushes with [isomorphic-git](https://isomorphic-git.org/) over an in-memory filesystem. The verifier runs agent-written code and tests, so it never holds a token that can write to trunk. It leaves the verified commit on a ref in the agent's fork, and the integrator fetches that commit, checks it is the one that was verified, and fast-forwards trunk to it.

## What happens to a submission

1. The verifier squashes the agent's branch onto the trunk head with real git, in a sandbox, and leaves that one commit on a ref in the agent's fork. A conflict is reported back with the decision record of the change it collided with.
2. The integrator fetches the commit and checks it is the one the sandbox reported, sitting directly on the trunk head.
3. The integrator decides how much testing the change needs. Path rules and the Clef decision model can only add scrutiny. It then selects the test files that reach the changed files through the import graph, or the whole suite when it cannot be sure.
4. The sandbox runs those tests, after its git credentials have been removed.
5. The integrator lands the commit and writes two notes on it: `refs/notes/threads` (what the agent decided and why) and `refs/notes/evidence` (what was tested and how it landed).

Several candidates are verified at once against the same trunk head. The first lands as verified. A later one is replayed onto the new head without re-running its tests only when nothing that landed in between touches its files or anything its tests import, and it touches nothing their tests import. Otherwise it is verified again.

A change to how the repository is tested (`regit.json`, test runner configuration, `package.json` scripts, CI files) is refused unless the admin created the task with `allowProtected`.

### Routes

| Route | Caller | What it does |
| --- | --- | --- |
| `POST /repos` | admin | Register a trunk: `{name, files}` to create one, `{name, import: {url}}` to import, `{name, adopt: true}` for an existing Artifacts repo |
| `POST /repos/:repo/tasks` | admin | Fork trunk for an agent. Returns the fork with a write token, trunk with a read token, a task token, and past decisions for the paths named |
| `POST /repos/:repo/submit` | task | Queue a pushed branch: `{task, ref, thread: {decision, rejected}}` |
| `GET /repos/:repo/candidates/:id` | task | Outcome, evidence, and what to do next |
| `GET /repos/:repo/why?path=` | task | What landed on a path and why, and what was tried and rejected |
| `GET /repos/:repo/candidates`, `/events` | admin | Everything, for a dashboard |
| `POST /repos/:repo/pause`, `/resume` | admin | Hold and release the queue |

The test command comes from `regit.json` at the trunk head: `{"install": "npm ci", "test": "npx vitest run", "testMatch": "\\.test\\.ts$"}`. Test files are appended to `test` as arguments.

### Known limits

- Test targeting reads import statements. It follows relative imports only, and falls back to the full suite for path aliases, non-module files, deletions and anything else it cannot see through.
- The integrator holds the trunk snapshot in memory, so trunk must be small (tens of megabytes).
- Nothing limits the size of a submitted change.
- If the decision model cannot be reached at submission, the thread record is published unscreened and the evidence note says so.

## Run the spikes

The design rests on six assumptions that the Cloudflare documentation does not settle. Each spike tests one against the real services and reports a verdict, the measurements behind it, and the fallback if it fails.

| Spike | Assumption |
| --- | --- |
| `notes` | Artifacts accepts a push to `refs/notes/*` and serves it back. |
| `cas` | A ref update with a stale expected value is rejected. |
| `land` | isomorphic-git in a Worker can fetch a commit from a fork and push it to trunk. |
| `forks` | A fork completes in a few seconds and is usable straight away. |
| `sandbox` | A sandbox can start, clone, install and run tests in well under a minute. |
| `clef` | Clef-flash gives sensible, repeatable risk tiers and catches bad thread records. |

You need a Cloudflare account on the Workers Paid plan with Artifacts, Containers and Workers AI available.

```sh
npm install
npx wrangler login

# Choose an admin token. Every route that creates repositories, mints tokens
# or starts containers requires it. `.secrets` is ignored by git.
echo "REGIT_ADMIN_TOKEN=$(openssl rand -hex 24)" > .secrets

# The first deploy has to carry the secret. Later deploys are plain `npx wrangler deploy`.
npx wrangler deploy --secrets-file .secrets

# Use the URL that `wrangler deploy` printed. The runner reads the token from `.secrets`.
node scripts/spikes.mjs https://regit.<your-subdomain>.workers.dev
```

The runner prints one line per spike and writes the full reports to `spike-results.json`. The spikes create repositories named `spike-*` in the `regit` Artifacts namespace and delete them when they finish.

To measure against a real repository instead of the small seeded one:

```sh
node scripts/spikes.mjs https://regit.<your-subdomain>.workers.dev \
  --only land,forks,sandbox \
  --import https://github.com/<owner>/<repo> \
  --install "npm ci" --test "npm test"
```

## Local tests

```sh
npm test
npm run typecheck
```

`wrangler dev` has no local simulation of Artifacts, so the tests run against a local git server backed by the real `git http-backend` (`test/git-server.ts`). It enforces read and write tokens the way Artifacts does.

- `test/ops.test.ts` runs the git library against that server and checks every result with the stock git client.
- `test/flow.test.ts` starts the Worker in workerd and runs the whole merge path, with the stock git client as the agents and a local command server as the sandbox.
- `test/targeting.test.ts` covers test selection.
- `test/spikes.test.ts` runs the `notes`, `cas`, `land` and `forks` spikes through the Worker.

The local tests show that the code runs in the Workers runtime. They cannot show how Artifacts, Sandboxes or Clef behave, which is what the deployed spikes are for. The `sandbox` and `clef` spikes have no local test, and the local tests run with the decision model off.

## Layout

```
src/index.ts            Worker entry
src/api.ts              control routes and authorization
src/integrator.ts       Durable Object: queue, risk, test selection, landing, notes
src/verifier.ts         Durable Object: squash and test in a sandbox
src/sandbox.ts          the container, and the test stand-in for it
src/targeting.ts        test selection from the import graph
src/clef.ts             risk tier and note screen, with Clef-flash
src/git/ops.ts          fetch, commit, diff, land and notes, with isomorphic-git
src/git/memory-fs.ts    the in-memory filesystem those run on
src/artifacts.ts        helpers around the Artifacts binding
src/spikes/             the day-one spikes
src/dev/                a stand-in for the Artifacts binding, used only by tests
scripts/spikes.mjs      runs the spikes against a deployed Worker
test/                   local git server, sandbox server, Worker harness and tests
```

## License

MIT. See [LICENSE](LICENSE).

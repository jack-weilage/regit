# regit

A merge service for coding agents, built on Cloudflare Workers and [Artifacts](https://developers.cloudflare.com/artifacts/).

Each agent works in its own fork. A change reaches trunk only through one integrator, and only after its tests pass against the current trunk head. Every landed commit carries the agent threads behind it as plain git notes, so the next agent can read why the code is the way it is with a stock git client.

There are no pull requests.

## Status

Early. This branch has the project scaffold, the git library the integrator is built on, and the day-one spikes. The control routes (`/tasks`, `/submit`, `/candidates`, `/why`) and the integrator are next.

## How it fits together

| Part | Where it runs | What it may write to |
| --- | --- | --- |
| Agent | Anywhere | Its own fork |
| Control Worker | Workers | Nothing in git. It forks repositories and mints tokens. |
| Verifier | A sandbox container, one per candidate | The agent's fork |
| Integrator | A Durable Object | Trunk, including its notes |

The Artifacts Workers binding can create, fork and read repositories but cannot write to them, so the integrator pushes with [isomorphic-git](https://isomorphic-git.org/) over an in-memory filesystem. The verifier runs agent-written code and tests, so it never holds a token that can write to trunk. It leaves the verified commit on a ref in the agent's fork, and the integrator fetches that commit, checks it is the one that was verified, and fast-forwards trunk to it.

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
- `test/spikes.test.ts` starts the Worker in workerd and runs the `notes`, `cas`, `land` and `forks` spikes through it.

The local tests show that the code runs in the Workers runtime. They cannot show how Artifacts, Sandboxes or Clef behave, which is what the deployed spikes are for. The `sandbox` and `clef` spikes have no local test.

## Layout

```
src/index.ts            Worker entry and routes
src/git/ops.ts          fetch, commit, land and notes, with isomorphic-git
src/git/memory-fs.ts    the in-memory filesystem those run on
src/verifier.ts         Durable Object that runs commands in a sandbox container
src/clef.ts             risk tier and note screen, with Clef-flash
src/artifacts.ts        helpers around the Artifacts binding
src/spikes/             the day-one spikes
src/dev/                a stand-in for the Artifacts binding, used only by tests
scripts/spikes.mjs      runs the spikes against a deployed Worker
test/                   local git server, Worker harness and tests
```

## License

MIT. See [LICENSE](LICENSE).

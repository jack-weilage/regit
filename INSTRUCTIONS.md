# Using and running ReGit

There are three ways in, from least to most setup:

1. [Try it on regit.dev](#try-it-on-regitdev): sign in, create a repository, open a thread.
2. [Run it locally](#run-it-locally): both Workers on your machine, against your own Cloudflare account's remote bindings.
3. [Deploy your own](#deploy-your-own): the full stack on your own Cloudflare account and domains.

See the [README](README.md) for what ReGit is and how threads, shipping and verification work.

## Try it on regit.dev

<!-- TODO: replace the Cloudflare Access steps once regit.dev has its own sign-in. -->

regit.dev is behind Cloudflare Access. Ask the operator to let your email through, then open <https://regit.dev> and sign in.

### Create a repository

Choose **New repository…** and type a name for an empty repository, or paste the URL of a public Git repository to import it (private imports aren't supported yet). You become its owner.

### Work in threads

Open a thread by describing what you want, such as a question, a bug or a feature. Each thread gets its own agent, its own fork of the repository and its own sandbox container:

- The agent keeps the thread's **intent** (a headline, a purpose and done-when checks) up to date as it works. It runs the repository's checks before handing a turn back.
- When you open a thread, pick a mode (auto, small, medium or large) to choose a smaller or larger model; the thread keeps that model. Reply in the thread to steer it.
- If the repository has long-running services in `.agents/services.yml`, start them from the thread's **Services** panel. They're served at `<id>-<service>.regit.run`.
- When a thread is done, an owner **ships** it. This squashes its changes into one commit on `main`. If the thread conflicts with `main`, it goes back to the agent to resolve.

After a commit lands, ReGit checks `main` in its own container and deploys it if the repository has an `.agents/deploy` script. If that check fails, ReGit finds the commit that broke it and gives that thread one chance to fix it. If the thread can't fix it, ReGit reverts that commit.

### Configure a repository

Repositories opt into ReGit's automation with files under `.agents/`. They're all optional, and this repository has examples of each:

| File                                 | What                                                                |
| ------------------------------------ | ------------------------------------------------------------------- |
| `mise.toml` (or other version files) | Toolchains installed in the sandbox                                 |
| `.agents/setup`                      | Installs dependencies; the result is cached per repository          |
| `.agents/resume`                     | Per-run configuration and readiness checks; not cached              |
| `.agents/checks.yml`                 | Commands and judged rules required before handoff and before deploy |
| `.agents/services.yml`               | Dev servers and other long-running services                         |
| `.agents/deploy`                     | Runs on `main` after its deploy checks pass                         |
| `.agents/skills/<name>/SKILL.md`     | Task-specific guidance agents load when they need it                |

### Owner settings

Owners have three more dialogs in the repository's header:

- **Members**: add people by their Access user ID, the `sub` of their Access identity. They can find it at `https://regit.dev/cdn-cgi/access/get-identity`. Viewers can read, editors can open and reply to threads, and owners can also ship and manage settings.
- **Deploys**: save secrets for `.agents/deploy` and choose the machine it runs on. Secrets are encrypted and only `main`'s sandbox can read them.
- **Clone**: create a read-only access token for this repository, then clone it with the token as the password:

  ```sh
  git clone https://git.regit.dev/<repo>.git
  ```

  Tokens expire, and they stop working as soon as you lose membership. Pushing is always refused: changes reach `main` only by shipping a thread.

## Run it locally

Requirements:

- [Bun](https://bun.com) 1.4+, or [mise](https://mise.jdx.dev), which installs the pinned Bun and Node versions from `mise.toml`.
- A Cloudflare account with the resources listed in [Deploy your own](#deploy-your-own). Local dev still uses remote bindings for Workers AI, the AI Gateway and Artifacts. Log in with `bunx wrangler login`.
- Docker, unless you run the sandbox as a local process (see [Sandboxes](#sandboxes)).

```sh
bun install
bun run dev
```

This starts forge on <http://localhost:8787> and web on <http://localhost:5173>. Both persist D1 and Durable Object state to `.wrangler/state`, and forge applies D1 migrations when it starts. In dev, web signs you in as a fixed "Developer" user, so Access isn't needed for the app itself.

Web's remote Artifacts binding proxies through its `workers.dev` domain, which is behind Access. If you aren't running `dev` interactively, set a service token:

```sh
export CLOUDFLARE_ACCESS_CLIENT_ID=...
export CLOUDFLARE_ACCESS_CLIENT_SECRET=...
```

### Sandboxes

By default forge runs each thread's sandbox as a local container. Docker must be running, and the first start builds `apps/sandbox/Dockerfile`, which takes a while. Locally, containers can't make HTTPS requests to the internet, so setup scripts that download things will fail there.

To skip Docker, run the sandbox server as a plain process and point forge at it:

```sh
bun run --filter @regit/sandbox dev                          # serves on :8080, workspaces in apps/sandbox/.workspace
echo 'SANDBOX_URL=http://127.0.0.1:8080' >> apps/forge/.dev.vars
```

This runs agents' commands directly on your machine with your user's permissions. It needs `git`, `ripgrep` and `mise` on your `PATH`, and it doesn't snapshot toolchains or setup.

### Checks and tests

```sh
bun run check   # type-check every workspace
bun run test    # every workspace's tests, sequentially
```

The regular tests don't need Cloudflare credentials or Docker: forge's tests use fake model and Artifacts Workers, a disposable D1 and a local sandbox process. `bun run --filter @regit/forge test:containers` exercises a real container and needs Docker plus the deployment's remote bindings. `bun run storybook` serves the component library on <http://localhost:6006>.

## Deploy your own

ReGit is built for Cloudflare's developer platform. You'll need a Workers Paid account with Containers, Durable Objects, Workflows, D1, Workers AI, AI Gateway and Artifacts. The names below match the checked-in config; if you change them, update `apps/forge/wrangler.jsonc` and `apps/web/wrangler.jsonc` and run `bun run gen`.

### 1. Domains

ReGit uses two zones:

- **An app zone** (`regit.dev`). Web is served on the apex as a custom domain, and forge on `git.<zone>` for Git clone/fetch. Add a proxied DNS record for `git` (for example `AAAA 100::`) so the route receives traffic.
- **A preview zone** (`regit.run`). Forge serves `*.<zone>` for service previews. Add a proxied wildcard record. Previews stay one level deep so the free Universal SSL certificate covers them.

Set `routes`, `GIT_HOST` and `PREVIEW_DOMAIN` in `apps/forge/wrangler.jsonc`, and `routes` and `GIT_HOST` in `apps/web/wrangler.jsonc`.

### 2. Data and Git storage

```sh
bunx wrangler d1 create regit
```

Put the new `database_id` in **both** `wrangler.jsonc` files. Forge's `deploy` script applies migrations from `packages/db/drizzle`.

Both Workers bind the Artifacts namespace `regit`. Make sure Artifacts is enabled on the account.

### 3. Models

Agents call models through an AI Gateway named `regit` (`AI_GATEWAY` in forge's config). The gateway holds the provider keys, so the Workers never see them:

1. Create an AI Gateway named `regit`.
2. Store an **OpenAI** key and an **Anthropic** key on it. The modes in `packages/agent/src/modes.ts` use both providers.

Duplicate and overlap detection between threads runs on Workers AI (`typesafe/jev`) through the same gateway and is billed to the account.

### 4. Sign-in

Web authenticates every request with a Cloudflare Access JWT:

1. Create a self-hosted Access application covering the web domain and web's `workers.dev` hostname. **Don't** cover `git.<zone>` or the preview zone, because forge does its own authentication there.
2. Set `ACCESS_TEAM_DOMAIN` (for example `yourteam.cloudflareaccess.com`) and `ACCESS_AUD` (the application's audience tag) in `apps/web/wrangler.jsonc`.
3. For local `dev` against web's remote bindings, add a service token to the application's policy (see [Run it locally](#run-it-locally)).

### 5. Secrets

Forge has one optional secret. Without it, owners can't save deploy secrets.

```sh
openssl rand -base64 32 | bunx wrangler secret put DEPLOY_SECRETS_KEY --name regit-forge
```

### 6. Deploy

Deploy forge first, since web binds to its Durable Objects, then web:

```sh
bun run --filter @regit/forge deploy   # applies D1 migrations, builds and pushes the sandbox image (needs Docker)
bun run --filter @regit/web deploy
```

Forge's deploy also registers the Workflows and the `cf.artifacts.repo.pushed` event trigger that starts `RepoPushed` on every push.

### 7. Let ReGit deploy itself (optional)

To develop ReGit inside ReGit, import this repository, then open the repository's **Deploys** dialog and add a `CLOUDFLARE_API_TOKEN` secret. The token needs permission to deploy Workers, Containers, D1 and routes on the account. After that, each green commit on `main` runs `.agents/deploy`. It deploys forge, then web, and rebuilds the sandbox image only when `apps/sandbox` has changed since the last deploy.

# 23 — Cloudflare platform verification and build sheet for a thread-native forge

Researcher key: `23-cloudflare-platform-verify`. Written 2026-10-12. Scope: check, against Cloudflare's own docs and blog, the platform facts that the brief (`00-brief.txt`) relies on, answer its five open questions, and produce a build sheet with exact API names and limits.

Method: about 75 primary pages were pulled as Markdown straight from `developers.cloudflare.com/<path>/index.md` (the docs serve Markdown), plus two blog posts, the competition page, the competition's official-rules PDF, one Cloudflare template's source on GitHub, and the npm registry. One WebSearch call was used. Tags: **[read]** means I opened the primary page and the claim is on it. **[secondary]** means coverage or a search snippet. **[inference]** means my own reasoning from read facts. Every Cloudflare doc page shows a "Last updated" date, which is listed in Sources.

---

## Summary

1. **Rules risk that the brief missed: only US and Canadian residents can enter.** Entrants must be "a legal resident of the United States or Canada" and 18 or older. The contest closes **October 14, 2026 at 11:59 PM PDT**. Finalists are announced October 16 and present for 10 minutes on stage at Cloudflare Connect (Moscone West, San Francisco) on **October 21, 2026**. The winner "must be physically present at Cloudflare Connect." The repo must contain a `LICENSE` file (MIT, Apache 2.0, or BSD 2- or 3-clause), and each entrant gets one submission. [read, official rules PDF]
2. **How entries are scored:** originality and quality of the prototype for agent-oriented collaboration (50%); "effectiveness of multi-agent concurrency, coordination, context preservation, review, and conflict handling" (25%); ease of use and UX (25%). Each is scored 1–5. [read, rules §6]
3. **There are two billing dates. Treat October 14 as the real one.** The Artifacts pricing page and changelog say "Cloudflare will begin billing ... on October 14, 2026." The October 1 blog post says October 15. The prices match the brief: on Workers Paid, the first 10,000 operations per month are included, then $0.15 per 1,000; the first 1 GB is included, then $0.50 per GB-month. Artifacts is not available on the Free plan. [read]
4. **The Artifacts binding has no git-notes method.** The binding is control-plane plus read-only: `create`, `get`, `list`, `import`, `delete`, and on a repo handle `info`, `createToken`, `listTokens`, `revokeToken`, `fork`, `log`, `readCommit`, `readTree`, `readBlob`, `readFile`. Nothing on it writes commits, refs, merges, or notes. Notes are supported "natively" by the git server, according to the April blog, and the docs say to write them with `git notes` and push `refs/notes/*`. You therefore need a git client: CLI git in a sandbox, or isomorphic-git in a Worker. [read]
5. **Artifacts tokens are repo-scoped, with only `read` and `write` scopes, and there is no branch protection.** A write token can push to any ref, including `main`. The only way to stop agents from writing to trunk is to give each agent its own **fork repo** and keep the project repo's write token inside the landing service. This matches Artifacts' own best practice ("Create one repo for each unit of autonomous work ... Do not use one shared repo as a queue for many autonomous agents"). [read + inference]
6. **Workers Builds connects one Artifacts repo to one Worker, and `main` must be the production branch.** Previews from Builds therefore come only from branches of that single repo. However, `npx wrangler preview --name <x> --worker-name <app> --json` can be run from **any** checkout, including a fork inside a sandbox, and creates a Preview on the same Worker without going through Builds. That answers the "one Worker + many forks" question. [read + inference]
7. **Workers Builds allows only 6 concurrent builds per account on Paid**, with a 20-minute timeout, 4 vCPU, 8 GB RAM, and 6,000 build minutes per month before $0.005 per minute. For many threads at once, this is a tighter limit than the 500-preview cap the brief flags. [read]
8. **Previews:** up to 500 per Worker and 100 deployments per Preview on Paid; when the limit is hit, the least recently deployed Preview or the oldest deployment is deleted. Each Preview gets a moving Preview URL and an immutable Deployment URL. Durable Object namespaces and containers are isolated per Preview automatically, but "Container support in Previews is partial." Workflows, Queue consumers, cron, routes, and service bindings all still reach production. Wrangler must be 4.135.0 or later (4.145.0 or later for Artifacts binding types). [read]
9. **There is an API for build status, and it partly covers URLs.** The Workers Builds REST API (user-scoped token) lists, triggers, cancels, and reads logs for builds. Build events (`cf.workersBuilds.worker.build.started/succeeded/failed/canceled`) go to Queues but carry no URL. Cloudflare's own notifications template reads `result.preview_url` from `GET /accounts/{id}/builds/builds/{build_uuid}`. `wrangler preview --json` returns `.preview.urls[0]`. The JSON field for the pinned Deployment URL is not documented on any page I read. [read; field coverage unclear]
10. **Sandboxes have been rebuilt as SDK 1.0, released 2026-09-30.** Your own Durable Object calls `this.ctx.container.start/exec/snapshotContainer/setInactivityTimeout/interceptOutboundHttps`. The `durable_object` scheduling policy and container snapshots are both **public beta**. The inactivity timeout can be set up to **6 hours**. Snapshots are up to 20 GB, expire 30 days after creation or last restore, and cannot be deleted through the API. Account-wide concurrency is 1,500 vCPU, 6 TiB memory, and 30 TB disk. The largest instance is 4 vCPU, 12 GiB, 20 GB disk. [read]
11. **Credentials can stay out of the sandbox.** `interceptOutboundHttps(host, entrypoint)` sends container HTTPS (re-signed by a Cloudflare CA) to a Worker entrypoint that adds the token. Cloudflare's own private-repo guide uses this to allow clone but block push. The Artifacts docs' own "Sandbox SDK + Artifacts" example does the opposite: it puts the token in an environment variable inside the sandbox using 0.x APIs. [read]
12. **Claude Code is documented on Sandboxes.** The guide pins `@anthropic-ai/claude-code@2.1.280`, runs `claude --print --output-format stream-json --verbose --dangerously-skip-permissions`, points `ANTHROPIC_BASE_URL` at AI Gateway, and has the Worker strip `x-api-key` and add `cf-aig-authorization`. Guides also exist for Codex, OpenCode, Pi, Devin, Cursor, Claude Managed Agents, and the OpenAI Agents API. [read]
13. **Browser Run behind Access: no page confirms it, but the pieces exist.** Quick Actions accept `setExtraHTTPHeaders` and `cookies`. Access accepts service-token headers `CF-Access-Client-Id` and `CF-Access-Client-Secret` when the app has a **Service Auth** policy, and Worker-level Access apps (`preview_worker` destination) can be edited in Zero Trust to add service tokens. Paid limits: 200 concurrent browsers, 3 new browsers per second, 30 Quick-Action requests per second. Session recording (rrweb JSON, **beta**) gives replayable proof. [read + inference]
14. **Artifacts has a ready-made path from push to CI.** The Wrangler trigger `triggers.events: [{type: "cf.artifacts.repo.pushed", filter: {namespace}, target: {workflowName}}]` starts a Workflow on every push in a namespace. It works with the `@cloudflare/ci` SDK (npm 0.2.0), whose `runner()` calls run commands in sandboxes and share a cached snapshot. This is the obvious place to put "landing as a platform service." [read]
15. **Artifacts' internal design limits trunk throughput.** Each repo is one Durable Object holding SQLite, running a Zig→Wasm git server of about 100 KB, with roughly 128 MB of memory. Limits: 2,000 git requests per 10 s per repo, 1 GB per repo, 32 MB per blob. A single trunk repo is therefore single-threaded, which is the same "single hot ref" problem GitHub describes, now at the level of a whole repo. [read + inference]

---

## Detailed findings

### A. Competition announcement and official rules

- The blog post "We want you to build the next Git platform on Cloudflare" (Dina Kozlov and Zebulon Piasecki, published 2026-10-01T13:00Z) asks: "How do agents know what other agents are working on? What happens when they make conflicting changes? How do you review everything they produce? How do you keep track of not just what changed, but *why* a change was made?" It also says: "We aren't looking for GitHub as it exists today with agents added on top. At a minimum, we want to see multiple agents working on changes concurrently." https://blog.cloudflare.com/next-git-platform-on-cloudflare/ [read]
- The blog's code example: `using project = await env.ARTIFACTS.get("my-project"); const { defaultBranch } = await project.info(); const workspace = await project.fork(\`task-${crypto.randomUUID()}\`);` followed by `readFile({ref: defaultBranch, path: "AGENTS.md"})`. This is a fork-per-task pattern. [read]
- The blog's queue consumer starts `env.REVIEW_WORKFLOW.create({params: {namespace, repo, ref, commit: event.payload.after}})` on each `cf.artifacts.repo.pushed` event. [read]
- The blog says "We will begin billing for Artifacts usage on October 15, 2026." [read; conflicts with docs, see Contradictions]
- The competition page (https://www.cloudflare.com/git-competition/) says "Build a new way for hundreds of thousands of agents to work on changes concurrently" and "Selected teams are announced October 16." It links the rules PDF and a submit form at `/git-competition/submit`. [read]
- Official rules (https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf) [read]:
  - §2: the contest runs from 2026-10-01 9:00 AM EDT to **2026-10-14 11:59 PM PDT**.
  - §3: open only to legal residents of the **US or Canada**, aged 18 or over. Cloudflare employees and government employees are excluded.
  - §4: the entry needs a 5–10 minute video, the source repo, and run instructions. "Entrants must use Cloudflare's developer platform, including Cloudflare Workers and Artifacts ... which must enable multiple agents working on changes concurrently." The repo "must include a LICENSE file." One submission per entrant. No "personal attacks on anyone or any discernible product, including competitor products." That matters for any video segment that criticises GitHub. [read + inference]
  - §6: scoring is 50% originality and quality, 25% concurrency, coordination, context, review, and conflicts, and 25% UX, each scored 1–5. Ties go to the originality score. Each finalist gets 10 minutes live on 2026-10-21. Cloudflare covers travel for up to 2 people per team.
  - §7: the winner must be physically present at Connect.
  - §8: the prize is $25,000 in credits, valid 12 months, plus the VIP dinner.
  - §9: entrants keep their IP. Submissions are not confidential, and Cloudflare "may develop products ... similar to or compete with Projects."

### B. Artifacts: surfaces, binding, protocol, tokens

**Three surfaces** [read: concepts/repositories, how-artifacts-works]:
- The Workers binding and REST API are the control plane. Git smart HTTP is the data plane.
- "Like Durable Objects, a repo is a single logical instance that Cloudflare can route to from any region."
- Durability: data is "replicate[d] ... synchronously across multiple data centers and copie[d] ... asynchronously to object storage and snapshots."

**Binding configuration** [read: api/workers-binding, last updated 2026-10-01]:
- `"artifacts": [{"binding": "ARTIFACTS", "namespace": "default"}]`, with optional `remote = true` for local development.
- Wrangler **4.145.0+** is needed for the generated types and for Blob-returning methods on a remote binding.
- Namespace methods:
  - `create(name, {readOnly?, description?, setDefaultBranch?})` returns `{name, remote, defaultBranch, token}`.
  - `get(name)` returns a **disposable** `ArtifactsRepo` RPC capability. Use it with `using`. It throws if the repo is not ready.
  - `list({limit?, cursor?})` returns repos with `status` of `ready | importing | forking`.
  - `import({source: {url, branch?, depth?}, target: {name, opts}})`.
  - `delete(name)` returns a boolean.
- Repo methods:
  - `info()` does a fresh metadata lookup. Metadata is not exposed as properties.
  - `createToken(scope = "write", ttl?)` returns `{plaintext, expiresAt}`. `listTokens()` and `revokeToken(tokenOrId)` also exist.
  - `fork(name, {description?, readOnly?, defaultBranchOnly?})`.
  - `log({ref = "HEAD", limit ≤ 1000 (default 50), offset})` follows the first-parent chain, newest first, and returns `[]` if the ref does not resolve.
  - `readCommit(hash)`, `readTree(hash)` (immediate children only), `readBlob(hash)` (untyped Blob), and `readFile({ref, path})` (MIME-typed Blob).
- **There is no method to write commits, update refs, compare or merge, diff, or read or write notes.** [read: absence on the full method list]

**REST API** [read: api/rest-api, last updated 2026-08-13]:
- Base: `https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/artifacts/namespaces/$NS`. The token needs Artifacts Read or Artifacts Edit.
- Namespace routes: `POST /artifacts/namespaces` (`{namespace, jurisdiction?: "eu"|"us"}`; jurisdiction cannot be changed later), `GET /namespaces`, `GET /namespaces/:ns`.
- Repo routes: `POST /repos`, `GET /repos?limit≤200&cursor&search&sort=created_at|updated_at|last_push_at|name&direction`, `GET /repos/:name`, `DELETE /repos/:name` (202), `POST /repos/:name/fork` (`default_branch_only`), and `POST /repos/:name/import` (public HTTPS only; can return 409 while importing).
- Content routes: `GET /log`, `/commit/:hash`, `/tree/:hash`, `/blob/:hash`, `/file?ref&path`, `/raw/:ref/:path`.
- Token routes: `GET /repos/:name/tokens?state=active|expired|revoked|all`, `POST /tokens` (`{repo, scope, ttl}`, with **TTL from 60 s to 31,536,000 s, default 86,400 s**), `DELETE /tokens/:id`.

**Git protocol** [read: api/git-protocol]:
- Remote: `https://<ACCOUNT_ID>.artifacts.cloudflare.net/git/<namespace>/<repo>.git`.
- Token format: `art_v1_<40 hex>?expires=<unix_seconds>`.
- Auth: `-c http.extraHeader="Authorization: Bearer $TOKEN"` (recommended), or Basic auth with the secret part in the password slot and any username.
- Clone and fetch: `git-upload-pack` **v1 and v2**; v2 supports `ls-refs`, `fetch`, shallow, and deepen.
- Push: **receive-pack v1 only. v2 push is "Not supported."** Some optional v1 capabilities, such as `filter` and `include-tag`, are not supported.
- Whether the `atomic` push capability or `push-options` are advertised is not documented. [unclear]

**Errors** [read]: `ALREADY_EXISTS 10201`, `NOT_FOUND 10200`, `IMPORT_IN_PROGRESS 10302`, `FORK_IN_PROGRESS 10303`, `INVALID_INPUT 10100`, `INVALID_REPO_NAME 10101`, `INVALID_TTL 10103`, `INVALID_URL 10104`, `REMOTE_AUTH_REQUIRED 10106`, `UPSTREAM_UNAVAILABLE 10401`, `MEMORY_LIMIT 10402`, `INTERNAL_ERROR 10400`. A `MEMORY_LIMIT` error is what you would expect from a roughly 128 MB Durable Object. [inference]

**Limits** [read: platform/limits, last updated 2026-10-01]:

| Limit | Value |
| --- | --- |
| Control-plane request rate | 2,000 req per 10 s per namespace |
| Git request rate | 2,000 req per 10 s per artifact (repo) |
| Storage per repo | 1 GB |
| Single file or blob | 32 MB |
| Storage per account | 1 TB (can be raised) |
| Repos and namespaces | unlimited |
| Namespace name length | 2–63 characters |

**Pricing** [read: platform/pricing]:
- "Cloudflare will begin billing for Artifacts operations and storage on October 14, 2026."
- Operations, such as `create`, `push`, `pull`, `clone`: first 10,000 per month included, then $0.15 per 1,000.
- Storage: first 1 GB included, then $0.50 per GB-month. A GB-month averages the daily peak over 30 days, the same method as Durable Object SQL storage. Replicas are not charged.
- Not available on Workers Free.

**Git notes** [read]:
- The best-practices page, "Use git notes for prompts and model output," shows `git notes add -m 'user: …' HEAD`, `git notes append …`, and `git notes show HEAD`. It says: "notes live on separate refs. Push and fetch `refs/notes/*`."
- The April blog: "we have native support for git-notes ... prompts, agent attribution and other metadata that can be read/written from the repo without mutating the objects themselves." The git server was built to be "extensible (notes, LFS)." LFS support is not stated anywhere else in the docs I read.
- **Verdict:** notes work over the git protocol. The binding does not expose them. [read + inference]

**ArtifactFS** [read: guides/artifact-fs and the April blog]:
- Install with `go install github.com/cloudflare/artifact-fs/cmd/artifact-fs@latest`, then run `artifact-fs add-repo --name --remote --branch --mount-root` and `artifact-fs daemon --root`.
- It does a blobless clone and mounts a FUSE working tree. Files hydrate asynchronously, with manifests and source first and binaries later. A read blocks only if that blob has not arrived yet.
- It does not sync back. You commit and push as normal.
- The blog gives this example: a 2.4 GB framework repo takes "close to 2 minutes" to clone fully, with a target of about 10–15 s.
- It **requires FUSE on the host**. Whether Containers allow FUSE was not verified. The Sandbox page "Mount an R2 bucket" implies some FUSE-like mounting exists, but I did not open it. [unclear]

**Events** [read: guides/event-subscriptions, last updated 2026-05-21]:
- Account-level source `artifacts`: `cf.artifacts.repo.created`, `.deleted`, `.forked`, `.imported`.
- Repo-level source `artifacts.repo`, which takes `namespace` and `repo_name`: `cf.artifacts.repo.pushed` (payload `ref`, `before`, `after`, and `commits[]` with id, message, author, committer, and parents, plus `totalCommitsCount` and `commitsTruncated`), `.cloned`, `.fetched` (empty payload), `.token.created` (tokenId, scope, expiresAt), and `.token.revoked`.
- Events are consumed through Queues event subscriptions.

**Build on push without Workers Builds** [read: guides/build-and-deploy-on-push, last updated 2026-10-01]:
- Wrangler `triggers.events` takes `{type: "cf.artifacts.repo.pushed", filter: {namespace, repoName?}, target: {scriptName, workflowName, dispatch_namespace?}}`.
- If `repoName` is omitted, the same Workflow runs for **every push to any repo in the namespace**. That covers every thread fork without per-repo subscriptions.
- The `@cloudflare/ci` SDK provides `CIWorkflow.pipeline(event, step, ci)` and `ci.runner({name, command, cache: {inputs}, cloudflareCredentials})`. Each runner "spins up an isolated sandbox." A cached runner snapshots its sandbox, and later runners branch from it. A failed runner retries according to the step config, and once retries run out the Workflow ends in `Errored`.
- Sample configuration: containers `max_instances: 10`, `instance_type: "standard-4"`, plus an R2 bucket for the cache snapshot.
- npm shows `@cloudflare/ci` at **0.2.0**, published 2026-09-14. [read: npm registry]

**Data localization and metrics** [read]:
- The jurisdiction is set per namespace, `eu` or `us`, and is immutable.
- Metrics come from the GraphQL dataset `artifactsEventsAdaptiveGroups`, with count and duration quantiles from p25 to p999, kept for 31 days.
- `eventType` values: `create, fork, push, pull, delete, storageLimitReached, serverError, clientError, rateLimited`.

**Internals** [read: April blog "Artifacts: versioned storage that speaks Git"]:
- Built on Durable Objects: "Files are stored in the underlying Durable Object's SQLite database."
- Objects larger than 2 MB are chunked across rows.
- "DOs have ~128MB memory limits."
- A Worker front end handles authentication. R2 holds snapshots and KV tracks auth tokens.
- The git engine is written in Zig with no libc, about 100 KB of Wasm, and has 11 host imports.
- The blog listed upcoming items: "Native TypeScript, Go and Python client SDKs," "Repo-level search APIs and namespace-wide search," and "an API for Workers Builds." I saw no sign in the docs that the SDKs or search have shipped. [read + absence]

### C. Workers Builds and Workers Previews

**Artifacts integration** [read: workers/ci-cd/builds/git-integration/artifacts-integration, last updated 2026-10-01]:
- Connect a Worker through Dashboard › Workers & Pages › Create application › **Continue with Artifacts** › namespace › repo.
- "The Artifacts integration only supports `main` as the production branch."
- Preview builds must be enabled under **Settings › Builds › Previews Base › Builds for Preview branches**. The Preview command defaults to `npx wrangler preview`.
- "To change the repository or source provider, disconnect Workers Builds and create another connection." This means one repo per Worker connection. [read]

**Builds limits** [read: limits-and-pricing]:

| Metric | Paid |
| --- | --- |
| Build minutes | 6,000 per month, then $0.005 per minute |
| **Concurrent builds** | **6 per account** |
| Timeout | 20 min |
| CPU / memory / disk | 4 vCPU / 8 GB / 20 GB |
| Deploy Hooks | 10/min per Worker, 100/min per account |

**Builds API** [read: api-reference, last updated 2026-09-22]:
- Requires a **user-scoped** token. Account-scoped tokens return "Invalid token." Permissions: Workers Builds Configuration Edit, plus Workers Scripts Read.
- Workers are identified by their tag (`external_script_id`).
- Each Worker has at most two triggers: production and preview.
- Endpoints:
  - `GET /accounts/{id}/builds/workers/{tag}/triggers`
  - `POST /builds/triggers/{uuid}/builds` with `{branch?, commit_hash?}`, which returns `build_uuid`
  - `GET /builds/workers/{tag}/builds` (returns `build_uuid, status, branch, created_at`)
  - `GET /builds/builds/{uuid}/logs`
  - `PUT /builds/builds/{uuid}/cancel`
  - `PATCH /builds/triggers/{uuid}` (fields include `branch_includes/excludes` and `path_includes/excludes`)
  - `POST /builds/triggers/{uuid}/purge_build_cache`
  - `GET /builds/builds?version_ids=`
- Repo connections are created with `PUT /builds/repos/connections`, but the documented `provider_type` is `github`. An API path for an **Artifacts** connection is not documented. [unclear]

**Build events** [read: builds/event-subscriptions]:
- `cf.workersBuilds.worker.build.started | .succeeded | .failed | .canceled`.
- Payload: `buildUuid`, `status`, `buildOutcome`, timestamps, and `buildTriggerMetadata` with branch, commitHash, commitMessage, author, and repoName.
- **No preview URL in the payload.**
- The official notifications template fetches `GET /accounts/{id}/builds/builds/{buildUuid}` and reads `result.preview_url` (`src/api.ts`, https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template). [read]
- Whether `preview_url` is the moving Preview URL or the pinned Deployment URL is not documented. [unclear]

**Previews** [read: workers/previews, last updated 2026-09-24; resources 2026-09-22; examples 2026-10-01; test-and-debug 2026-10-10; custom-domains 2026-09-24]:
- URLs:
  - `workers.dev` Preview URL: `<preview-name>-<worker-name>.<subdomain>.workers.dev`. Deployment URL: `<deployment-id>-<worker-name>.<subdomain>.workers.dev`.
  - Custom domain Preview URL: `<preview-name>.app.example.com`. Deployment URL: `<deployment-id>-<preview-name>.app.example.com`.
  - Cloudflare creates a wildcard DNS record and certificate. A deeper hostname may need Advanced Certificate Manager or Total TLS.
  - `workers.dev` Preview URLs send `X-Robots-Tag: noindex`.
- Limits: 500 Previews per Worker on Paid (100 on Free) and 100 deployments per Preview. Automatic eviction removes the least recently deployed Preview, or the oldest deployment.
- Isolation is automatic for Durable Objects (with `ctx.exports`, or an `env` binding declared again under `previews`) and Containers (`previews.containers`; "Container support in Previews is partial"). Leftover container apps after deleting a Preview must be cleaned up with `wrangler containers delete`.
- KV, D1, R2, Queues producers, Vectorize, and similar resources are shared unless the Preview is bound to a different resource. D1 has a documented migrations pattern for previews.
- Not isolated: Workflows (a Preview binds to the existing Workflow; "Cloudflare is working on automatic per-Preview Workflow provisioning"), Queue consumers (a Preview cannot consume), cron, routes, and service bindings (they go to the bound Worker's production deployment).
- CLI: `wrangler preview [--name] [--tag] [--message] [--json] [--ignore-base-config] [--worker-name] [--env]`, `wrangler preview delete --name --skip-confirmation`, `wrangler preview secret put|delete|list --name`, and `wrangler preview base-config secret put|delete`. Base config secrets apply only to new Previews.
- In JSON output the Preview URL is at `.preview.urls[0]`, per the GitHub Actions example. "A successful deployment returns a Preview URL ... It also returns a Unique Deployment URL for each deployment."
- Observability: a `previews.observability` block, `previews.tail_consumers`, and GraphQL `workersInvocationsAdaptive` with `isPreview: 1` and `previewSlug`. `wrangler tail` does **not** support Previews.
- Version URLs (`wrangler versions upload`) "use production resources" and are not recommended for branch testing.

**Access in front of Workers** [read: workers/configuration/cloudflare-access, last updated 2026-08-18]:
- Destination types: `all_preview_workers`, `all_workers`, `preview_worker` (with `worker_id`), `worker`, or a hostname-based self-hosted app, created through `POST /accounts/{id}/access/apps`.
- The built-in policy options are "Cloudflare account" or "Email domain." Advanced options, including **service tokens**, are configured by editing the app in Zero Trust.
- **"Worker-level Access policies do not currently support WebSocket connections"**, which fail with 403. Use hostname-based Access for Workers that use WebSockets.
- `ctx.access.getIdentity()` gives the signed-in identity. It is not propagated over service bindings or RPC.

### D. Sandboxes (SDK 1.0) and Containers

**Model** [read: sandbox index, concepts, lifetime, changes-in-1-0, all last updated 2026-09-30]:
- "A Linux sandbox has three parts: a name, a Durable Object, and an instance in Containers."
- In 1.0, "you write the Durable Object class, and it calls the container directly through `this.ctx.container`."
- The package keeps only helpers, such as `Files`, which needs a `sandbox-shim` binary copied into the image. "The package also retries nothing and sets no time limits."
- npm `@cloudflare/sandbox` 1.0.0 was published 2026-09-30, **12 days before this report**. [read: npm]
- A container is a Firecracker microVM with its own kernel and network. It has no Internet access unless `enableInternet: true`.
- The `durable_object` scheduling policy is **public beta**. It is configured as `containers: [{class_name, scheduling_policy: "durable_object", images: {base: {dockerfile}}}]`, and the image is chosen at runtime through `ctx.container.images.<name>`. The policy cannot be changed later.

**API** [read: containers/api/durable-object-container]:
- `start({image | containerSnapshot, entrypoint, enableInternet, env, instance, labels})` throws if the container is already running.
- Also: `running`, `inspect()`, `exec(cmd[], {cwd, env, user, stdin, stdout, stderr, pty, signal})` returning `ExecProcess`, `output()` (buffers in Durable Object memory), `snapshotContainer({name?})` (durable_object policy only), `destroy()`, `signal()`, `setInactivityTimeout(ms ≤ 21,600,000)`, `getTcpPort(port).fetch()`, `monitor()`, `interceptOutboundHttp(addr, binding)`, `interceptAllOutboundHttp(binding)`, and `interceptOutboundHttps(host, binding)`. There is a cap on how many intercept entries a container can hold.

**Lifetime facts** [read]:
- An instance stays up while the Durable Object is active: handling a request, running an alarm, or holding an open WebSocket. After that it stays up for the inactivity timeout, at most 6 h.
- "Code that runs inside the instance does not count as activity." A long agent run therefore needs an alarm, for example every minute, to keep the instance alive.
- The timeout is lost when the Durable Object restarts, so set it again in the constructor.
- A deploy restarts every Durable Object but keeps running instances, and new images apply only to new starts.
- When the timeout ends, the instance gets SIGTERM and then stops. `destroy()` stops it immediately.
- Snapshots (**public beta**): `snapshotContainer()` saves the writable root filesystem only, without mounts, memory, or processes. A snapshot expires 30 days after creation or last restore. "The Durable Object container API has no method to delete a snapshot." The auto-save guide uses an alarm with a 1-minute check, a 10-minute idle limit, a 15-minute checkpoint interval, and a 5-minute inactivity timeout.

**Limits and pricing** [read: containers/platform/limits 2026-09-30; pricing 2026-10-05]:

| Instance | vCPU | Memory | Disk |
| --- | --- | --- | --- |
| lite | 1/16 | 256 MiB | 2 GB |
| basic | 1/4 | 1 GiB | 4 GB |
| standard-1 | 1/2 | 4 GiB | 8 GB |
| standard-2 | 1 | 6 GiB | 12 GB |
| standard-3 | 2 | 8 GiB | 16 GB |
| standard-4 | 4 | 12 GiB | 20 GB |

- Custom instance types: 1–4 vCPU, at most 12 GiB memory, at most 20 GB disk, and at least 3 GiB per vCPU.
- Account limits: **1,500 concurrent vCPU, 6 TiB concurrent memory, 30 TB concurrent disk**, 50 GB of image storage, and an image no larger than the instance's disk. Snapshots: at most 20 GB, kept for 30 days.
- Pricing on Workers Paid:
  - Memory: 25 GiB-hours per month included, then $0.0000025 per GiB-second.
  - CPU: 375 vCPU-minutes included, then $0.000020 per vCPU-second (active use only).
  - Disk: 200 GB-hours included, then $0.00000007 per GB-second.
  - Egress in North America and Europe: $0.025 per GB, with 1 TB included.
  - Memory and disk are billed on provisioned size. Durable Object and Workers charges are added on top.
- [inference] Rough concurrent capacity per instance type: standard-1 is limited by memory to about 1,500 concurrent; basic to about 6,000; standard-4 by vCPU to 375.
- A per-application `max_instances` cap for the `durable_object` policy is **not documented** on the pages I read. The default-policy examples use `max_instances: 10`. [unclear]

**Credential injection** [read: network/call-an-authenticated-api, network/clone-a-private-repository]:
- The Durable Object calls `await container.interceptOutboundHttps("github.com", this.ctx.exports.GitGateway)`.
- The `WorkerEntrypoint` allows only `GET …/info/refs?service=git-upload-pack` and `POST …/git-upload-pack`, then sets `Authorization: Basic …`.
- Inside the container, set `GIT_SSL_CAINFO=/etc/cloudflare/certs/cloudflare-containers-ca.crt` or `NODE_EXTRA_CA_CERTS=…`.
- Result: "A `git push` from the sandbox fails with `403`." The same pattern can be pointed at `*.artifacts.cloudflare.net` and switched per thread to allow push to that thread's fork only. [inference]

**Coding agents** [read: sandbox/coding-agents, claude-code, build-a-coding-agent-runner]:
- The runner's `AgentSandbox` Durable Object clones a GitHub repo, runs one task at a time (`blockConcurrencyWhile`), and returns `diff`.
- All container HTTP(S) on ports 80 and 443 goes through an `Outbound` entrypoint that allows only AI Gateway and github.com.
- The agent writes its output to files, because a piped process "receives `SIGPIPE` after the request that started it ends."
- Claude Code settings:
  - Image `node:24-trixie-slim`, `npm install --global @anthropic-ai/claude-code@2.1.280`, and `COPY --from=docker.io/cloudflare/sandbox:1.0.0 /usr/local/bin/sandbox-shim`.
  - Environment: `ANTHROPIC_BASE_URL=https://gateway.ai.cloudflare.com/v1/{acct}/{gw}/anthropic`, `ANTHROPIC_API_KEY=provided-by-worker`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, and `IS_SANDBOX=1` (required to skip permissions as root).
  - Claude Code exits 0 even when the model call fails, so read `is_error` from the final `result` event. A bad gateway token takes about 3 minutes to fail.
- Other guides: Codex, OpenCode, Pi, Devin (Outpost), Cursor Cloud Agents, Claude Managed Agents, and OpenAI Agents API.

**Agents SDK** [read: agents index 2026-09-18; agents/tools/sandbox 2026-09-30]:
- "Attaching a container to the Durable Object of an agent gives the agent a sandbox through `this.ctx.container`."
- Example: a `Think` agent with a `run_command` tool. The runtime provides state, sessions, routing, WebSockets, scheduling, and "fibers" for durable execution.
- npm `agents` is at 0.28.0 (2026-10-09).
- **This confirms the brief's "thread Durable Object owns its container."** [read]

### E. Browser Run (formerly Browser Rendering)

[read: browser-run/limits 2026-09-26, pricing 2026-04-21, FAQ, screenshot endpoint, playwright 2026-09-28, session-recording 2026-09-26, automatic-request-headers 2026-06-16]

- Paid limits:
  - 200 concurrent browsers per account (Browser Sessions), and 3 new browsers per second.
  - 30 Quick-Action requests per second.
  - Browser timeout of 60 s idle by default, up to 10 min with `keep_alive`.
  - No maximum session length while the session is active, but sessions close when Browser Run releases a new version.
- Pricing on Paid: 10 browser-hours per month included, then $0.09 per hour. Concurrent browsers: 10 included (monthly average of the daily peak), then $2.00 per browser. Failed `waitForTimeout` requests are not billed.
- Playwright: use the `@cloudflare/playwright` fork (npm 1.3.6) with `launch(env.MYBROWSER)`. It needs `nodejs_compat` and a compatibility date of 2025-09-15 or later. It supports traces (`tracing.start/stop` producing `trace.zip`) and `expect` assertions, and concurrent connections need v1.3.0 or later. A CDP endpoint at `wss://api.cloudflare.com/client/v4/accounts/<id>/browser-run/devtools/browser` works for remote clients.
- Session recording (**Beta**): `launch(env.MYBROWSER, {recording: true})` or `?recording=true` on CDP. It captures DOM changes and input as rrweb JSON. The recording can be fetched by session ID after the session closes, and is shown in Dashboard › Browser Run › Runs.
- Authenticated pages with Quick Actions: `authenticate: {username, password}`, `cookies: [...]`, or `setExtraHTTPHeaders: {...}`.
- Browser Run always sends non-overridable headers `cf-brapi-request-id` or `cf-brapi-devtools`, plus `cf-biso-devtools` and Web Bot Auth signatures. It is always classed as a bot; Cloudflare does not enforce bot protection by default. Allowlisting with a WAF skip rule needs Enterprise.
- The Previews test-and-debug page recommends "Browser evidence" through a Browser Run screenshot of the Preview URL with a `debugId` query parameter, so the browser traffic can be matched to Preview logs.

### F. Durable Objects, Workflows, Queues, D1, R2

- **Durable Objects (SQLite)** [read: limits 2026-06-01; alarms]:
  - 10 GB per object, unlimited objects, 500 classes per account.
  - Key plus value at most 2 MB; row at most 2 MB; SQL statement at most 100 KB; 100 bound parameters.
  - CPU 30 s per invocation by default, configurable to 5 min.
  - Each object is "inherently single-threaded"; overload returns an error.
  - Alarm handlers have 15 min of wall time.
  - Alarms: one per object, "guaranteed at-least-once," retried with exponential backoff from 2 s up to 6 retries.
- **Workflows** [read: limits 2026-09-21]:
  - 50,000 concurrent running instances per account on Paid. Waiting instances do not count.
  - Creation rate: 300 per second per account, 100 per second per Workflow.
  - 2,000,000 queued instances.
  - Steps: 10,000 by default, up to 25,000. Step results at most 1 MiB. Event payload at most 1 MiB. Instance state at most 1 GB.
  - `step.sleep` up to 365 days. CPU per step 30 s to 5 min, with unlimited wall time per step.
  - Completed state kept 30 days. 10,000 subrequests by default, up to 10 million.
  - Previews cannot get their own Workflow.
- **Queues** [read: limits 2026-04-21]:
  - 10,000 queues per account, 128 KB messages, 100 messages per batch, 5,000 messages per second per queue.
  - Retention up to 14 days, 25 GB backlog, 250 concurrent push consumers, 15 min consumer wall time, delay up to 24 h.
  - A queue has only one consumer Worker.
- **D1** [read: limits 2026-04-21]:
  - 10 GB per database ("cannot be further increased"), 50,000 databases per account on Paid, 1 TB per account.
  - Single-threaded per database: a 1 ms query gives about 1,000 QPS.
  - 30 s maximum query time, 6 connections per invocation, 30-day Time Travel.
  - Confirms the brief's D1 section.
- **R2** [read: limits 2026-06-08]:
  - Objects up to 5 TiB, single-part uploads up to 5 GiB.
  - **1 write per second to the same key.** Evidence keys should be content-addressed or unique.
  - The REST API allows 1,200 requests per 5 min. Use S3 or the Workers API for data.

### G. AI Gateway and Flagship

- **AI Gateway** [read: overview 2026-04-20; Claude Code guide]: analytics, logging, caching, rate limiting, retries, and fallback. Coding agents call `https://gateway.ai.cloudflare.com/v1/{acct}/{gateway}/{provider}`, and the Worker adds `cf-aig-authorization: Bearer …`. Provider keys can be stored in the gateway (BYOK) or paid through "Unified Billing" credits. Per-thread cost attribution through gateway metadata was not verified. [unclear]
- **Flagship** [read: overview 2026-06-30, get-started 2026-08-26, binding methods, limits, api-tokens]:
  - Binding: `"flagship": [{"binding": "FLAGS", "app_id": "<APP_ID>"}]`.
  - Methods: `get`, `getBooleanValue`, `getStringValue`, `getNumberValue`, `getObjectValue`, and the `*Details` versions, each taking `(flagKey, defaultValue, context)`.
  - "Flag changes propagate globally within seconds."
  - Limits: 10,000 apps, 5,000 flags per app, 10 KB per variant, 25 MB of configuration per app, nesting depth 5.
  - Token permissions: Flagship Read, Write, Evaluate. CLI: `wrangler flagship` commands.
  - OpenFeature SDK: `@cloudflare/flagship` 0.6.0.
  - The pages I read have no beta label. Pricing was not checked. [unclear]

---

## Answers to the brief's open questions

1. **Does the Artifacts binding expose git notes?** **No.** [read] Write notes with a git client. Two options:
   - (a) `git notes --ref=refs/notes/threads add -m 'thread: <id> …' <sha> && git push origin 'refs/notes/*'` in the landing sandbox. The docs show this pattern and the blog says the server supports notes "natively."
   - (b) isomorphic-git in a Worker. isomorphic-git has `addNote` and `readNote`. [inference from library knowledge; not verified against Artifacts]
   - The binding cannot read notes back either. `readFile` and `readBlob` take a ref and path or a blob hash, so in theory you could read `refs/notes/threads` as a ref with the commit SHA as the path, since notes trees are keyed by SHA, possibly fanned out. [inference, untested]

2. **One Worker connected to builds from many forks?** **Through Workers Builds, no.** One Artifacts repo per Worker connection, `main` only as production, and changing the repo means disconnecting. [read] **Through Wrangler, yes.** `npx wrangler preview --name t-<threadId> --worker-name <app> --json` can run from any fork checkout and creates a Preview on the shared Worker, counting toward the 500-preview cap. [read: command reference + inference] Two places to run it:
   - (i) In the thread's own sandbox. The Cloudflare API token would be injected by intercepting `api.cloudflare.com` [inference; Wrangler with a custom CA is untested].
   - (ii) In a namespace-wide `cf.artifacts.repo.pushed` → Workflow → `@cloudflare/ci` runner. [read]
   - Either path also avoids the **6-concurrent-build** cap. Instead it uses container capacity and Workflow concurrency (50,000).

3. **Is there an API for build status and the pinned deployment URL?**
   - Build status: **yes.** The Builds REST API and build events through Queues. [read]
   - Preview URL: **partly.** `GET /builds/builds/{uuid}` returns `preview_url` (seen in Cloudflare's template code), and `wrangler preview --json` returns `.preview.urls[]`. [read]
   - Pinned Deployment URL: **not documented as an API field** on the pages I read. It follows the pattern `<deployment-id>-<worker>.<subdomain>.workers.dev`, so if `--json` includes the deployment ID, the URL can be built from it. Running `wrangler preview --json` once by hand is the fastest way to settle this. [unclear]

4. **Sandbox limits on the current plan:**
   - Account-wide: 1,500 vCPU, 6 TiB memory, 30 TB disk.
   - Per instance: at most 4 vCPU, 12 GiB, 20 GB disk.
   - Idle timeout up to 6 h through `setInactivityTimeout`. Without it, the instance stops "shortly after" the Durable Object goes inactive.
   - Snapshots at most 20 GB, kept 30 days.
   - Image storage 50 GB.
   - Both the scheduling policy and snapshots are beta.
   - The per-app instance cap under the `durable_object` policy is not documented. [read; cap unclear]

5. **Can Browser Run reach preview URLs behind Access?** **Not stated, but very likely, with service tokens.** [inference from read parts] The steps:
   - Create an Access service token and add a **Service Auth** policy to the `preview_worker` Access app in Zero Trust.
   - Pass `setExtraHTTPHeaders: {"CF-Access-Client-Id": …, "CF-Access-Client-Secret": …}` to Quick Actions, or call `page.setExtraHTTPHeaders()` in Playwright.
   - Watch for "strict service token authentication," which ignores cookies.
   - If the preview app uses WebSockets, Worker-level Access returns 403, so use a hostname-based Access app.
   - For the demo, the simplest choice is to leave `workers.dev` previews public (they are `noindex`) and say so.

---

## Build sheet (exact names and limits)

| Forge piece | Primitive and exact API | Hard limits that matter | Status |
| --- | --- | --- | --- |
| Project repo | `env.ARTIFACTS.create("app",{setDefaultBranch:"main"})` or `import({source:{url},target:{name}})` | 1 GB per repo; 32 MB per blob; 2,000 git req per 10 s per repo | Artifacts **open beta**; billing starts **Oct 14** |
| Thread workspace | `(await env.ARTIFACTS.get("app")).fork(\`t-${id}\`,{defaultBranchOnly:true})` → `{name, remote, token}` | 2,000 control-plane req per 10 s per **namespace**; shard namespaces when hot | beta |
| Agent credentials | `repo.createToken("write", ttl)` on the **fork only**; `revokeToken` on land or abandon | TTL 60 s to 1 y (REST); no branch protection inside a repo | beta |
| Push hook | `triggers.events: [{type:"cf.artifacts.repo.pushed", filter:{namespace}, target:{scriptName, workflowName}}]`, or a Queue subscription to `artifacts.repo` | event payload includes `ref/before/after/commits[]`; Queue msg ≤ 128 KB | beta |
| Thread object | Agents SDK `Agent` or plain DO class with SQLite (`exports: {T: {type:"durable-object", storage:"sqlite"}}`) | 10 GB per DO; single-threaded; CPU 30 s to 5 min; one alarm | GA |
| Thread sandbox | `ctx.container.start({image: ctx.container.images.agent, enableInternet:false, instance:"standard-1"})`, `exec`, `setInactivityTimeout(≤6h)`, alarm every ~60 s during a run | 1,500 vCPU / 6 TiB / 30 TB per account; ≤ 4 vCPU / 12 GiB / 20 GB per instance | `durable_object` policy **beta**; SDK 1.0 released 2026-09-30 |
| Keep secrets out | `interceptOutboundHttps("*.artifacts.cloudflare.net", ctx.exports.GitGateway)`, `"gateway.ai.cloudflare.com"`, `"api.cloudflare.com"`; container env `GIT_SSL_CAINFO` / `NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt` | intercept-entry cap per container | read; using it for Artifacts and Wrangler is inference |
| Sleep and wake | `snapshotContainer({name})` → store id → `start({containerSnapshot:{id}})` | ≤ 20 GB; 30-day TTL; no delete API; processes not restored | **beta** |
| Live preview of unpushed work | DO `fetch` → `ctx.container.getTcpPort(8080).fetch(req)`; own hostname per sandbox | server must bind `0.0.0.0` | read |
| Pinned preview per push | `npx wrangler preview --name t-<id> --worker-name app --json` (sandbox or CI runner), or Builds with preview builds on (branches of `app` only) | 500 Previews per Worker; 100 deployments per Preview; **6 concurrent Builds**; 20 min build | Previews need Wrangler ≥ 4.135.0 |
| Build status | `GET /accounts/{id}/builds/workers/{tag}/builds`, `GET /builds/builds/{uuid}` (`preview_url`), `…/logs`; events `cf.workersBuilds.worker.build.*` | user-scoped token only | read; `preview_url` meaning unclear |
| Proof | `@cloudflare/playwright` `launch(env.BROWSER,{recording:true})`, `tracing.start/stop`, `page.screenshot()`, or Quick Action `POST /accounts/{id}/browser-run/screenshot` | 200 concurrent browsers; 3 new per second; 60 s idle (≤ 10 min keep_alive) | recording **beta** |
| Evidence store | R2 `env.EVIDENCE.put(\`${thread}/${sha}/${hash}.png\`)`; D1 index | R2 1 write per second per key; D1 10 GB and single-threaded | GA |
| Landing service | Workflow with steps: fetch fork → rebase in runner sandbox → re-verify → `git push --force-with-lease=main:<old> origin HEAD:main` → `git push origin refs/notes/*` | 50,000 concurrent instances; 1 MiB step result; 10,000 steps | `@cloudflare/ci` **0.2.0** |
| Trunk lock | one DO per repo (`idFromName("app")`) issuing leases; alarm for lease expiry | single-threaded by design | GA |
| CI on push | `CIWorkflow.pipeline()` with `ci.runner({name, command, cache:{inputs}})` | runner retries per step config | 0.2.0 |
| Revert behind flag | `env.FLAGS.getBooleanValue("thread-<id>", false, ctx)`; flip through dashboard, `wrangler flagship` or API | changes propagate "within seconds" | beta status not shown |
| Model calls | AI Gateway `…/v1/{acct}/{gw}/anthropic` + `cf-aig-authorization` | n/a | GA |
| Access | `preview_worker` Access app + Service Auth service token for robots | Worker-level Access breaks WebSockets | read |
| Rollback of production | Workers Rollbacks / deployments API | not read in depth | — |

---

## Pain points for agentic-scale development (as the platform reveals them)

- **Trunk is one Durable Object.** Each Artifacts repo is a single-threaded Durable Object with about 128 MB of memory and 2,000 git requests per 10 s. Thousands of agents fetching and pushing one project repo would hit the same hot-spot problem GitHub describes for its single reference. Artifacts' answer is "repo per unit of work," which pushes integration back onto the platform builder. [read + inference]
- **Repo-scoped write tokens mean no protected branches.** Every write token can rewrite `main`. Without forks, any agent can push to trunk. [read + inference]
- **The build plane does not scale to many threads.** Six concurrent Workers Builds per account and 20-minute builds mean "one Builds run per push per thread" stalls quickly. Wrangler-from-sandbox or the CI Workflow shifts the cost to containers. [read + inference]
- **Previews are capped and only partly isolated.** 500 Previews per Worker with silent eviction of the least recently deployed. Workflows, Queues, cron, and service bindings still reach production. Container support in Previews is "partial." [read]
- **Sandboxes need hand-built lifetime management.** Code running inside the instance does not count as activity, the timeout resets when the Durable Object restarts, snapshots cannot be deleted, and PIDs are reused after a restore. Every forge has to build its own keep-alive and recovery code. [read]
- **Proof and preview access are in tension.** Access protects previews, but robots need service tokens, Worker-level Access breaks WebSockets, and session recordings are still beta. [read]
- **Docs are moving fast.** Several Artifacts example pages conflict with the binding reference and with the Sandbox 1.0 security model (see Contradictions). That is a sign of immature APIs a week before the deadline. [read]

## How orgs are solving them (Cloudflare's own documented patterns)

- **Fork per task, with read tokens for review.** Best practices: "If you have 10,000 agents, create 10,000 repos," fork from a reviewed baseline, use short-lived `read` tokens for review and indexing, and use `write` only for the pushing session. [read]
- **Session state in a repo.** Inside Cloudflare, "a per-session Artifacts repo" holds both the filesystem and the session history, so sessions can be shared, rewound, and forked from any point. This is close to the brief's thread idea. [read: April blog]
- **Git notes for prompts and model output.** This is Cloudflare's recommended way to store the reason behind a change next to the commit. [read]
- **One CI Workflow for a whole namespace.** A platform-owned pipeline runs on every push to every repo, and each run deploys a separate Worker or a Workers for Platforms user Worker. [read]
- **The Worker holds credentials, the sandbox holds none.** Outbound intercepts allowlist exact git endpoints. Cloudflare's own guide allows clone and denies push. [read]
- **Proof against previews.** Preview probe, screenshot, and Browser Run evidence with a `debugId` matched to Preview logs. [read]

## Implications for a future forge (and for this demo)

1. **Give each thread its own fork repo, and keep trunk writable only by the landing service.** Agents get a write token for their fork, enforced by the outbound intercept. The landing Workflow alone holds trunk write access. This turns "landing is a service" into a rule the platform enforces, not just a convention. [inference]
2. **Treat `cf.artifacts.repo.pushed` filtered by namespace as the forge's event bus.** Each thread push starts a Workflow that runs `wrangler preview --name t-<id> --worker-name app --json`, then a Browser Run proof step, then writes evidence to R2 and D1, then evaluates policy. This avoids the 6-build cap and the one-repo Builds limit. Keep Workers Builds only for `main` → production. [inference]
3. **Land with compare-and-swap, not a long lock.** `git push --force-with-lease=main:<expected>` from the landing runner gives an atomic check on the ref through standard receive-pack v1. A trunk Durable Object only has to order attempts and wake losing threads. Whether Artifacts honours the old-OID check exactly like stock git is **untested**. Test it on day 1. [inference]
4. **Reference proof by the Deployment URL, never by the Preview URL.** Previews are evicted at 500, so record the deployment ID and store screenshots and recordings in R2, because the deployment can vanish (100 per Preview). [read + inference]
5. **Keep notes small and write them in the landing step.** Write one note per landed commit with the thread id, evidence manifest hash, and policy result, then push `refs/notes/*`. Keep large context in Durable Object SQLite or R2. [inference]
6. **Build sandbox wake-up into the thread Durable Object from the start.** Use one alarm loop for keep-alive, checkpoint snapshots, and idle shutdown, and accept that a dev server must be restarted after a restore. [read + inference]
7. **Size the demo to stay under the caps.** For example, 6 to 20 threads, each on `standard-1`, with one Worker carrying ≤ 50 previews. Say in the video what changes at scale: namespace sharding, preview recycling, and speculative batches instead of a single trunk Durable Object. [inference]

## Contradictions and pushback

- **Billing date.** The docs pricing page and changelog both say **October 14, 2026**. The blog post (2026-10-01) says **October 15, 2026**. Both read. Plan for the 14th, which is the deadline day.
- **Binding handle shape.**
  - The binding reference says `get()` returns a capability and "Repository metadata is not exposed as properties ... Call `repo.info()`."
  - The "Sandbox SDK + Artifacts" example (2026-09-29) reads `repo.defaultBranch` and `repo.remote` directly.
  - The April changelog shows `created.repo.info()` on a create result.
  - Trust the binding reference and `wrangler types`. [read]
- **isomorphic-git page (2026-05-21)** says "The Artifacts binding ... cannot read or write files inside them." The current binding has `readFile`, `readBlob`, `readTree`, and `log`. The page is out of date for reads and still accurate for writes. [read]
- **Security pattern conflict.** The Artifacts sandbox example uses 0.x `getSandbox()` and `sandbox.setEnvVars({ARTIFACTS_GIT_REMOTE: "https://x:<token>@…"})`, which puts a write token inside the sandbox. Sandbox 1.0's security page says a token in a clone URL ends up in `.git/config`, where "any of that code can read the token." Use the intercept pattern. [read]
- **Repo per agent versus Builds.** Artifacts says "Do not use one shared repo as a queue for many autonomous agents." Workers Builds connects exactly one repo, with `main` as production. The brief's rule "threads must be branches of the project repo" comes from Builds, not from Artifacts, and can be avoided with Wrangler previews. [read + inference]
- **Workflows concurrency.** The limits table says 50,000 concurrent instances. The prose on the same page says "the 10,000 concurrent instance limit." Design for 10,000. [read]
- **Subrequests.** The Sandbox SDK 0.x limits page says 1,000 per request on Paid. The current Workers limits page says 10,000 by default, up to 10 million. [read]
- **Scale rhetoric.** The competition page says "hundreds of thousands of agents." The blog says "hundreds, or even thousands." A 500-preview Worker and a single-Durable-Object repo do not reach the former without sharding. [read + inference]
- **Brief correction.** The brief's Sandbox section described the SDK from an index page. The real 1.0 model makes your own Durable Object the sandbox, so thread equals Durable Object equals container owner, which is consistent with the brief. Several 0.x features, such as built-in preview URLs, backups, and sessions, become **your** code in 1.0. Budget time for that. [read]
- **Brief correction.** The brief does not mention the US/Canada eligibility rule or the in-person requirement for the winner. Both could disqualify an entry. [read]

## Open questions (not resolved from docs)

1. What JSON does `wrangler preview --json` return? Does it include the deployment ID or Deployment URL, beyond `.preview.urls[0]`?
2. Is `preview_url` from `GET /builds/builds/{uuid}` the moving Preview URL or the pinned Deployment URL, and is it filled in for Artifacts-connected Workers?
3. Does Artifacts receive-pack enforce the old-OID check, and does it advertise `atomic` or `push-options`? This decides whether `--force-with-lease` is enough for landing.
4. What is the per-application instance cap under the `durable_object` scheduling policy? What are typical cold-start and snapshot-restore times?
5. Is FUSE available in Containers, which ArtifactFS needs?
6. Can the binding's `readFile` read a notes ref, using the commit SHA as the path? Can `log()` follow `refs/notes/*`?
7. Can an Artifacts Workers Builds connection be created through the REST API? Only `provider_type: "github"` is shown.
8. Repo-level Artifacts events through Queues seem to need a `namespace` plus `repo_name` subscription. Is there a namespace-wide Queue subscription, or only the Workflow `triggers.events` filter?
9. Does the Service Auth path through `setExtraHTTPHeaders` work end to end against a `preview_worker` Access app? It needs a 10-minute test.
10. Is Flagship GA or beta, and what does it cost? Is Workers Previews itself labelled beta? None of the pages I read say so.
11. Will Wrangler inside a sandbox trust the Containers CA (`NODE_EXTRA_CA_CERTS`) when `api.cloudflare.com` is intercepted for token injection?

---

## Sources (all opened; "updated" is the page's own "Last updated" date)

**Competition**
- We want you to build the next Git platform on Cloudflare (blog), published 2026-10-01 — https://blog.cloudflare.com/next-git-platform-on-cloudflare/
- Build the next GitHub, Cloudflare Challenge (competition page), accessed 2026-10-12 — https://www.cloudflare.com/git-competition/
- Build the Next-Gen Git Platform on Cloudflare Competition, Official Rules (PDF), accessed 2026-10-12 — https://www.cloudflare.com/documents/build-next-gen-git-platform-competition-terms.pdf
- Artifacts: versioned storage that speaks Git (blog), 2026-04-16 per changelog — https://blog.cloudflare.com/artifacts-git-for-agents-beta/

**Artifacts docs**
- Artifacts docs index (llms.txt) — https://developers.cloudflare.com/artifacts/llms.txt
- Workers binding, updated 2026-10-01 — https://developers.cloudflare.com/artifacts/api/workers-binding/
- REST API, updated 2026-08-13 — https://developers.cloudflare.com/artifacts/api/rest-api/
- Git protocol, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/api/git-protocol/
- Errors, updated 2026-05-21 — https://developers.cloudflare.com/artifacts/api/errors/
- Best practices, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/concepts/best-practices/
- How Artifacts works, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/concepts/how-artifacts-works/
- Repositories, updated 2026-08-13 — https://developers.cloudflare.com/artifacts/concepts/repositories/
- Namespaces, updated 2026-08-13 — https://developers.cloudflare.com/artifacts/concepts/namespaces/
- ArtifactFS, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/guides/artifact-fs/
- Authentication, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/guides/authentication/
- Build and deploy Artifacts repos, updated 2026-10-01 — https://developers.cloudflare.com/artifacts/guides/build-and-deploy-on-push/
- Event subscriptions, updated 2026-05-21 — https://developers.cloudflare.com/artifacts/guides/event-subscriptions/
- Import repositories, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/guides/import-repositories/
- Sandbox SDK + Artifacts, updated 2026-09-29 — https://developers.cloudflare.com/artifacts/examples/sandbox-sdk-artifacts/
- isomorphic-git, updated 2026-05-21 — https://developers.cloudflare.com/artifacts/examples/isomorphic-git/
- Metrics, updated 2026-04-25 — https://developers.cloudflare.com/artifacts/observability/metrics/
- Changelog (entries 2026-04-16 to 2026-10-01) — https://developers.cloudflare.com/artifacts/platform/changelog/
- Limits, updated 2026-10-01 — https://developers.cloudflare.com/artifacts/platform/limits/
- Pricing, updated 2026-10-01 — https://developers.cloudflare.com/artifacts/platform/pricing/

**Workers Builds, Previews, Access**
- Cloudflare Artifacts integration, updated 2026-10-01 — https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/artifacts-integration/
- Git integration, updated 2026-10-01 — https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/
- Build branches, updated 2026-10-01 — https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/
- Builds API reference, updated 2026-09-22 — https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/
- Builds limits and pricing, updated 2026-05-29 — https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- Builds event subscriptions, updated 2026-04-23 — https://developers.cloudflare.com/workers/ci-cd/builds/event-subscriptions/
- Previews, updated 2026-09-24 — https://developers.cloudflare.com/workers/previews/
- Previews get started — https://developers.cloudflare.com/workers/previews/get-started/
- Previews configuration — https://developers.cloudflare.com/workers/previews/configuration/
- Previews resources and isolation, updated 2026-09-22 — https://developers.cloudflare.com/workers/previews/resources/
- Previews examples, updated 2026-10-01 — https://developers.cloudflare.com/workers/previews/examples/
- Previews test and debug, updated 2026-10-10 — https://developers.cloudflare.com/workers/previews/test-and-debug/
- Previews custom domains, updated 2026-09-24 — https://developers.cloudflare.com/workers/previews/custom-domains/
- Compare workflows, updated 2026-09-22 — https://developers.cloudflare.com/workers/previews/compare-workflows/
- Wrangler Workers commands (`preview`, `preview delete`, `preview secret`) — https://developers.cloudflare.com/workers/wrangler/commands/workers/
- Workers limits (subrequests) — https://developers.cloudflare.com/workers/platform/limits/
- Cloudflare Access for Workers, updated 2026-08-18 — https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Access service tokens — https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/
- workers-builds-notifications-template `src/index.ts` and `src/api.ts` (GitHub, main) — https://github.com/cloudflare/templates/tree/main/workers-builds-notifications-template

**Sandboxes, Containers, Agents**
- Sandboxes on Cloudflare, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/
- Choose a sandbox environment, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/concepts/
- Sandbox lifetime, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/concepts/lifetime/
- Sandbox security, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/concepts/security/
- Run coding agents in a sandbox, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/coding-agents/
- Run Claude Code in a sandbox, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/coding-agents/claude-code/
- Build a coding agent runner, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/get-started/build-a-coding-agent-runner/
- Call an authenticated API from a sandbox, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/network/call-an-authenticated-api/
- Clone a private repository, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/network/clone-a-private-repository/
- Preview a web application, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/previews/
- Serve previews on their own hostnames, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/previews/serve-previews-on-their-own-hostnames/
- Save a sandbox automatically, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/files/save-a-sandbox-automatically/
- Changes in Sandbox SDK 1.0, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/sdk/migrate/changes-in-1-0/
- Sandbox SDK 0.x limits, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/sdk/platform/limits/
- Sandbox SDK 0.x pricing, updated 2026-09-30 — https://developers.cloudflare.com/sandbox/sdk/platform/pricing/
- Containers limits and instance types, updated 2026-09-30 — https://developers.cloudflare.com/containers/platform/limits/
- Containers pricing, updated 2026-10-05 — https://developers.cloudflare.com/containers/platform/pricing/
- Durable Object Container API — https://developers.cloudflare.com/containers/api/durable-object-container/
- Scheduling policies, updated 2026-09-30 — https://developers.cloudflare.com/containers/configuration/scheduling-policy/
- Build Agents on Cloudflare, updated 2026-09-18 — https://developers.cloudflare.com/agents/
- Agents Sandbox tool, updated 2026-09-30 — https://developers.cloudflare.com/agents/tools/sandbox/

**Browser Run**
- Browser Run docs index — https://developers.cloudflare.com/browser-run/llms.txt
- Limits, updated 2026-09-26 — https://developers.cloudflare.com/browser-run/limits/
- Pricing, updated 2026-04-21 — https://developers.cloudflare.com/browser-run/pricing/
- FAQ — https://developers.cloudflare.com/browser-run/faq/
- Screenshot endpoint — https://developers.cloudflare.com/browser-run/quick-actions/screenshot-endpoint/
- Playwright, updated 2026-09-28 — https://developers.cloudflare.com/browser-run/playwright/
- Session recording (beta), updated 2026-09-26 — https://developers.cloudflare.com/browser-run/features/session-recording/
- Automatic request headers, updated 2026-06-16 — https://developers.cloudflare.com/browser-run/reference/automatic-request-headers/

**Storage, orchestration, other**
- Durable Objects limits, updated 2026-06-01 — https://developers.cloudflare.com/durable-objects/platform/limits/
- Durable Objects alarms — https://developers.cloudflare.com/durable-objects/api/alarms/
- Workflows limits, updated 2026-09-21 — https://developers.cloudflare.com/workflows/reference/limits/
- Queues limits, updated 2026-04-21 — https://developers.cloudflare.com/queues/platform/limits/
- Queues event subscriptions, updated 2026-04-21 — https://developers.cloudflare.com/queues/event-subscriptions/
- Manage event subscriptions, updated 2026-04-21 — https://developers.cloudflare.com/queues/event-subscriptions/manage-event-subscriptions/
- D1 limits, updated 2026-04-21 — https://developers.cloudflare.com/d1/platform/limits/
- R2 limits, updated 2026-06-08 — https://developers.cloudflare.com/r2/platform/limits/
- AI Gateway overview, updated 2026-04-20 — https://developers.cloudflare.com/ai-gateway/
- Flagship overview, updated 2026-06-30 — https://developers.cloudflare.com/flagship/
- Flagship get started, updated 2026-08-26 — https://developers.cloudflare.com/flagship/get-started/
- Flagship binding methods — https://developers.cloudflare.com/flagship/binding/methods/
- Flagship limits — https://developers.cloudflare.com/flagship/reference/limits/
- Flagship API tokens — https://developers.cloudflare.com/flagship/api-tokens/
- npm registry, latest versions checked 2026-10-12: `@cloudflare/ci` 0.2.0 (2026-09-14), `@cloudflare/sandbox` 1.0.0 (2026-09-30), `@cloudflare/playwright` 1.3.6 (2026-08-20), `@cloudflare/flagship` 0.6.0 (2026-10-05), `wrangler` 4.149.0 (2026-10-08), `agents` 0.28.0 (2026-10-09) — https://registry.npmjs.org/

**Secondary (search results only, not relied on):** braindetox.kr, zeli.app, and groundy.com summaries of the competition, seen in one WebSearch result list.

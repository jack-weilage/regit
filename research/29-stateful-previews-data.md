# 29 — Stateful previews: data, migrations, dependencies, and what can be proven before merge

Researcher key: `29-stateful-previews-data` · Written 2026-10-12 · About 38 pages opened. WebSearch was used 4 times.

Tags: **[read]** means verified on a page I opened, **[secondary]** means a search snippet or coverage, and **[inference]** means my own reasoning.

The brief's idea #4 ("every change is bootable") assumes a preview is a faithful stand-in for production. That holds for stateless UI and request handlers. It breaks for anything touching **state** (databases, queues, caches, object stores), **time** (migrations that run for hours, cron jobs, backfills), **other systems** (third-party APIs, shared services, workflows), and **scale** (locks, load, data shape). This file covers how the industry handles each of these and what a forge would have to provide for an agent to *prove* a backend, data or infra change, not just a UI change.

---

## Summary

1. **Copy-on-write database branching is a mature, cheap product category.** Neon branches are metadata operations: "The engine does not duplicate files or pages", and "only new or modified data consumes additional storage" [read]. Xata advertises about 3 s branch creation and "1,000 branches for $1" [read]. Postgres.ai thin clones a 10 TiB database in under 2 s, or up to 30 s with 15 concurrent users [read]. Speed and cost are no longer what blocks per-thread databases.
2. **Agents already make most new databases and branches.** Neon's agent-use-case material and secondary sources say about 80% of Neon databases are created by agents [secondary; the base and the date vary by source]. Xata's homepage says "coding agents create 50% of branches", with branch count growing 5x month over month [read, vendor claim]. Neon has an Agent Plan and a documented pattern for "snapshots as checkpoints" of code and state together [read].
3. **The data is the hard part, not the copy.** Most mainstream branching gives **schema without data** by default. Supabase branches are "a copy of your Supabase project, minus the data" [read]. PlanetScale: "only the schema is copied" unless Data Branching restores the latest backup, which never syncs or merges back [read]. Render preview datastores "start without data" and need an `initialDeployHook` seed [read]. Only Neon and Xata (and DBLab, self-hosted) branch real production data cheaply. That raises a PII problem, now handled by **static masking** on branch creation: Neon anonymized branches use PostgreSQL Anonymizer, are in beta, and "Masking runs once when the anonymized branch is created" [read].
4. **No mainstream Postgres or MySQL branch can be diffed or merged as data.** Neon, PlanetScale and Supabase branches are clones; changes flow back only as schema migrations. DoltHub's critique is accurate: a clone "has no ongoing relationship to its source", and without a merge base there is "no way to identify which edits came from where" [read; vendor]. Dolt and Doltgres are the only SQL engines with cell-level diff, merge and conflicts [read].
5. **A migration's safety is mostly a property of production data and load, which a preview does not have.** Atlas's lint taxonomy makes this explicit. Its categories are *destructive* (DS1xx), *data-dependent* (MF1xx: "may fail depending on existing data", e.g. adding a unique index), *backward-incompatible* (BC1xx: breaks clients still on the old schema), and *locking/table rewrite* (PG1xx/PG3xx/MY1xx) [read]. Only the first category can be judged from the diff alone. Two need real data, and one needs knowledge of the deployed clients.
6. **The best existing "migration proof" is GitLab's.** A merge request that adds a migration triggers a pipeline that runs it against a **Postgres.ai thin clone of the GitLab.com production database**. A bot posts per-query timings, row counts, size change and runtime histograms, samples background-migration batches for 30 minutes, and sets a `database-testing` commit status that **blocks merge until it succeeds** [read]. This is "merge on proof" for stateful change, and it already exists.
7. **Schema changes are deployed by a separate, serialized system with its own revert window, not by git merge.** PlanetScale deploy requests run an online ghost-table copy and cutover, are **serial by default** (parallel lanes cannot touch the same table), can be **gated** before cutover, and can be reverted "for up to 30 minutes" with the data written in that window kept [read]. Safe migrations reject direct DDL on production [read]. gh-ost does the same for MySQL via binlog streaming and recommends `--test-on-replica`, "make it continuous" [read].
8. **Backward-incompatible change has to be split across several landings (expand → migrate → contract).** The pattern dates to Danilo Sato in 2014 [read]. Stripe's four-step dual-write migration moved hundreds of millions of objects and "never attempted to change more than a few hundred lines of code at one time" [read]. pgroll automates it in Postgres by serving old and new schema versions at once through views and triggers [read]. **A single thread therefore cannot prove a breaking data change. It is a multi-landing program.**
9. **Microservice previews have converged on request-level isolation over a shared baseline.** Uber SLATE uses a tenancy in Jaeger baggage plus routing overrides in production, with a 2-day TTL [read]. Okteto Divert uses `baggage: okteto-divert=<ns>` [read]. Signadot uses OpenTelemetry/B3 propagation, "only changed services are deployed", database plugins that create temporary schemas, and sandbox-specific Kafka topics [read]. The common weak spots: **every hop must propagate the header**, **async flows lose it** (Uber's own known gap) [read], and **state is shared unless you opt in to isolation** [read].
10. **Behavioural diffing exists for APIs and is the right primitive for agent proof.** Twitter's Diffy runs candidate, primary and secondary side by side and uses the primary-vs-secondary disagreement rate to filter noise [read]. Speedscale replays recorded traffic with auto-mocked Postgres and Stripe dependencies (4,917 of 4,919 identical in its example) [read]. Signadot SmartTests diff request/response pairs from a PR sandbox and a baseline field by field, learn noise, and rate diffs High, Medium or Low, with Low "never blocking" [read]. GitHub Scientist compares control and candidate on production reads only, because it is "not meant to be used for any code that has side-effects" [read].
11. **Third parties are adapting to agents.** Stripe's docs now tell coding agents to run `stripe sandbox create` to "provision an anonymous Stripe sandbox with working API keys. No account registration required", and recommend separate sandboxes for CI [read]. Record and replay (WireMock, Speedscale) covers APIs that offer no sandbox [read].
12. **Infra changes already have a native proof object: the plan.** `terraform plan -out` produces a saved plan, `-detailed-exitcode` returns 2 when there is a non-empty diff, and HashiCorp warns that a speculative plan may not match the result because "other changes made to the target system in the meantime" [read]. A plan is a *diff of intended effects*, so it needs a staleness check at landing time, much like a rebase.
13. **The testing-in-production camp says previews cannot prove the most important properties.** Charity Majors: "Staging is not production". Capture and replay "is not going to tell you what's going to happen tomorrow". The answer is canaries, flags and observability [read]. For stateful and scale-dependent change, "proof" has to continue after merge as a progressive-rollout record, not stop at a pre-merge gate.
14. **On the Cloudflare demo stack, state isolation is partial.** Per sibling file 23, Workers Previews isolate Durable Objects automatically. D1, KV and R2 are shared unless bound separately. Workflows, queue consumers, cron, routes and service bindings reach **production** [read via 23]. D1 Time Travel "does not yet allow you to clone or fork an existing database to a new copy" and restores "overwrite the database in place" [read]. A thread on this stack cannot get a production-shaped data branch. It can only get an empty, seeded DO-SQLite or a separately bound D1.

---

## Detailed findings

### A. Database branching: how it works and what it gives you

**Neon (Postgres, copy-on-write at the storage layer)**
- Mechanism: safekeepers replicate WAL via Paxos, and the pageserver "materialize[s] page versions by combining previously materialized base pages and committed WAL records" and serves pages at a requested LSN. A branch "points to an existing point in history and begins diverging from there using copy-on-write semantics". "The engine does not duplicate files or pages." [read] https://neon.com/docs/introduction/architecture-overview
- A branch can start from the current state or a past state. Creating one adds no load on the parent. Instant restore works within the history window: 6 h on Free, 1 day on paid by default, up to 7 days on Launch and 30 days on Scale. Branch TTL/expiry is supported. [read] https://neon.com/docs/introduction/branching
- Plan limits: 10 branches per project on Free and Launch, 25 on Scale. Extra branches are $1.50 per branch-month (about $0.002/hour), up to 5,000 per project. Scale to zero after 5 min (configurable on Scale). 100 manual snapshots on paid plans. [read] https://neon.com/docs/introduction/plans
- **Schema-only branches** (beta) are independent root branches with no parent history. Reset-from-parent is not supported. Caps: 1 GB on Free, 3 GB on Launch, 20 GB on Scale. They are intended for "confidential information". [read] https://neon.com/docs/guides/branching-schema-only
- **Anonymized branches** (beta) use PostgreSQL Anonymizer **static** masking. The branch is unavailable while masking runs. "Foreign key columns cannot be masked directly." Rerunning applies rules to already-masked data. Reset and restore are not available. [read] https://neon.com/docs/workflows/data-anonymization
- Neon's framing (Nov 11, 2025): full data is the most realistic but carries compliance risk. Anonymized data has a realistic shape but adds a storage delta. Synthetic/seed data drifts and misses edge cases. Dynamic masking at query time is planned. [read] https://neon.com/blog/branching-environments-anonymized-pii
- **Vercel integration**: each Preview Deployment gets a branch named `preview/<git-branch>`, and `DATABASE_URL` is injected per deployment via webhook. Vercel retains previews for 6 months by default, "so branches can persist for months after a PR closes". [read] https://neon.com/docs/guides/vercel-managed-integration
- **Agent pattern**: snapshots of a root branch are used as checkpoints. Restore with `finalize_restore: true` moves the compute endpoint, so the connection string stays stable while the branch ID changes. `finalize_restore: false` gives a preview branch. Restores drop connections for "milliseconds and occasionally up to a second". Snapshot storage is $0.09/GB-month. The page does *not* explain how to link snapshots to commits; it points to a demo repo. [read] https://neon.com/docs/ai/ai-database-versioning
- Agent scale claims: one platform ran "over 300k Postgres instances on Neon with only a single engineer", and the Agent Plan scales "to millions of active databases". Named users include Replit, Anything and Databutton. [read] https://neon.com/use-cases/ai-agents. The "80% of databases created by agents" figure appears in search results and coverage, with inconsistent base and date [secondary].

**Xata (Postgres)**: "~3 sec" branch creation and "1,000 branches for $1". 100 PRs against a 100 GB database need about 400 GB instead of 10 TB. Production-clone branches come with "built-in anonymization" and continuous sync. "Coding agents create 50% of branches; branch count grew 5x month over month." [read, vendor marketing] https://xata.io/

**Postgres.ai Database Lab (self-hosted thin clones)**: ZFS/LVM2 copy-on-write. A 10 TiB clone takes "less than 2 seconds" for a single user and up to 30 s with 15 concurrent users. "Dozens of thin clones" run on one mid-size machine. [read, vendor figures] https://postgres.ai/docs/database-lab

**PlanetScale (MySQL/Vitess)**
- Development branches copy the schema only: "Please note that only the schema is copied". Billing is "prorated to the millisecond". [read] https://planetscale.com/docs/vitess/schema-changes/branching
- Data Branching seeds a branch "From most recent backup". It takes all tables, with no filtering. "PlanetScale does not provide data syncing", and changes don't merge back. Seeding from production creates a production-sized branch; the example is PS-80 with 100 GB at $179 plus $135. [read] https://planetscale.com/docs/vitess/schema-changes/data-branching

**Supabase**
- Branches are data-less by default. Preview branches are deleted on PR merge or close, while persistent branches are not. The deploy sequence on merge is Clone → Pull → Health (waits up to 2 min) → Configure → Migrate → Seed → Deploy. [read] https://supabase.com/docs/guides/deployment/branching
- Branching 2.0 (Jul 16, 2025) works without git (dashboard, CLI, API). A branch is "a copy of your Supabase project, minus the data". A merge page exists, and pulling from production overwrites edited Edge Functions. [read] https://supabase.com/blog/branching-2-0

**Dolt / Doltgres (version-controlled SQL)**
- DoltHub (Oct 1, 2026): PG18 `CREATE DATABASE … TEMPLATE … STRATEGY=FILE_COPY` with `file_copy_method='clone'` gives cheap clones on ZFS, XFS or Btrfs. But the source "cannot have other sessions connected during cloning", and clones can't diff, merge or detect conflicts. Clones are "enough" for migration iteration, CI from a known state, snapshots and derived anonymized datasets. Branches are needed when edits must be reviewed and merged back. [read; vendor] https://www.dolthub.com/blog/2026-10-01-postgres-cheap-database-clones/
- "Cursor for Everything" (Nov 19, 2025): "Agents need version control… branches… tests… clones… diffs". Agent writes to application data should land on a branch that a human diffs and merges. [read; vendor] https://www.dolthub.com/blog/2025-11-19-cursor-for-everything/

**Cloudflare D1** (relevant to the demo stack): Time Travel restores to "any minute within the last 30 days" on Paid. Restore "overwrites the database in place". It "does not yet allow you to clone or fork an existing database to a new copy". Forking is listed as future work. [read] https://developers.cloudflare.com/d1/reference/time-travel/

### B. Schema migration safety

- **Expand/contract (Parallel Change)**, Danilo Sato, 13 May 2014: expand ("augment the interface to support both the old and the new versions"), then migrate, then contract. "Need discipline to finish the transition." [read] https://martinfowler.com/bliki/ParallelChange.html
- **Stripe online migrations** (Feb 2, 2017): dual write → change reads → change writes → remove old data. Covered hundreds of millions of Subscriptions. Used Hadoop/Scalding for offline backfill identification and Scientist to detect mismatches: "alerted us as soon as a single piece of data was inconsistent in production". "We never attempted to change more than a few hundred lines of code at one time." [read] https://stripe.com/blog/online-migrations
- **pgroll** (Xata): automates expand/contract. `start` creates new columns, backfills, and installs triggers that sync old and new columns. Both schema versions are served via views, and clients pick one with `search_path`. `complete` drops the old schema, and rollback is possible "at any point". Requires PG 14 or later. [read] https://github.com/xataio/pgroll
- **gh-ost** (GitHub): triggerless, reads the binlog stream, uses a ghost table and incremental row copy, and is throttleable. Cutover can be postponed with `--postpone-cut-over-flag-file`. `--test-on-replica` runs the full flow but leaves the original table in place so the two can be compared. "This is how we continuously test gh-ost in production… make it continuous." GitHub migrates replica tables one at a time and checksums the results. [read] https://github.com/github/gh-ost
- **PlanetScale deploy requests**: show a schema diff and lint (unique keys, charsets, FK). On conflict detection, "it is ultimately up to you to confirm merge details". Re-approval is required if the schema changes after approval. Deploys are serial by default, and parallel deploys are limited to one per branch and cannot touch the same table. Online DDL copies the table, syncs and cuts over. Instant deploys (`ALGORITHM=INSTANT`) cannot be reverted. Gated deploys hold the cutover. Revert is possible "for up to 30 minutes", and can fail when data no longer fits the old schema. [read] https://planetscale.com/docs/vitess/schema-changes/deploy-requests
- **PlanetScale safe migrations**: "Any CREATE, ALTER, or DELETE commands… will fail" on the protected branch, so DDL only arrives through deploy requests. [read] https://planetscale.com/docs/vitess/schema-changes/safe-migrations
- **Atlas lint analyzers**: DS101–103 (destructive), MF101–104 (data-dependent), BC101–104 (backward-incompatible), CD101–103 (constraint deletion), PG101–109 (non-concurrent index etc.), PG301–320 (blocking rewrites, e.g. a type change), MY130–148 (MySQL table copies), TX101 (statements that can't share a transaction), OW101–102 (ownership), and a non-linear-migration check. [read] https://atlasgo.io/lint/analyzers
- **GitLab database testing pipeline**: a manual `db:gitlabcom-database-testing` job runs on MRs that add migrations, against Database Lab thin clones of production. The bot comment reports per-migration time, size change, every query with calls, timings and rows changed, and background-migration batch sampling (30 minutes, uniform across the ID range). The `database-testing` commit status blocks merge until success. Clone access is limited to DB maintainers. **No numeric thresholds are defined**; humans interpret the report. [read] https://docs.gitlab.com/development/database/database_migration_pipeline/
- Bytebase SQL review: the docs URL returned 404, so not verified.

### C. Masked and synthetic data

- **Tonic**: Structural does masking and de-identification with referential integrity, plus "patented subsetting". eBay shrank 8 PB to a 1 GB subset. Fabricate generates synthetic relational databases "and mock APIs". Textual redacts free text. "Each includes a built-in AI agent". All figures are vendor customer claims. I could not verify a "Tonic Ephemeral" product page. [read] https://www.tonic.ai/
- Neon static masking: see section A. Speedscale masks sensitive fields "at capture time, so recordings can be committed and shared" [read].

### D. Ephemeral and preview environments

- **Vercel**: a preview deployment is created per non-production branch push or PR. There is a branch-specific URL and a commit-specific URL. Environments have their own variables (e.g. DB connection). Custom environments allow 1 per project on Pro and 12 on Enterprise. Staged production deployments "use production environment variables, so testing can access production services and data". [read] https://vercel.com/docs/deployments/environments
- **Render**: previews come from a `render.yaml` Blueprint, one per PR, and need a Pro plan. Datastore copies "do not include data". `initialDeployHook` seeds once. `sync:false` secrets are not copied. `previewValue` can point at "one shared database". `expireAfterDays` defaults to no expiry. Billing is prorated by the second. Render Workflows are not supported in previews. [read] https://render.com/docs/preview-environments
- **Okteto**: preview environments per PR, cloud dev environments, and an agent plugin that gives "an isolated, production-like environment" [read] https://www.okteto.com/docs/. **Divert** deploys only the services in your manifest and routes the rest to a shared namespace via `baggage: okteto-divert=<namespace>`. The database is **shared by default**, with an isolated DB recommended "for schema changes or test data". Queue isolation is a pattern you write yourself (namespace attribute or header plus consumer filter). Every service must forward the header. [read] https://www.okteto.com/docs/development/using-divert/
- **Signadot**: "a sandbox is a lightweight delta, not a full environment clone". Routing goes through devmesh or Istio/Linkerd with OpenTelemetry/B3 propagation. Resource plugins create temporary schemas or databases per sandbox. Kafka and RabbitMQ get sandbox-specific topics and queues with ordering preserved. MCP server for agents. Comparisons to Uber SLATE and Lyft Staging Overrides. [read] https://www.signadot.com/docs/overview
- Signadot "Agent loops… feedback problem" (Sep 14, 2026): "Total loop cost is the product, not the sum" (iterations × cost per iteration). "A loop can only fix what its feedback can see." It proposes a four-layer verification surface owned by the platform team: runtime sandboxes, **plans** ("The organization decides what passing means"), structured feedback scoped to the loop's own requests, and controls (budgets, iteration ceilings, stall detection, a durable record). It is silent on test data. [read] https://signadot.com/blog/agent-loops-feedback-problem/
- Signadot "AI coding agents broke the PR pipeline" (May 5, 2026): "Generation got cheap. Validation didn't." Each PR should carry evidence validated against real dependencies. Cites CodeRabbit's 1.7x more issues in AI co-authored PRs (470 PRs). [read; vendor; numbers secondhand] https://signadot.com/blog/ai-generated-code-crisis/
- Signadot "Validating AI-generated code" (May 8, 2026): "A test against a mock is a test against what the author imagined the dependency does." Lists failures mocks miss: schema drift, unmodeled side effects (emitted events, metrics), timing (retry deadlocks). [read] https://signadot.com/blog/validating-ai-generated-code/
- LegalOn case study (Sep 2, 2026): about 200 engineers, about 300 PRs on a busy day in the infra repo, "approaching a state where more than half need no human review". Inner-loop feedback takes tens of seconds (mirrord) and previews take minutes. Backends "added database connections" to the rollout's complexity. Data isolation is not described. "Writing code was never the bottleneck to begin with." [read] https://signadot.com/blog/legalon-technologies-agent-ready-golden-path-on-gke/
- **Uber SLATE** (Oct 20, 2022): short-lived environments *inside production*, with a default TTL of 2 days. One version and instance per service under test. `request-tenancy` in Jaeger baggage leads the edge gateway to add `routing-overrides`. Test accounts create test-tagged entities. Kafka messages carry tenancy, and Cadence task lists are configurable. "Services treat every request equally whether it's production or test." Known gap: async flows lose headers unless baggage is stored in event payloads. [read] https://www.uber.com/blog/simplifying-developer-testing-through-slate/
- Lyft Staging Overrides: the page returned 403 and is not read. It is referenced by Signadot [secondary].

### E. Service virtualization and third-party APIs

- **Stripe sandboxes**: isolated environments. Use "separate sandboxes for local development and continuous integration (CI)". Agents can run `stripe sandbox create` for an "anonymous Stripe sandbox with working API keys. No account registration required." Limitations include IC+ pricing and Connect platform↔connected-account sandboxes. [read] https://docs.stripe.com/sandboxes
- **WireMock record and playback**: proxies to the real API and creates stubs when recording stops. Repeated identical requests become ordered Scenarios, and "the last response repeats once the series ends". That models state only as a fixed sequence. [read] https://wiremock.org/docs/record-playback/
- **Speedscale / proxymock**: records traffic (4,919 requests in the example), auto-mocks HTTP, gRPC, Postgres, MySQL and Redis, and replays "every response against what production actually returned". The example found 2 diffs, one of them a float tax value 4.20 → 4.2000000001. CI gating per PR. The page shows an agent change blocked on a 500 response. [read; vendor] https://speedscale.com/
- **LocalStack**: emulates AWS locally and in CI, with Cloud Pods snapshots and ephemeral instances. The page gave no parity data. [read, thin] https://docs.localstack.cloud/aws/

### F. Shadow traffic, differential testing, testing in production

- **Diffy**: a proxy that multicasts to candidate, primary and secondary. Primary-vs-secondary disagreement is treated as noise and compared with the primary-vs-candidate rate, giving a verdict of "Safe to ship" or "Regressions detected". There is per-endpoint noise tuning. [read] https://github.com/opendiffy/diffy
- **GitHub Scientist** (Feb 3, 2016): randomized-order execution of control and candidate, where the caller gets the control's result. Mismatches go to a publisher (Graphite, Redis). It was built for the permissions rewrite because "tests alone couldn't show that the new system matched legacy behavior on production data". Only for code without side effects. [read] https://github.blog/developer-skills/application-development/scientist/
- **Istio mirroring**: "fire and forget", the Host gets a `-shadow` suffix, and `mirrorPercentage` sets the fraction. The mirror's responses are dropped, so diffing them needs a separate component. [read] https://istio.io/latest/docs/tasks/traffic-management/mirroring/
- **Charity Majors**, "Yes, I test in prod" (QCon SF 2018): "Staging is not production". Capture/replay "is not going to tell you what's going to happen tomorrow". Pre-prod catches known unknowns, and production testing uses canaries, flags, load testing with about 20% headroom, and shadowing. For database work, capture/replay is the "gold standard", but don't build it yourself. Keep PII out of operational data. [read] https://www.infoq.com/presentations/testing-production-2018

### G. Data diffs and plan diffs

- **Datafold Data Diff**: value-level diffs ("the exact rows and columns that differ") between any two systems, environments or points in time. Runs in CI "before and after every pull request". Available via UI, API and **MCP**. The page did not explain the algorithm. [read; vendor] https://www.datafold.com/data-diff
- **Terraform plan**: `-out` saves a plan, which `apply` executes. `-detailed-exitcode` returns 0 for no changes, 1 for an error and 2 for changes. A speculative plan may differ because of "other changes made to the target system in the meantime", so "always re-check the final non-speculative plan". Plan files contain config and variables, so treat them as sensitive. [read] https://developer.hashicorp.com/terraform/cli/commands/plan

---

## Pain points for agentic-scale development

1. **Fidelity versus safety for data.** Real data surfaces MF-class failures (unique violations, NULLs, lock duration) but carries PII. Schema-only or seed data is safe but proves little about migrations [read: Atlas MF codes, Neon PII blog]. Static masking costs a full branch rewrite and makes the branch unavailable while it runs [read].
2. **Branch sprawl and lifetime mismatch.** Vercel keeps previews for 6 months, so Neon branches linger [read]. Render previews have no expiry by default [read]. Neon caps out at 5,000 branches per project and charges $1.50 per branch-month beyond the included ones [read]. Thousands of threads, each with a DB branch, need lifecycle tied to the *thread*, not to the deployment or the PR [inference].
3. **Serialization moves to the schema.** PlanetScale deploys are serial, parallel lanes can't touch the same table, and an open gated deploy "holds the serial queue" [read]. Many agents touching one hot table converge on a single queue the forge doesn't control, a second "single hot ref" [inference].
4. **One thread can't prove a breaking change.** Expand → migrate → contract spans several landings, possibly weeks apart. Stripe kept each step to "a few hundred lines" [read]. Agents optimize for finishing *their* thread. Danilo Sato warns that skipping contract leaves things worse [read]. Nobody tracks the *program* [inference].
5. **The isolation of a shared-baseline sandbox leaks.** Header propagation must be done by every service; one non-forwarding hop silently routes to the baseline [read: Okteto]. Async flows drop context [read: Uber]. Databases are shared unless opted out [read: Okteto, Signadot]. On Cloudflare, Workflows, queue consumers, cron and service bindings from previews hit production [read via 23]. An agent can believe it proved something in isolation when its writes went to shared or production state [inference].
6. **Noise.** Response diffs are full of timestamps, IDs and float jitter (Speedscale's 4.20 vs 4.2000000001) [read]. Diffy needs a second control instance just to measure noise [read]. Without noise models, diff-based proof gives agents either false confidence or endless false failures [inference].
7. **Merge-time staleness of proof.** A migration rehearsed on yesterday's clone, or a Terraform plan made before another landing, can be invalid at landing time. HashiCorp says so explicitly [read]. This is the stateful analogue of "re-verify after rebase".
8. **Side effects block shadowing.** Scientist only works for reads [read]. Istio mirrors fire-and-forget [read]. Writes, emails, payments and webhooks cannot be shadowed naively.
9. **Revert windows are short and asymmetric.** PlanetScale allows 30 minutes, and instant deploys can't be reverted. Reverts fail when new data no longer fits the old schema [read]. D1 restore is in place and destructive [read]. "Reversal beats prevention" (brief idea 7) holds weakly for data.

## How organizations are solving them

- **Production-clone rehearsal as a merge gate**: GitLab plus Postgres.ai thin clones produce a bot report and a blocking commit status [read]. GitHub runs gh-ost `--test-on-replica` continuously, with checksums [read].
- **Separate schema-deploy control planes**: PlanetScale deploy requests and safe migrations, with lint, approval, a serialized queue, gated cutover and a 30-minute revert [read]. Supabase applies migrations on merge with Migrate and Seed steps [read].
- **Linting by failure class**: Atlas DS/MF/BC/PG/MY codes [read].
- **Multi-step migration discipline**: expand/contract, dual writes, Scientist verification [read: Fowler, Stripe]. pgroll serves two schema versions at once [read].
- **Masked production branches**: Neon anonymized branches, Xata built-in anonymization, Tonic Structural subsetting [read].
- **Request-level sandboxes on shared clusters**: Uber SLATE (in production, with test tenancy), Okteto Divert, Signadot, and LegalOn on Signadot [read].
- **Diff-based behavioural proof**: Diffy, Scientist, Speedscale replay, Signadot SmartTests (field diffs with learned noise and severity), Datafold data diffs [read].
- **Agent-native dependency sandboxes**: Stripe's anonymous `stripe sandbox create` for agents [read]. Neon, Xata and Signadot all expose MCP or API for agents to create environments [read].
- **Accepting that some proof only exists in production**: canaries, flags and observability [read: Majors].

## Implications for a future forge

[inference unless noted]

1. **Change classes should determine which proof is required, and the forge should classify automatically.** Lint the diff (Atlas-style codes and a path map) into classes. Policy then demands the proof suited to the class, extending the brief's per-path policy to per-*effect* policy.

| Change class | Provable in a pre-merge preview? | Proof the forge should require |
|---|---|---|
| UI / stateless handler | Yes | Pinned preview, browser run, screenshots (brief's current model) |
| API behaviour, stateless service logic | Yes, with dependencies mocked or sandboxed | **API replay diff** vs baseline (recorded traffic or a SmartTests-style capture), with noise-filtered severity |
| Additive schema (expand: new table, nullable column, concurrent index) | Mostly | Lint pass, migration applied to a **masked prod-shaped branch**, timing report, app tests against the new schema *and* the old app against the new schema |
| Data-dependent schema (unique index, NOT NULL, type change) | Only on production-shaped data | Rehearsal on a thin clone or anonymized branch of current prod, with row and lock timing (GitLab report), freshness-bounded |
| Backward-incompatible (rename, drop, contract) | **No, not as a single thread** | Proof that no deployed client uses the old shape: telemetry or query logs, plus the expand thread having landed and baked for N days. Landed as the final step of a tracked migration program |
| Backfills / data fixes | Partially | **Data diff** (rows and columns changed) on a branch. Row-count bounds. Dry-run on a clone. Idempotency check |
| Infra / IaC | Plan only | **Plan diff** (`plan -out` plus `-detailed-exitcode`) attached as evidence. Re-plan at landing; refuse if the plan changed. Policy on resource types destroyed or replaced |
| Async, queues, workflows, cron | Weakly | Isolated topic or queue (Signadot-style), or explicit "not isolated" evidence. On Cloudflare, previews can't consume queues or own Workflows, so the forge must flag these as *unproven* |
| Performance, scale, locking under load | No | Canary or progressive rollout with SLO guardrails *after* landing. Evidence continues post-merge |
| Third-party integration | With sandbox or recording | Provider sandbox per thread (Stripe), or recorded mocks with drift checks |

2. **Data branches should be part of the thread.** The thread object model in the brief (identity, intent, log, checkpoints, environment, previews, evidence) needs a **data environment** field: which DB branch, its source LSN or timestamp, the masking policy applied, and its TTL tied to the thread's lifetime. Neon's snapshot-as-checkpoint pattern suggests pairing each code checkpoint with a DB snapshot ID so that forking a thread forks its state too.
3. **Evidence must record what was isolated.** Every proof should carry an isolation manifest: which dependencies were real, shared-baseline, mocked or production. A preview that writes to a shared D1 or calls a production service binding should mark the proof as *contaminated* or *partial*. This is the honest version of "every change is bootable".
4. **Proof should be differential, not just assertive.** Agents write their own assertions, which are gameable (see file 14). Diffs against a baseline need no expectations ("Capture is built in, so there are no assertions or expected values to encode" [read: SmartTests]). The forge should store **behavioural diffs** as typed evidence: API replay diff, data diff, plan diff, schema diff, migration timing report. A human or a policy then approves *the diff of behaviour*, not the diff of code. Diffy's three-instance noise baseline is a cheap, principled way to separate signal from noise.
5. **Evidence freshness and re-proof at landing.** Stateful proofs go stale (plans, migration timing on yesterday's clone). The landing service should re-run cheap stateful proofs (re-plan, re-lint against the current schema, possibly re-rehearse a migration on a fresh branch) and refuse if the result differs from the attached evidence. This mirrors HashiCorp's "re-check the final non-speculative plan".
6. **Schema changes need their own lane in the landing service.** The single-trunk-lock design will collide with the schema-deploy queue. The forge should either own schema deploys (PlanetScale-style serialized queue with gated cutover and a revert window) or coordinate with them, since a code landing that needs a schema change must wait for the cutover. Intent declarations (brief idea 6) should include **tables touched**, so overlap on a hot table shows up early.
7. **Migration programs as a first-class object.** A parent object spanning the expand thread, backfill thread and contract thread. The contract thread is gated on evidence (no reads of the old column for N days, from query telemetry). This is where "reversal beats prevention" stops working: a contract step is effectively irreversible.
8. **Proof extends past merge.** For load, lock and scale classes, a thread's evidence should include the canary and rollout record (flags, SLO checks), and the thread stays open until baking completes. "Landed" is not "done".
9. **For the Cloudflare demo specifically**: use Durable Object SQLite state, which is isolated per Preview automatically, and seed it per preview from a fixture. Avoid D1, Queues, Workflows and service bindings in the demo app, or show the isolation manifest flagging them. Say plainly in the video that production-shaped data branching on D1 isn't possible today (no fork).

## Contradictions and pushback

- **"Every change is bootable" versus "staging is not production."** Majors argues pre-production environments catch only known unknowns [read]. For stateful and scale-dependent changes the brief's "merge on proof" overpromises. Proof has to continue post-merge.
- **Vendor framing.** Signadot, Speedscale, Tonic, Xata, Neon and DoltHub all have products to sell. The agent-share numbers (Neon 80%, Xata 50%) are unaudited, and their bases are inconsistent [read/secondary].
- **Clones versus branches.** DoltHub argues true data merge matters. Most of the industry gets by with disposable clones plus migration files as the merge artifact, and DoltHub concedes clones are "enough" for migrations and CI [read]. For a forge, the clone model plus migrations-as-code is likely sufficient. Data merge matters mainly for agent writes to *application* data, which is a different product.
- **Request-level sandboxes versus full isolation.** Shared-baseline sandboxes are cheap but leak through shared databases and async flows [read]. Full clones are faithful but expensive. At agentic scale the cheap model wins on cost, but it weakens the proof.
- **GitLab's gate has no numeric thresholds.** A human DB maintainer interprets the report, and clone access is restricted [read]. The best-known migration gate still keeps a human at the centre, which cuts against "merge on proof, not human reading" for data changes.
- **Short revert windows** (PlanetScale 30 min, irreversible instant deploys, destructive D1 restore) undercut "reversal beats prevention" for data [read].

## Open questions

- Can masked prod-shaped branches be made cheap enough (dynamic masking, which Neon has planned) for one per thread at thousands of threads?
- How should a forge detect "no client uses the old column" to unblock a contract step? Query logs, pg_stat_statements, OTel spans?
- Who owns the noise model for API replay diffs per endpoint, and can agents tune it without gaming it? (Relates to file 14.)
- Can request-level isolation be made trustworthy with an automatic check that every hop propagated the header, for example by verifying traces?
- What is the right staleness bound for migration-rehearsal evidence: commits on main since, hours, or a schema hash?
- Bytebase SQL review, Lyft Staging Overrides and Tonic Ephemeral were not verified; their pages returned 404 or 403 or lacked content.
- Will Cloudflare ship D1 fork and per-Preview Workflows? Both are listed as future work [read: D1 docs; via 23].

## Sources (opened)

| # | Title | URL | Date |
|---|---|---|---|
| 1 | Neon: Branching (docs) | https://neon.com/docs/introduction/branching | current docs, 2026 |
| 2 | Neon: Schema-only branches | https://neon.com/docs/guides/branching-schema-only | current |
| 3 | Neon: Data anonymization | https://neon.com/docs/workflows/data-anonymization | current |
| 4 | Neon: AI database versioning (snapshots) | https://neon.com/docs/ai/ai-database-versioning | current |
| 5 | Neon: AI agents use case | https://neon.com/use-cases/ai-agents | current |
| 6 | Neon: Plans | https://neon.com/docs/introduction/plans | current |
| 7 | Neon: Architecture overview | https://neon.com/docs/introduction/architecture-overview | current |
| 8 | Neon blog: Branching With or Without PII | https://neon.com/blog/branching-environments-anonymized-pii | 2025-11-11 |
| 9 | Neon: Vercel-managed integration | https://neon.com/docs/guides/vercel-managed-integration | current |
| 10 | Xata homepage | https://xata.io/ | current |
| 11 | pgroll README | https://github.com/xataio/pgroll | current |
| 12 | Postgres.ai Database Lab docs | https://postgres.ai/docs/database-lab | current |
| 13 | PlanetScale: Deploy requests | https://planetscale.com/docs/vitess/schema-changes/deploy-requests | current |
| 14 | PlanetScale: Safe migrations | https://planetscale.com/docs/vitess/schema-changes/safe-migrations | current |
| 15 | PlanetScale: Branching | https://planetscale.com/docs/vitess/schema-changes/branching | current |
| 16 | PlanetScale: Data Branching | https://planetscale.com/docs/vitess/schema-changes/data-branching | current |
| 17 | Supabase: Branching docs | https://supabase.com/docs/guides/deployment/branching | current |
| 18 | Supabase: Branching 2.0 | https://supabase.com/blog/branching-2-0 | 2025-07-16 |
| 19 | DoltHub blog index | https://www.dolthub.com/blog/ | 2026-10 |
| 20 | DoltHub: PostgreSQL Clones vs Doltgres Branches | https://www.dolthub.com/blog/2026-10-01-postgres-cheap-database-clones/ | 2026-10-01 |
| 21 | DoltHub: Cursor for Everything | https://www.dolthub.com/blog/2025-11-19-cursor-for-everything/ | 2025-11-19 |
| 22 | Cloudflare D1 Time Travel | https://developers.cloudflare.com/d1/reference/time-travel/ | current |
| 23 | Martin Fowler / Danilo Sato: Parallel Change | https://martinfowler.com/bliki/ParallelChange.html | 2014-05-13 |
| 24 | Stripe: Online migrations at scale | https://stripe.com/blog/online-migrations | 2017-02-02 |
| 25 | gh-ost README | https://github.com/github/gh-ost | current |
| 26 | Atlas lint analyzers | https://atlasgo.io/lint/analyzers | current |
| 27 | GitLab: Database migration pipeline | https://docs.gitlab.com/development/database/database_migration_pipeline/ | current |
| 28 | Tonic.ai homepage | https://www.tonic.ai/ | current |
| 29 | Vercel: Environments | https://vercel.com/docs/deployments/environments | updated 2026-09-17 |
| 30 | Render: Preview environments | https://render.com/docs/preview-environments | current |
| 31 | Okteto docs index | https://www.okteto.com/docs/ | current |
| 32 | Okteto: Using Divert | https://www.okteto.com/docs/development/using-divert/ | current |
| 33 | Signadot docs overview | https://www.signadot.com/docs/overview | current |
| 34 | Signadot blog index | https://www.signadot.com/blog | 2026 |
| 35 | Signadot: Agent loops' feedback problem | https://signadot.com/blog/agent-loops-feedback-problem/ | 2026-09-14 |
| 36 | Signadot: AI coding agents broke the PR pipeline | https://signadot.com/blog/ai-generated-code-crisis/ | 2026-05-05 (upd. 06-21) |
| 37 | Signadot: Validating AI-generated code | https://signadot.com/blog/validating-ai-generated-code/ | 2026-05-08 |
| 38 | Signadot: Smart Tests product | https://www.signadot.com/product/smart-tests | current |
| 39 | Signadot: LegalOn case study | https://signadot.com/blog/legalon-technologies-agent-ready-golden-path-on-gke/ | 2026-09-02 |
| 40 | Uber: Simplifying developer testing through SLATE | https://www.uber.com/blog/simplifying-developer-testing-through-slate/ | 2022-10-20 |
| 41 | Stripe: Sandboxes docs | https://docs.stripe.com/sandboxes | current |
| 42 | WireMock: Record and playback | https://wiremock.org/docs/record-playback/ | current |
| 43 | Speedscale homepage | https://speedscale.com/ | current |
| 44 | LocalStack AWS docs | https://docs.localstack.cloud/aws/ | current |
| 45 | Diffy (opendiffy) README | https://github.com/opendiffy/diffy | current |
| 46 | GitHub blog: Scientist | https://github.blog/developer-skills/application-development/scientist/ | 2016-02-03 (upd. 2020-12-03) |
| 47 | Istio: Mirroring | https://istio.io/latest/docs/tasks/traffic-management/mirroring/ | current |
| 48 | InfoQ: Charity Majors, Yes I Test in Production | https://www.infoq.com/presentations/testing-production-2018 | 2019-03-19 (talk 2018) |
| 49 | Datafold Data Diff | https://www.datafold.com/data-diff | current |
| 50 | Terraform plan command | https://developer.hashicorp.com/terraform/cli/commands/plan | current |

Failed or not read: Lyft eng blog (403), Bytebase SQL review (404), Signadot SmartTests docs (404), Okteto divert reference (404), Neon "how branching works" blog (404), Neon "agents are the new developers" (404), charity.wtf post (404). Workers Previews isolation details are cross-referenced from sibling file 23-cloudflare-platform-verify.md, which read those docs.

# 12 — Sandboxes, infrastructure and economics for a thread-native forge

Researcher key: `12-sandboxes-infra-economics` · Written 2026-10-12

Tags: **[read]** means I opened the primary page and the claim comes from it. **[secondary]** means it comes from coverage, a third-party comparison or a search snippet. **[inference]** means it is my own calculation or reasoning. All prices are USD list prices as fetched on 2026-10-12 unless stated otherwise.

Method note: the shared WebSearch budget for this run ran out partway through. After that I worked only from URLs I already had or could name directly. A few planned checks were dropped as a result (GitLab's Raft-based Gitaly, the Anthropic CI blog, Devin pricing); see Open questions.

---

## Summary

1. **Tokens dominate the cost of an agent-thread-hour today, by a wide margin.** A busy coding agent on a mid-tier model (Sonnet 5.5 or GPT-6.1-sol, both $2/$10 per MTok) costs about **$1.5–7.5 per hour in tokens**. Its sandbox costs **$0.06–0.32 per hour** on every provider I priced. On frontier models (Fable 5.1 or GPT-6-astra, both $10/$50) the token cost is **$7–45 per hour**. The sandbox is roughly **1–5%** of a thread's cost. [inference from read prices]
2. **CI per verified change is the second cost, and it is the one that does not get cheaper.** Hosted CI runs **$0.002–0.006 per minute for 2 vCPU** across GitHub, Blacksmith and Namespace, and full-suite runs on large repos cost dollars to tens of dollars each. GitHub cut hosted-runner prices once, by up to 39%, on 2026-01-01. Token prices at fixed capability fall **9x–900x per year (median 50x)** per Epoch AI. [read + inference]
3. **Prediction: cheaper intelligence moves the bottleneck to verification compute.** With a small model (Haiku 5.5 or GPT-6-luna at $0.10/$0.50) a busy thread-hour costs about **$0.10–0.50 in tokens**. That is already below a typical medium-repo CI bill per change (about $1–4) and about the same as the sandbox. A forge that "verifies every change" needs test-impact selection and caching as core features; they are not optional extras. [inference]
4. **The frontier price per token is not falling. The price of a fixed capability level is.** The top tier has converged on **$10/$50** (Fable 5.1, Mythos 5.1, gpt-6-astra), the mid tier on **$2/$10**, and the small tier on **$0.10/$0.50**. GPT-4 in 2023 cost $30/$60 (a $37.50 blended rate in Epoch's table). Gemini 3.8/3.6 Flash prices **roughly double on 2027-01-01**, a counter-trend. [read]
5. **Brief claims verified (Cloudflare Artifacts):** pricing is 10k operations and 1 GB-month included, then **$0.15 per 1,000 operations** and **$0.50 per GB-month** [read]. **Git notes** have native support, stated in the 2026-04-16 launch blog [read]. **ArtifactFS** is a Go FUSE daemon that does a blobless clone plus background hydration that prioritises manifests [read]. The billing date conflict is real: the docs and changelog say **Oct 14**, the competition blog says **Oct 15** [read both].
6. **New hard limits relevant to the demo:** Artifacts allows **1 GB per repo**, **32 MB per blob**, **2,000 git requests per 10 s per repo** and 1 TB per account (raisable) [read]. Workers Builds allows **6 concurrent builds** on paid plans with a **20-minute timeout** [read]. Containers allow **1,500 concurrent vCPU, 6 TiB memory and 30 TB disk per account**, and the largest instance is **4 vCPU / 12 GiB / 20 GB** [read].
7. **Sandbox cold starts are now sub-second almost everywhere.** Cloudflare's new `durable_object` scheduling policy took median start from **4.049 s to 648 ms** (p99 from 6.7 s to 1.13 s, measured by ComputeSDK at 100 concurrent), and an internal burst started **100,000 containers in 5.4 s** [read]. Vendor claims elsewhere: Daytona under 90 ms, Freestyle about 65 ms, Morph under 250 ms for snapshot, branch or restore [read, vendor claims]. Firecracker's spec is **≤125 ms boot** and **≤5 MiB VMM overhead**, and the NSDI paper says **up to 150 microVMs per second per host** [read].
8. **Fork and branch of a live machine is now a commodity primitive.** E2B `fork()` captures memory and filesystem with up to 20 forks per call. Vercel has `Sandbox.fork`. Freestyle forks a running VM without pausing it. Morph's "Infinibranch" offers unlimited parallel branches. Cloudflare added filesystem snapshot and restore on 2026-09-30 but has no fork or memory snapshot [read]. A "fork a thread with its machine" feature is buildable on all of them.
9. **Real orgs prebuild per-repo images and keep warm pools.** Ramp's Inspect rebuilds one Modal image per repo every **30 minutes**, keeps warm pools, starts warming as the user types, and writes about **30% of merged PRs** [read]. Stripe's Minions start from pre-warmed devboxes in about **10 s**, allow **at most two CI rounds** because CI "costs tokens, compute, and time", and merge **1,000+ PRs per week** [read].
10. **Git storage at agent scale is moving to storage/compute separation.** GitHub is moving authoritative data from Spokes (full replicas on **five fileservers by default**, 3-phase commit) to **Azure Blob Storage** with cache-only compute workers. It reports **up to 35x write throughput** in internal benchmarks and coordinates only on the ref update [read]. Cloudflare Artifacts stores each repo as a Durable Object holding objects in SQLite, served by a roughly **100 KB Zig/Wasm git server** [read].
11. **Git client-side machinery for cheap hydration already exists:** partial clone (blobless or treeless), sparse checkout, scalar, bundle-uri (CDN-served bundles with `creationToken` incremental fetch) and reftable. reftable's bulk ref writes are "multiple orders of magnitude" faster, and it becomes the **default in Git 3.0**, which has **no release date** [read]. The weak spot is partial clone's on-demand fetch, which runs **one object per fetch-pack** [read].
12. **Session runtime from model vendors is cheap and bundled.** Anthropic Managed Agents charges **$0.08 per session-hour** for runtime, billed only while running; code execution containers cost **$0.05 per container-hour** after 1,550 free hours [read]. That sets the floor sandbox vendors compete against.
13. **Published per-agent token numbers disagree by 100x.** Anthropic's Managed Agents worked example assumes **50k input and 15k output tokens per session-hour** ($0.53–0.71 with Opus 5). A Claude Code `/usage` example in Anthropic's docs implies about **8.9M cache-read tokens per API-hour** (about $5.2 per API-hour at Sonnet 4.6 prices). Claude Code's enterprise average is **about $13 per developer per active day**. Agent teams use **about 7x** the tokens of a single session, and multi-agent research setups about **15x** the tokens of a chat [read]. Any cost model is very sensitive to this assumption.

---

## Detailed findings

### A. Cloudflare: Artifacts, ArtifactFS, Containers and Sandboxes

**Artifacts architecture** (launch blog, 2026-04-16) [read]
- Each repo is a **Durable Object**. Objects live in the DO's SQLite through the sync KV API. R2 holds snapshots and KV holds auth tokens. A front Worker handles auth and metrics and routes to the repo's DO.
- The git server is written from scratch in **Zig**, compiled to a **roughly 100 KB Wasm** binary with no libc. It implements SHA-1, zlib, delta encoding, pack parsing and smart HTTP. Its host interface has 11 storage functions plus `host_emit_bytes`.
- DO constraints shape the design: a **2 MB maximum row** (large objects are chunked) and **about 128 MB of memory** (fetch and push stream). Artifacts does not compute its own deltas; it stores the deltas clients send and reuses them.
- Supports protocol v1 and v2, `ls-refs`, shallow clone (`deepen*`) and have/want negotiation.
- "Native support for `git-notes`", described as a way to attach prompts and attribution to objects without changing them. **Confirms the brief's unverified claim.** It is still unclear whether the Workers binding exposes notes directly, or whether notes must be pushed by a git client as `refs/notes/*`. The docs pages I read do not mention notes.
- Cloudflare dogfoods it: "each internal agent session gets its own Artifacts repo" to persist sandbox filesystem state and session history, which allows time travel and forking a session from any point. This is close to the brief's "thread = repo" model.
- Source: https://blog.cloudflare.com/artifacts-git-for-agents-beta/

**Artifacts pricing and billing date** [read]
- Paid plan only: the first 10,000 operations per month are included, then $0.15 per 1,000. The first 1 GB-month is included, then $0.50 per GB-month. Storage is measured as the average of daily peaks over 30 days, replicas are not charged, and operations named include `create`, `push`, `pull` and `clone`. The launch blog also lists forks. Source: https://developers.cloudflare.com/artifacts/platform/pricing/
- Billing start: the pricing doc and the 2026-10-01 changelog entry say **October 14, 2026**. The competition post says "**October 15, 2026**". Sources: https://developers.cloudflare.com/changelog/product/artifacts/ and https://blog.cloudflare.com/next-git-platform-on-cloudflare/
- Changelog timeline [read]: 2026-04-16 private beta; 2026-05-18 Wrangler commands; 2026-05-19 event subscriptions (`repo.created/deleted/forked/imported`, `pushed/cloned/fetched`); 2026-06-17 dashboard and repo-scoped read/write tokens; 2026-08-04 CI/CD on push via a "CI SDK" workflow with lockfile-keyed dependency cache; 2026-08-13 EU/US jurisdictions; 2026-10-01 open beta.

**Artifacts limits** [read], from https://developers.cloudflare.com/artifacts/platform/limits/
- 1 GB maximum per repository. 32 MB maximum per file or blob. Unlimited repos. 1 TB per account (raisable).
- Control plane: 2,000 requests per 10 s per namespace. Git: **2,000 requests per 10 s per artifact (repo)**.
- Forge implication [inference]: one hot repo tops out around **200 git requests per second**, and CI read fan-out and agent pushes share that budget. A single trunk repo with thousands of agents will hit it. That argues for the repo-per-thread (fork) pattern Cloudflare uses internally, landing back into the trunk through a single service-owned writer, and for serving CI reads from bundles or snapshots instead of fresh clones.

**ArtifactFS** [read]
- A Go FUSE daemon (fuse3 on Linux, macFUSE on macOS), Apache-2.0, labelled "beta… your mileage may vary". It does a **blobless clone**, indexes the tree, and hydrates blobs in the background with 4 workers by default, each a persistent `git cat-file --batch`. It prioritises manifests (`package.json`, `go.mod`) and source over binaries. A read of an unhydrated file blocks only until that blob arrives. Writes go to a copy-on-write overlay with whiteouts. Nothing syncs back automatically; agents commit and push.
- Numbers: the blog cites a 2.4 GB framework repo that takes about 2 minutes to clone, against a goal of 10–15 s to start working. It estimates **2,778 sandbox-hours saved per month at 10k jobs** (90–100 s each). In the README's sample log, workers-sdk prepared in 4.2 s. Known slow spots: **`git status` about 7 s on a 5,800-entry repo** and `git reset` about 6.5 s, both from full tree walks through FUSE. Submodules are not initialised.
- Forge implication [inference]: lazy hydration fixes time-to-first-edit but makes `git status` and diff slow, and agents call those constantly. A forge-owned workspace should keep an index or fsmonitor-style change journal, as Scalar, Sapling/Watchman and CitC all do, instead of walking FUSE.
- Sources: https://github.com/cloudflare/artifact-fs and the launch blog.

**Containers and Sandbox pricing** [read], from https://developers.cloudflare.com/containers/pricing/
- Memory **$0.0000025 per GiB-s** ($0.009 per GiB-hr). CPU **$0.000020 per vCPU-s** ($0.072 per vCPU-hr), **billed on active usage only**. Disk $0.00000007 per GB-s. Workers Paid includes 25 GiB-h of memory, 375 vCPU-min and 200 GB-h of disk.
- Instance types: lite (1/16 vCPU, 256 MiB, 2 GB), basic (1/4, 1 GiB, 4 GB), standard-1 (1/2, 4 GiB, 8 GB), standard-2 (1, 6 GiB, 12 GB), standard-3 (2, 8 GiB, 16 GB), standard-4 (4, 12 GiB, 20 GB). Egress is $0.025 per GB in NA/EU after 1 TB.
- The Sandbox SDK bills at Containers rates plus DO, Workers and logs (https://developers.cloudflare.com/sandbox/platform/limits/). Subrequests: 1,000 per request on Paid, and the RPC transport counts the whole persistent connection as one.
- Account limits: **1,500 concurrent vCPU, 6 TiB memory, 30 TB disk**, 50 GB total image storage (https://developers.cloudflare.com/containers/platform-details/limits/). Forge implication [inference]: 1,500 standard-2 sandboxes or 750 standard-3 per account without a limit increase. "Thousands of agents" needs a raised limit.

**Faster sandboxes and snapshots, 2026-09-30** [read]
- The `durable_object` scheduling policy (public beta) restores "a prepared, unassigned VM" instead of booting one. ComputeSDK Burst TTI at 100 concurrent: **median 4.049 s → 648 ms, p95 5.839 s → 910 ms, p99 6.717 s → 1,129 ms**. An internal burst started **100,000 containers in 5.387 s across six locations**. Customer quotes from Base44 and Kilo Code. The legacy `Container` and `Sandbox` classes are maintained until **2026-12-31**. Source: https://blog.cloudflare.com/faster-agent-sandboxes/
- Filesystem snapshots (public beta): `ctx.container.snapshotContainer()` returns a handle, and `start({containerSnapshot})` restores from it. Snapshots are `durable_object` policy only and immutable. Source: https://developers.cloudflare.com/changelog/post/2026-09-30-snapshots/. Retention of **30 days** and a **20 GB** cap appear only in a search snippet [secondary]. There is **no memory snapshot and no fork** [read: the API shape; secondary: Upstash calls Cloudflare "no fork"].

**Previews, proof and the thread object on Cloudflare** [read]
- Workers Builds: 6,000 build-minutes per month included on Paid, then **$0.005 per minute**. **6 concurrent builds**, a **20-minute timeout**, 4 vCPU / 8 GB / 20 GB. Source: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- Browser Run (Browser Rendering): 10 browser-hours per month included, then **$0.09 per hour**. 10 concurrent browsers included, then **$2 per extra browser** (monthly average). Source: https://developers.cloudflare.com/browser-rendering/pricing/
- Durable Objects: $0.15 per million requests, $12.50 per million GB-s (on 128 MB), SQLite rows read $0.001 per million, rows written $1 per million, storage $0.20 per GB-month. Source: https://developers.cloudflare.com/durable-objects/platform/pricing/
- Forge implication [inference]: **6 concurrent builds is the bottleneck for "every change bootable" on one account**. At about 2 minutes per build that is about **180 previews per hour**. A demo with a dozen concurrent agents is fine; thousands are not. Proof runs cost almost nothing in dollars: a 3-minute Browser Run session is about $0.005.

### B. Other sandbox providers: pricing, isolation, start and fork

| Provider | Isolation | Start / snapshot claim | Fork / branch | List price | $/h, 2 vCPU / 4 GiB at 10% CPU [inference] |
|---|---|---|---|---|---|
| Cloudflare Containers | VM per container [read: "VM"] | 648 ms median (new policy) [read] | No; FS snapshots only [read] | $0.072/vCPU-h active; $0.009/GiB-h | $0.09 (standard-3, 8 GiB) |
| E2B | Firecracker [secondary] | ~150 ms [secondary] | `fork()` memory+FS, ≤20/call; one snapshot serves all forks; source pauses ∝ disk changes [read] | $0.000014/vCPU-s, $0.0000045/GiB-s; Pro $150/mo, 100 concurrent (up to 1,100 with add-ons); 24 h session cap [read] | $0.166 |
| Daytona | Container default; VM class [secondary] | "Sub 90ms" [read, vendor] | Experimental VM fork [secondary] | $0.0504/vCPU-h, $0.0162/GiB-h; storage 5 GiB free [read] | $0.166 |
| Modal Sandboxes | gVisor [secondary] | "sub-second" [secondary] | FS/dir snapshots (30 d TTL); memory snapshots experimental (7 d TTL, snapshot terminates sandbox, same instance type) [read] | $0.00003942/physical-core-s (=2 vCPU), $0.00000667/GiB-s, about **3x Modal Functions rates** [read] | $0.238 |
| Vercel Sandbox | Firecracker [secondary; Vercel KB link text says Firecracker] | "milliseconds" [secondary] | `Sandbox.fork`; auto-snapshot on stop; 30 d after last use [read] | Active CPU $0.128/h; memory $0.0212/GB-h; $0.60/M creations; snapshots $0.08/GB-mo; 10,000 concurrent on Pro; vCPU allocation ramps 150→5,000/min [read] | $0.110 |
| Fly Machines | Firecracker | — | — | perf-2x 4 GB $0.0917/h; stopped rootfs $0.15/GB-mo [read] | $0.092 |
| Fly Sprites | Firecracker [secondary] | Checkpoint "about a second", non-blocking; warm wake 100–500 ms [secondary] | No fork [secondary] | $0.0385/CPU-h actual; $0.021875/GB-h memory; cold storage ~$0.02/GB-mo; 10 creates/min on PAYG [read] | $0.095 |
| Freestyle | KVM VM, nested virt, up to 32 vCPU / 64 GB [read] | ~65 ms provision; <100 ms wake with memory [read, vendor] | Fork a running VM without pausing [read] | No price on product page; $0.04032/vCPU-h, $0.0129/GiB-h per Upstash [secondary] | $0.132 |
| Morph Cloud | VM | "snapshot, branch, and restore… in under 250ms"; "unlimited parallel branches" [read, vendor] | Infinibranch [read] | MCU-based; $0.05/MCU ≈ 1 vCPU-h + 4 GB-h + 16 GB disk-h [secondary snippet; plans page didn't list rates] | ~$0.10 [secondary] |
| Runloop | VM, custom hypervisor [secondary] | "a few seconds" [secondary] | Disk snapshots, fan-out [secondary] | $0.108/CPU-h, $0.0252/GB-h; suspend needs Pro ($250/mo) [read] | $0.317 |
| Depot agent sandboxes | — | — | — | **$0.01/min** ($0.60/h) [read] | $0.60 |
| Namespace Devboxes | — | 15 min idle auto-stop [read] | — | $0.004 per devbox-minute × size (S=1…XL=8) → S $0.24/h [read] | $0.24 (S) |
| Anthropic Managed Agents | Anthropic-hosted container | — | — | **$0.08/session-hour while running**; code execution $0.05/container-h [read] | $0.08 |
| AWS m7i.large (baseline) | — | — | — | $0.1008/h on-demand, ~$0.042 spot (2 vCPU / 8 GiB) [secondary: Vantage] | $0.101 |

- The Upstash comparison (2026-09-17) states that its cold-start figures "are not directly comparable" because they mix create-to-first-command, resume-from-standby and agent-connect times. It lists Cloudflare at **1–3 s**, which **predates or ignores** the 2026-09-30 change to about 650 ms [read + inference]. Upstash sells a competing product (Box). Source: https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026
- Discrepancy: Upstash lists Fly Sprites memory at $0.04375 per GiB-h. Fly's own page says **$0.021875 per GB-h** [read both]. I used Fly's figure.
- Firecracker primary numbers: **≤125 ms** from InstanceStart to guest `/sbin/init` and **≤5 MiB** VMM overhead (1 vCPU, 128 MiB) per the spec. The NSDI'20 paper adds "**up to 150 MicroVMs per second per host**" and "hundreds or thousands of MicroVMs" per Lambda worker [read]. Sources: https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md and https://www.usenix.org/system/files/nsdi20-paper-agache.pdf
- gVisor's own guide: overhead is structural for syscall-heavy and VFS-heavy work, with "several internal serialization points" in the VFS and a less CPU-efficient network stack, while CPU-bound code runs natively [read]. Compile and test workloads, which do many small file operations and spawn processes, are therefore the worst case [inference]. That matters for verification-heavy threads on gVisor providers such as Modal. Source: https://gvisor.dev/docs/architecture_guide/performance/

### C. What orgs actually built

- **Ramp Inspect** [read]: Modal sandboxes. One image per repo, rebuilt **every 30 minutes**, with the app and test suite run once at build time to warm caches. Warm pools per high-volume repo are expired when a new image lands. Ramp warms a sandbox as soon as the user starts typing, lets the agent read before git sync finishes, and blocks edits until it does. It snapshots at the end of a session and restores on follow-up. The backend is Cloudflare Durable Objects with **one SQLite database per session** plus the Agents SDK. PRs are opened with the user's token. About **30% of merged PRs** in its frontend and backend repos come from Inspect. Ramp calls sessions "effectively free to run" without giving figures. Source: https://builders.ramp.com/post/why-we-built-our-background-agent
- **Stripe Minions** [read]: pre-warmed devboxes "spun up in 10 seconds" with code and services preloaded, isolated from production and the internet. Local lints run in under 5 s on push. CI "selectively runs tests" from **more than 3 million**, with **at most two CI rounds**. More than **1,000 merged PRs per week** are entirely minion-written. A Toolshed MCP server offers more than 400 tools. Stripe says git worktrees "wouldn't scale at Stripe". Source: https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents
- **GitHub Copilot cloud agent** [read]: runs in an ephemeral cloud environment configured by `copilot-setup-steps.yml`, with a **59-minute hard cap per session**, one repo and one PR per task. The docs page did not state billing. Source: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent

### D. Git storage at scale

- **GitHub** (Brian Celenza, 2026-10-06, updated 10-07) [read]. Spokes today serves about **1 billion repositories**, each on **five fileservers by default**, with 3-phase-commit quorum ref updates, so "a push is only as fast as the slowest replica". Pressure points it names: per-agent commit latency ("An agent in a tight loop commits or checkpoints after nearly every action"), write convergence, **single-ref contention** from trunk, release trains and merge queues, **read fan-out** (CI and scanning fetch the same tip "thousands of times per minute"), and maintenance cost. The new design keeps authoritative data in **Azure Blob Storage**, caches in compute workers, coordinates only on the ref update while object storage, connectivity checks and secret scanning run in parallel, runs GC and compaction off the serving path, and scales capacity elastically. It reports **up to 35x write throughput** internally. Volume figures: 7.38 B commits in September 2026 (more than 5x year over year); pushes 0.69 B → 3.35 B per month; 473.3 B git events per month; Actions runs **3.26 B** in September (more than 4x); the busiest repo saw about 1 B requests in August. GitHub will keep branch protections and required reviews. Source: https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/
- **Spokes/DGit, 2017** [read]: replication inside git, not at the block level. A cross-country ref update needs four round trips, about **one-third of a second**. A push to master can trigger more than 100 bookkeeping updates, about 30 s of busy repo, so they are coalesced. Replica consistency uses an XOR-of-hashes checksum over refs. Reads outnumber writes about 100:1. Source: https://github.blog/engineering/infrastructure/stretching-spokes/
- **GitLab Gitaly Cluster (Praefect)** [read]: a Praefect router and transaction manager plus PostgreSQL metadata, with replication factor 3 in the example and strong consistency (synchronous to healthy replicas) with eventual-consistency fallback. RPO under 1 min, RTO under 10 s. Local SSD only, no NFS. GitLab.com reference load: 500–1,000 reads/s (peaks about 3,500), about 500 writes/s (peaks over 3,000), about 8,000 raw write IOPS peak. It runs on `t2d-standard-32` with pd-ssd. Sources: https://docs.gitlab.com/administration/gitaly/praefect/ and https://docs.gitlab.com/administration/gitaly/. I could **not** verify the status of a Raft-based Gitaly replacement (search budget exhausted).
- **Google Piper** (2016 figures, via Wikipedia citing CACM) [secondary; CACM returned 403]: **86 TB**, about 2 B lines, about 9 M files, 25k developers, **16k human changes per day plus 24k automated commits per day**. CitC is a cloud backend plus FUSE overlay, with local workspaces averaging under 10 files and a snapshot per write. Storage moved from Bigtable to Spanner across 10 datacentres. Search snippets add about 800k QPS peak reads [secondary]. Source: https://en.wikipedia.org/wiki/Piper_(source_control_system)
- **Meta Sapling/Mononoke** (2022) [read]: "tens of millions of files, tens of millions of commits, and tens of millions of branches". Lazy history: the clone downloads almost no history. A segmented changelog of a few MB handles graph queries in O(number of merges). A virtual filesystem (EdenFS, not then public) hydrates on first access. Watchman makes `status` avoid full scans. Source: https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/
- **Microsoft Scalar/VFS for Git** (2020) [read]: the Windows repo has more than 3 M index entries, more than 100 GB of compressed history and about 90 M objects; a GVFS initial clone is about 15 GB. `git status` drops from 12.2 s to 1.5 s with fsmonitor. Source: https://devblogs.microsoft.com/devops/introducing-scalar/. Scalar today configures blobless clone, sparse checkout, background maintenance (prefetch, commit-graph with Bloom filters, multi-pack-index), index v4, `pack.usePathWalk` and disabled ahead/behind (https://git-scm.com/docs/scalar) [read].
- **Partial clone** [read]: promisor packfiles and filter specs. The documented weakness is that dynamic fetch "runs fetch-pack once per missing object", with possible repeated auth and full ref advertisement on protocol v0. Checkout batch-prefetches. Server-side "guessing" of related objects is explicitly not planned. Source: https://git-scm.com/docs/partial-clone. GitHub's guidance: blobless for developers on big repos, shallow for throwaway CI, treeless if CI needs history, and avoid shallow fetches, which can be more expensive than full ones. Source: https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/
- **bundle-uri** [read]: clients pre-seed from static HTTP(S) bundles (CDN-friendly) using a bundle list in config format. `mode=all|any` supports geo mirrors. The `creationToken` heuristic enables incremental fetch: daily bundles, rolled up past about 30. `filter=blob:none` bundles can sit alongside full ones. Advertisement via a protocol v2 `bundle-uri` command. The origin stays the source of truth and any bundle failure is ignored. Source: https://git-scm.com/docs/bundle-uri
- **reftable** [read]: becomes the default ref backend in Git 3.0, alongside SHA-256 by default and Rust being mandatory. It brings atomic multi-ref writes, geometric compaction after each write, tombstones instead of rewriting a packed-refs file that can be "dozens of megabytes… in extreme cases… gigabytes", and "multiple orders of magnitude" faster bulk ref writes. "There is no planned release date" for 3.0. The prerequisite is JGit, libgit2 and Gitoxide support. Source: https://git-scm.com/docs/BreakingChanges. The "22x fetch / 18x push at 10k refs" figure is [secondary, unverified].

### E. CI compute pricing in 2026

- **GitHub-hosted runners** (per minute) [read]: Linux 2-core $0.006, 4-core $0.012, 8-core $0.022, 16-core $0.042, 32-core $0.082, 64-core $0.162. arm64 runs about 40% cheaper (2-core $0.005, 64-core $0.098). Windows 2-core $0.010. macOS $0.062. GPU Linux 4-core $0.052. Source: https://docs.github.com/en/billing/reference/actions-runner-pricing
- **GitHub 2026 changes** [read]: hosted-runner prices fell by "up to 39%" from **2026-01-01**. A **$0.002/min self-hosted platform fee** proposed for 2026-03-01 was **postponed** in a 2025-12-15 update ("re-evaluate our approach"; GitHub "missed the mark"). Source: https://github.com/resources/insights/2026-pricing-changes-for-github-actions
- **Blacksmith** [read]: Ubuntu x64 $0.004/min, ARM $0.0025, Windows $0.008, macOS M4 $0.08. 3,000 free minutes per month. It claims 2x faster. Docker layer cache and sticky disks $0.50/GB-mo. Source: https://www.blacksmith.sh/pricing
- **Namespace** [read]: $0.001 per unit-minute prepaid ($0.0015 overage), where 1 unit = 1 vCPU / 2 GB. Linux 2 vCPU $0.002/min, 64 vCPU $0.16/min. Cache volumes $0.002/GB-h for snapshots. Bazel cache hits $0.10 per 1,000. Team plan $100/mo with 100k unit-minutes. Source: https://namespace.so/pricing
- **Depot** [read]: Developer plan $20/mo, Startup $200/mo. Overage: Docker builds $0.04/min, GH Actions jobs $0.006/min, Depot CI **$0.00005/vCPU-s** ($0.18/vCPU-h), agent sandboxes $0.01/min, cache $0.20/GB-mo, and **$0.000001 per passing test result** (failures free). Source: https://depot.dev/pricing. Depot now sells CI compute, sandboxes and test analytics as one product [inference].
- **BuildBuddy** [read]: Personal plan free with 100 GB cache transfer and up to 80 Linux cores for remote execution. Team plan is pay-as-you-go up to 800 cores, but the per-GB rate is shown as a placeholder. Enterprise is custom. No per-CPU-minute price is published. Source: https://www.buildbuddy.io/pricing
- Normalised [inference]: hosted CI costs **$0.06–0.18 per vCPU-hour** (Namespace prepaid $0.06; Blacksmith about $0.12; GitHub about $0.15–0.18 at 2-core and about $0.15 at 64-core; Depot CI $0.18). That is roughly **1.5–4x AWS on-demand** ($0.05/vCPU-h for m7i.large) and much more than spot.

### F. LLM token prices, 2023–2026

- **Epoch AI**, "LLM inference prices have fallen rapidly but unequally across tasks" (2025-03-12) [read]. At fixed benchmark performance, prices fall **9x–900x per year, median 50x**. Excluding pre-2024 data, the median is **200x per year**. GPT-4-level on GPQA Diamond fell **40x per year**. Prices are a 3:1 input:output blend; reasoning models are excluded; benchmark overfitting is a caveat; Epoch "didn't find clear evidence" of margin compression driving the declines. Example rows: GPT-4-0314 at **$37.50** blended (2023-03); Claude 3 Opus **$30**; GPT-4o **$7.50 → $4.38**; Claude 3.5 Sonnet **$6.00**; Gemini 2.0 Flash **$0.18** (2025-02) at better-than-GPT-4 MMLU. Source: https://epoch.ai/data-insights/llm-inference-price-trends
- **a16z "LLMflation"** (Nov 2024) [read]: "the cost is decreasing by 10x every year" at constant capability. GPT-3 at MMLU 42 cost $60/M in Nov 2021; Llama 3.2 3B cost $0.06/M in Nov 2024 (1,000x in 3 years). The MMLU-83 tier fell about 62x since GPT-4. Source: https://a16z.com/llmflation-llm-inference-cost/
- **Current list prices** (fetched 2026-10-12) [read]:
  - Anthropic (https://platform.claude.com/docs/en/about-claude/pricing): Fable 5.1 / Mythos 5.1 $10 / $50, cache read $0.25. Opus 5.5 **$4 / $20**, cache read $0.20. Opus 5 / 4.8 / 4.7 / 4.6 / 4.5 $5 / $25. Opus 4 and 4.1 were $15 / $75. Sonnet 5.5 and Sonnet 5 $2 / $10 (Sonnet 5.5 cache read **$0.10**; Sonnet 5's planned rise to $3/$15 on 2026-09-01 was cancelled). Sonnet 4.x $3 / $15. Haiku 5.5 **$0.10 / $0.50** under 100k-token prompts ($0.50 / $2.50 above). Haiku 4.5 $1 / $5. Batch is 50% off. The tokenizer since 4.7 produces "approximately 30% more tokens for the same text". Managed Agents runtime $0.08 per session-hour.
  - OpenAI (https://developers.openai.com/api/docs/pricing): gpt-6-astra $10 / $50 (cached $1). gpt-6.1-sol $2 / $10 (cached $0.10). gpt-5.6-sol $4 / $20. gpt-5.5 $5 / $30. gpt-5 $1.25 / $10. gpt-6-luna **$0.10 / $0.50**. gpt-5-nano $0.05 / $0.40. Pro tier: gpt-5.5-pro $30 / $180; o1-pro was $150 / $600. gpt-5.3-codex $1.75 / $14.
  - Google (https://ai.google.dev/gemini-api/docs/pricing): Gemini 3.1 Pro Preview $2 / $12 (≤200k). Gemini 3.8 Flash $0.75 / $3.75, **rising to $1.50 / $7.50 on 2027-01-01**. Gemini 3.1 Flash-Lite $0.25 / $1.50. Gemini 2.5 Flash-Lite $0.10 / $0.40.
- **Reading of the trend** [inference]: per-token prices have settled into three bands with matching numbers across Anthropic and OpenAI (top $10/$50, mid $2/$10, small $0.10/$0.50). The top band is **flat or rising** compared with 2025 (gpt-5 output was $10; gpt-6-astra output is $50). The Opus line fell about 3.75x from $15/$75 to $4/$20 in about 2.5 years. Every price drop has been paid back by agents consuming more tokens: always-on thinking, a 30% tokenizer inflation, 7x for agent teams and 15x for multi-agent systems.
- **Token consumption** [read]. Claude Code docs: enterprise average **about $13 per developer per active day**, $150–250 per developer per month, 90% of users under $30 per active day. Agent teams use **about 7x** the tokens in plan mode. Recommended limits run from 200–300k TPM per user for 1–5 users down to 10–15k TPM for 500+. A `/usage` example shows 940k cache-read, 50k cache-write and 5.3k output tokens costing $0.55 over 6m20s of API time. Source: https://code.claude.com/docs/en/costs. Anthropic multi-agent research post: agents use "about 4×" the tokens of chat and multi-agent setups about **15×**, and token usage explains **80%** of BrowseComp performance variance. Source: https://www.anthropic.com/engineering/multi-agent-research-system

---

## Cost model: cost per agent-thread-hour

All of this section is **[inference]**, built from the [read] prices above. The calculations are in `scratchpad/costmodel.py`.

**Definition.** One agent-thread-hour is one hour in which a thread's agent is actively looping. The thread has its own sandbox. It produces roughly one candidate change per hour and verifies it with CI and a preview-plus-proof step. Idle, sleeping threads are costed separately below.

**Token assumptions.** Each scenario is per busy hour. "Writes" means uncached input plus 5-minute cache writes, priced at the cache-write rate.

| Scenario | Cache-read tok/h | Writes tok/h | Output tok/h | Anchor |
|---|---|---|---|---|
| Light | 5 M | 0.25 M | 50 k | Near the Claude Code `/usage` example scaled to 1 API-hour (8.9 M read, 0.47 M write, 50 k out) |
| Typical | 10 M | 0.4 M | 150 k | Always-on thinking adds output |
| Heavy | 20 M | 1 M | 300 k | Big contexts, subagents, frequent compaction |

(The Managed Agents worked example of 50k in and 15k out per hour is about 100x below "light". I treat it as illustrative, not representative.)

**Token cost per busy hour:**

| Model (input / output $ per MTok) | Light | Typical | Heavy |
|---|---|---|---|
| Fable 5.1 ($10 / $50) | $6.9 | $15.0 | $32.5 |
| gpt-6-astra ($10 / $50) | $10.0 | $21.5 | $45.0 |
| Opus 5.5 ($4 / $20) | $3.3 | $7.0 | $15.0 |
| Sonnet 5.5 ($2 / $10) | $1.6 | $3.5 | $7.5 |
| gpt-6.1-sol ($2 / $10) | $1.5 | $3.3 | $7.0 |
| Haiku 5.5 ($0.10 / $0.50) | $0.11 | $0.23 | $0.47* |
| gpt-6-luna ($0.10 / $0.50) | $0.10 | $0.21 | $0.45 |

\*Haiku 5.5 prompts over 100k tokens are priced 5x higher, so heavy long-context runs could cost about $1–2.

**Sandbox per wall-clock hour** (2 vCPU / 4 GiB, 10–30% CPU utilisation because the agent mostly waits on the model): Cloudflare $0.06–0.12, Fly $0.09–0.11, Vercel $0.11–0.16, Freestyle about $0.13, E2B and Daytona $0.17, Modal $0.24, Runloop $0.32, Depot $0.60, Anthropic Managed Agents runtime $0.08, AWS on-demand $0.10. Use **$0.15** as the central value.

**Verification per change** (CI rounds, preview build and proof):
- Small repo: 2 rounds × 10 min × 4 vCPU ≈ $0.08 (Namespace) to $0.24 (GitHub).
- Medium repo: 3 rounds × 20 min × 8 vCPU ≈ $0.48 (Namespace) to $1.32 (GitHub). Use **$1.30** as central.
- Large monorepo, full suite: about 100–500 core-hours per round ≈ **$6–75 per round** at $0.06–0.15 per core-hour. This is why Stripe caps CI at 2 rounds and selects tests from more than 3 M.
- Preview build (Workers Builds, 2 min) about $0.01. Browser proof (3 min) about $0.005. Artifacts operations: even 200 pushes per thread at $0.15 per 1k is about $0.03. Storage for a 200 MB thread repo kept a month is about $0.10. **The git layer costs almost nothing.**

**Composite per busy thread-hour** (typical tokens, medium-repo verification):

| Model tier | Tokens | Sandbox | CI + preview + proof | Git | Total | Biggest share |
|---|---|---|---|---|---|---|
| Frontier (Fable 5.1) | $15.00 | $0.15 | $1.35 | $0.05 | **≈ $16.6** | Tokens 90% |
| Opus 5.5 | $7.00 | $0.15 | $1.35 | $0.05 | **≈ $8.6** | Tokens 82% |
| Mid (Sonnet 5.5 / gpt-6.1-sol) | $3.50 | $0.15 | $1.35 | $0.05 | **≈ $5.1** | Tokens 69%, CI 27% |
| Small (Haiku 5.5 / gpt-6-luna) | $0.23 | $0.15 | $1.35 | $0.05 | **≈ $1.8** | **CI 76%**, tokens 13%, sandbox 8% |
| Small, monorepo full-suite CI (2 × $20) | $0.23 | $0.15 | $40 | $0.05 | **≈ $40** | **CI 99%** |

**Projection.**
- If capability at a fixed level keeps getting cheaper at a16z's 10x per year, today's mid-tier capability reaches the small-tier price in about 1.3 years. At Epoch's median of 50x per year it takes under a year. Sandbox prices are close to raw cloud CPU and memory prices and fall slowly; I have no source on the rate, and GitHub's one-off 39% cut is the only data point here. CI runs per change are fixed by the test suite.
- **So for a fixed task, verification compute becomes the largest cost within about 1–2 years, and the sandbox becomes comparable to tokens.** For frontier-model work at today's flat $10/$50 band, tokens stay dominant. Organisations will likely split the two: frontier models for planning and review, cheap models for most thread-hours.
- **Volume grows as cost falls.** GitHub's data already shows commits up more than 5x and Actions runs up more than 4x year over year. Cheaper tokens produce more candidate changes, and each candidate pulls a fixed CI cost. Total CI spend grows with the number of changes, not with the token bill.

**Idle and parked threads.** 10,000 parked threads with 5 GB snapshots each is 50 TB. That costs about $1,000/month at Fly cold storage ($0.02/GB-mo), $4,000/month at Vercel snapshot pricing ($0.08), and $25,000/month at Artifacts pricing ($0.50/GB-mo) if kept as repo data. Choose the storage tier on purpose: snapshots in object storage, and only code in git.

**Organisation scale.** 1,000 concurrent agents running 24/7 is 720k thread-hours per month. At the mid tier that is about **$3.7M per month**, of which sandboxes are about $110k and CI about $970k. At that scale, sandbox cost per thread matters much less than **sandbox concurrency limits**: Cloudflare 1,500 vCPU per account, E2B Pro 100–1,100, Vercel 10,000, Modal Team 5,000 containers.

---

## Pain points for agentic-scale dev

1. **Single-repo request ceilings.** Artifacts allows 2,000 git requests per 10 s per repo [read]. GitHub names single-ref contention and CI read fan-out "thousands of times per minute" as structural problems [read]. A thread-native forge with one trunk repo concentrates exactly this load.
2. **Commit-per-action write amplification.** Agents "commit or checkpoint after nearly every action" [read]. With 3-phase commit across 5 replicas each push is slow; with per-op billing each push is a charge (cheap: $0.15 per 1k).
3. **Clone and hydration latency eats sandbox time.** Cloudflare cites about 2 minutes to clone a 2.4 GB repo and 2,778 sandbox-hours saved per 10k jobs [read]. Ramp rebuilds images every 30 minutes and Stripe pre-warms devboxes for the same reason [read].
4. **Lazy filesystems make `git status` slow.** ArtifactFS takes about 7 s for status on a 5,800-file repo [read], and partial clone fetches one object at a time [read]. Agents run status and diff constantly.
5. **The CI cost per change is fixed while token cost falls.** Stripe stops at two CI rounds because CI "costs tokens, compute, and time" [read].
6. **Concurrency caps, not prices, limit scale.** Cloudflare caps accounts at 1,500 vCPU and Workers Builds at 6 concurrent builds; previews are capped at 500 per Worker (per the brief); Browser Run includes 10 browsers; E2B tops out at 1,100 concurrent sandboxes [read].
7. **Fork semantics differ across providers.** E2B pauses the source in proportion to disk changes and drops connections [read]. Modal's memory snapshot terminates the sandbox and must restore on the same instance type [read]. Cloudflare has no fork [read]. Vercel snapshots stop the sandbox [read].
8. **Snapshot retention is short by default:** 30 days (Vercel, Modal FS, and Cloudflare per a snippet) or 7 days (Modal memory snapshots) [read/secondary]. A thread that sleeps for weeks loses its machine unless the forge re-materialises it from git plus a setup script.
9. **gVisor overhead hits verification workloads.** Syscall- and VFS-heavy builds are gVisor's worst case [read + inference].
10. **The token bill is unpredictable.** Published per-hour usage varies by about 100x [read], and agent teams use 7x and multi-agent 15x the tokens [read].

## How orgs are solving them

- **Prebuilt per-repo images, rebuilt often, plus warm pools.** Ramp rebuilds every 30 minutes and expires pools on new images. Stripe uses about 10 s pre-warmed devboxes. Amp snapshots its setup and reuses it for 24 hours (per the brief). [read]
- **Restore instead of boot.** Cloudflare's `durable_object` policy restores a prepared VM (650 ms median) [read]. Freestyle and Morph restore memory snapshots in under 100–250 ms (vendor claims) [read].
- **Lazy hydration with priority ordering.** ArtifactFS fetches manifests first; Sapling and EdenFS, CitC and VFS for Git do the same [read]. Ramp lets the agent read while sync runs and blocks writes until it finishes [read].
- **Splitting storage from compute.** GitHub is moving to Azure Blob with cache workers and off-path GC [read]. Artifacts runs a DO per repo with R2 snapshots [read].
- **A repo per agent session.** Cloudflare does this internally [read].
- **Per-session state in a Durable Object with SQLite.** Ramp does this [read]; it matches the brief's thread object.
- **Bounded CI with test selection and autofix.** Stripe uses selective tests from more than 3 M, autofix, and at most 2 rounds [read].
- **Cheaper CI vendors and ARM.** Blacksmith and Namespace are 2–3x cheaper per minute than GitHub; GitHub arm64 is about 40% cheaper than x64 [read].
- **Active-CPU billing.** Vercel, Cloudflare and Fly Sprites charge CPU only while it is used, which suits agents that mostly wait on the LLM [read]. Vercel's own examples assume 10% CPU utilisation [read].

## Implications for a future forge

1. **Price and design the forge around verified changes, not seats or minutes** [inference]. The useful unit is $ per landed change: tokens, plus sandbox-hours, plus CI per round times rounds, plus proof. Show it per thread. The brief's AI Gateway "cost per thread" fits here.
2. **Make verification cheaper than generation; this is the main long-term problem.** Build in test-impact analysis, remote caches (Bazel/Namespace-style), incremental builds keyed on content, and evidence reuse across rebases: if the bytes under a test did not change, reuse the result. As tokens get cheaper, the forge's value is in verifying changes cheaply [inference].
3. **Run verification inside the thread's warm sandbox, not in a separate cold CI runner.** The sandbox already has dependencies and build caches, and costs about $0.15/h against $0.36–1.32 per hosted CI round. Use a separate trusted runner only for the final gate (evidence must come from an environment the agent cannot tamper with). Depot's combination of CI, agent sandboxes and per-test billing points the same way [inference].
4. **Store a thread as git plus a snapshot pointer plus a setup recipe, so the machine can be rebuilt.** Snapshot retention is 7–30 days, so the forge cannot rely on snapshots to keep a thread bootable. Keep code in Artifacts (cheap per op, $0.50/GB-mo), machine snapshots in object storage at about $0.02–0.08/GB-mo, and always store a deterministic setup script so expired snapshots can be rebuilt [inference].
5. **Fork the repo per thread, land through a single writer, and serve reads from bundles.** That avoids the 200 req/s per-repo ceiling and the single-ref contention GitHub describes. Use bundle-uri or prebuilt image snapshots for CI and sandbox hydration instead of N clones of trunk [inference].
6. **Treat concurrency limits as a platform constraint to plan around.** Build a scheduler that queues threads against vCPU, preview and browser quotas and recycles previews on landing. For the demo: no more than 6 concurrent builds and 10 browsers on a default Workers Paid account [inference from read limits].
7. **Offer a choice of model tier per thread and make the cost visible.** Since frontier and small models differ by 100x per token, policy can route proof and review to cheap models and keep frontier models for planning and conflict resolution (Anthropic's guidance already suggests Sonnet or Haiku for teammates and subagents) [read + inference].
8. **Sandbox vendors are interchangeable; the forge should stay provider-neutral.** All of them cost $0.06–0.32/h and start in under a second to a few seconds; the differences are fork semantics, limits and isolation. A forge abstraction such as "thread environment = image + snapshot + fork()" avoids lock-in [inference].

## Contradictions and pushback

- **Artifacts billing date:** Oct 14 (docs and changelog) against Oct 15 (competition blog) [read both]. Unresolved.
- **"Sandboxes are cheap, so ignore them" overstates it.** Per hour they are 1–5% of cost, but at 1,000 always-on agents that is about $110k/month, and idle wall-clock billing (E2B, Daytona, Modal, Runloop bill provisioned CPU) can make them 2–3x more expensive than active-CPU providers [inference].
- **"Tokens will be nearly free" ignores the flat frontier band and rising consumption.** Top-tier per-token price is the same or higher than in 2025, Gemini Flash is **doubling** on 2027-01-01, and per-task token use keeps rising (thinking always on, 30% tokenizer inflation, 7–15x for multi-agent) [read]. Epoch itself notes that the fastest declines are recent and "it's less clear that those will persist", and that reasoning models are excluded [read].
- **Cold-start comparisons are not comparable.** Upstash says so, and still lists Cloudflare at 1–3 s after Cloudflare's own 650 ms result [read]. Vendor claims (65 ms, under 90 ms, under 250 ms) measure different things.
- **The Fly Sprites memory price** differs by 2x between Fly ($0.021875/GB-h) and Upstash ($0.04375/GiB-h) [read].
- **Anthropic's own token examples disagree by about 100x.** The Managed Agents worked example (65k tokens per hour) and the Claude Code `/usage` example (about 9.4M tokens per API-hour) are both on the same vendor's pages [read].
- **GitHub keeps human review as a requirement** ("the people who own the code can still review, understand, and approve it") [read]. That is the opposite of the brief's "merge on proof" thesis, though GitHub is talking about its storage layer, not prescribing policy.
- **Git worktrees vs. machines.** Stripe says worktrees "wouldn't scale". Cloudflare and ArtifactFS bet on cheap per-sandbox mounts [read]. Both reject shared-checkout parallelism.

## Open questions

1. Does the Artifacts Workers binding expose git notes, or only git clients pushing `refs/notes/*`? Is a fork billed as one operation, and do forks share storage (deduplicated) or count full size against the 1 GB per repo and 1 TB per account limits?
2. Cloudflare container snapshot pricing, restore latency, and the 30-day/20 GB limits seen only in a snippet. Also: is a fork primitive on the roadmap?
3. Can the Workers Builds limit of 6 concurrent builds be raised, and is there an API for build status and pinned deployment URLs? This was already open in the brief.
4. What is the real distribution of tokens per agent-hour across organisations? There is no independent dataset (only Anthropic's averages). OpenRouter or Epoch usage data would help; not retrieved.
5. The status of GitLab's Raft-based Gitaly cluster (not verified because search ran out).
6. Unverified brief claim: Anthropic's "CI jobs grew 25x in six months". I could not open the Anthropic CI post (no URL, no search budget).
7. Devin ACU pricing (the page returned 404), as a benchmark for vendor-bundled "agent-hour" pricing.
8. CPU compute price trend per year for CI and sandboxes. I have no primary source for the rate; GitHub's single 39% cut is the only data point.
9. Per-change CI cost at real organisations (Stripe and Ramp publish no costs; Ramp says sessions are "effectively free").

## Sources (every URL opened)

| URL | Title | Date | Status |
|---|---|---|---|
| https://blog.cloudflare.com/artifacts-git-for-agents-beta/ | Artifacts: versioned storage that speaks Git | 2026-04-16 | read |
| https://developers.cloudflare.com/artifacts/platform/pricing/ | Artifacts pricing | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/artifacts/platform/limits/ | Artifacts limits | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/changelog/product/artifacts/ | Artifacts changelog | entries 2026-04-16 → 2026-10-01 | read |
| https://blog.cloudflare.com/next-git-platform-on-cloudflare/ | We want you to build the next Git platform on Cloudflare | 2026-10-01 | read |
| https://github.com/cloudflare/artifact-fs | cloudflare/artifact-fs README | 2026 (beta) | read |
| https://developers.cloudflare.com/containers/pricing/ | Containers pricing | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/containers/platform-details/limits/ | Containers limits | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/sandbox/platform/limits/ | Sandbox SDK limits | accessed 2026-10-12 | read |
| https://blog.cloudflare.com/faster-agent-sandboxes/ | Cloudflare Containers, rebuilt to scale agent sandboxes | 2026-09-30 | read |
| https://developers.cloudflare.com/changelog/post/2026-09-30-snapshots/ | Snapshot and restore Container filesystem | 2026-09-30 | read |
| https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ | Workers Builds limits and pricing | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/browser-rendering/pricing/ | Browser Rendering / Browser Run pricing | accessed 2026-10-12 | read |
| https://developers.cloudflare.com/durable-objects/platform/pricing/ | Durable Objects pricing | accessed 2026-10-12 | read |
| https://e2b.dev/pricing | E2B pricing | accessed 2026-10-12 | read |
| https://docs.e2b.dev/sandbox/fork | E2B: Fork a sandbox | accessed 2026-10-12 | read |
| https://www.daytona.io/pricing | Daytona pricing | accessed 2026-10-12 | read |
| https://modal.com/pricing | Modal pricing | accessed 2026-10-12 | read |
| https://modal.com/docs/guide/sandbox-snapshots | Modal: Sandbox snapshots | accessed 2026-10-12 | read |
| https://vercel.com/docs/vercel-sandbox/pricing | Vercel Sandbox pricing and quotas | last updated 2026-09-10 | read |
| https://vercel.com/docs/sandbox/concepts/snapshots | Vercel Sandbox: Snapshots | last updated 2026-08-26 | read |
| https://docs.fly.io/about/pricing | Fly.io pricing | accessed 2026-10-12 | read |
| https://fly.io/sprites | Fly Sprites | accessed 2026-10-12 | read |
| https://cloud.morph.so/developers | Morph Cloud for developers (Infinibranch) | accessed 2026-10-12 | read |
| https://cloud.morph.so/docs/documentation/setup/plans | Morph Cloud plans / MCUs | accessed 2026-10-12 | read (no rates shown) |
| https://www.freestyle.sh/products/vms | Freestyle VMs | accessed 2026-10-12 | read |
| https://www.runloop.ai/pricing | Runloop pricing | accessed 2026-10-12 | read |
| https://upstash.com/blog/ai-agent-sandbox-providers-compared-2026 | AI Agent Sandboxes Compared: 15 Providers (Upstash) | 2026-09-17 | read (secondary, vendor-authored) |
| https://github.com/firecracker-microvm/firecracker/blob/main/SPECIFICATION.md | Firecracker specification | accessed 2026-10-12 | read |
| https://www.usenix.org/conference/nsdi20/presentation/agache | Firecracker (NSDI '20) abstract | 2020 | read |
| https://www.usenix.org/system/files/nsdi20-paper-agache.pdf | Firecracker: Lightweight Virtualization for Serverless Applications | Feb 2020 | read (pdftotext) |
| https://gvisor.dev/docs/architecture_guide/performance/ | gVisor performance guide | accessed 2026-10-12 | read |
| https://builders.ramp.com/post/why-we-built-our-background-agent | Why we built our background agent (Ramp Inspect) | date not captured | read |
| https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents | Minions: Stripe's one-shot end-to-end coding agents | date not captured | read |
| https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent | About Copilot cloud agent | accessed 2026-10-12 | read |
| https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/ | Building Git infrastructure for agent-scale development | 2026-10-06 (upd. 10-07) | read |
| https://github.blog/engineering/infrastructure/stretching-spokes/ | Stretching Spokes | 2017-10-13 (upd. 2025-06-03) | read |
| https://docs.gitlab.com/administration/gitaly/praefect/ | Gitaly Cluster (Praefect) | accessed 2026-10-12 | read |
| https://docs.gitlab.com/administration/gitaly/ | Gitaly | accessed 2026-10-12 | read |
| https://en.wikipedia.org/wiki/Piper_(source_control_system) | Piper (Wikipedia) | accessed 2026-10-12 | read (secondary) |
| https://research.google/pubs/why-google-stores-billions-of-lines-of-code-in-a-single-repository/ | Why Google Stores Billions of Lines… (abstract) | 2016 | read (abstract only) |
| https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/ | Sapling: Source control that's user-friendly and scalable | 2022-11-15 | read |
| https://git-scm.com/docs/bundle-uri | Git bundle-uri technical doc | Git 2.56 docs | read |
| https://git-scm.com/docs/BreakingChanges | Git BreakingChanges (3.0) | accessed 2026-10-12 | read |
| https://git-scm.com/docs/scalar | scalar(1) | accessed 2026-10-12 | read |
| https://git-scm.com/docs/partial-clone | Partial clone design | Git 2.56 docs | read |
| https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/ | Get up to speed with partial clone and shallow clone | 2020 | read |
| https://devblogs.microsoft.com/devops/introducing-scalar/ | Introducing Scalar | 2020 | read |
| https://docs.github.com/en/billing/reference/actions-runner-pricing | Actions runner pricing | accessed 2026-10-12 | read |
| https://github.com/resources/insights/2026-pricing-changes-for-github-actions | 2026 pricing changes for GitHub Actions | updated 2025-12-15 | read |
| https://depot.dev/pricing | Depot pricing | accessed 2026-10-12 | read |
| https://www.blacksmith.sh/pricing | Blacksmith pricing | accessed 2026-10-12 | read |
| https://namespace.so/pricing | Namespace pricing | accessed 2026-10-12 | read |
| https://www.buildbuddy.io/pricing | BuildBuddy pricing | accessed 2026-10-12 | read |
| https://epoch.ai/data-insights/llm-inference-price-trends | LLM inference prices have fallen rapidly but unequally across tasks | 2025-03-12 | read |
| https://a16z.com/llmflation-llm-inference-cost/ | Welcome to LLMflation | Nov 2024 | read |
| https://platform.claude.com/docs/en/about-claude/pricing.md | Claude API pricing | accessed 2026-10-12 | read |
| https://code.claude.com/docs/en/costs | Claude Code: Manage costs effectively | accessed 2026-10-12 | read |
| https://www.anthropic.com/engineering/multi-agent-research-system | How we built our multi-agent research system | Jun 2025 | read |
| https://developers.openai.com/api/docs/pricing | OpenAI API pricing | accessed 2026-10-12 | read |
| https://ai.google.dev/gemini-api/docs/pricing | Gemini API pricing | accessed 2026-10-12 | read |
| https://instances.vantage.sh/aws/ec2/m7i.large | m7i.large pricing (Vantage) | accessed 2026-10-12 | read (secondary) |
| https://cacm.acm.org/research/why-google-stores-billions-of-lines-of-code-in-a-single-repository/ | CACM article | 2016 | **403, not read** |
| https://dl.acm.org/doi/fullHtml/10.1145/2854146 | CACM full text | 2016 | **403, not read** |
| https://cacmb4.acm.org/magazines/2016/7/204032-… | CACM mirror | 2016 | **403, not read** |
| https://devin.ai/pricing | Devin pricing | — | **404, not read** |
| https://openai.com/api/pricing/ | OpenAI pricing (marketing) | — | **403**; used developers.openai.com instead |
| https://git-scm.com/docs/git-bundle-uri | — | — | **404**; used /docs/bundle-uri |

# 06: New forges and agent collaboration layers (landscape as of 12 Oct 2026)

Researcher key: `06-new-forges-landscape`. Method: about 45 primary pages opened (company blogs, docs, changelogs), plus a few search-result summaries. The web-search budget for the session ran out partway through, so a few funding and date facts rest on coverage only and are tagged [secondary].

Tags: **[read]** means I opened a primary page and read it. **[secondary]** means press coverage or a search summary. **[inference]** means my own reasoning.

---

## Summary

- **The field has split into three layers, and nobody owns all of them.** (1) *Git storage rebuilt for agent write rates*: Cursor Continuity/Origin, GitHub's Spokes replacement, Entire's regional network, Cloudflare Artifacts, Pierre Code.Storage, ERSC. (2) *Thread or session as the unit of work*: Amp orbs, Zed Delta/DeltaDB, Entire Checkpoints, Devin/Warp/Murmur sessions. (3) *Automating the PR lifecycle up to merge*: Macroscope Murmur and Approvability, Cursor Bugbot, PR Routing & Approval and Rollouts, Graphite, Devin Review, Jules auto-fix CI. [inference from all sources below]
- **Only two products have actually dropped the pull request internally: Amp and Zed.** Amp pushes to main "from the first commit" with a Ship button. Zed turned PRs off on Delta's repo, and 33 people have since landed 570 changes. Everyone else still ends at a PR on GitHub or on a GitHub clone. [read]
- **Landing is still agent-side everywhere.** Amp's default Ship is a prompt: commit, rebase on origin/main, run the full suite, push, and retry if main moved. Zed's agent "lands the change" after it triggers an existing CI. Murmur agents rebase and resolve conflicts until the PR is "ready for human approval". Nobody sells server-side landing (speculative batching plus conflict hand-back) as a service. The closest is Graphite's stack-aware merge queue with batching and bisection, which is still PR-centric. [read]
- **Cursor is now the most vertically integrated contender.** Editor, cloud agents with prebuilt "builds", Bugbot, Security Reviewer, Rollouts, PR Routing & Approval with `APPROVAL_POLICY.md`, Graphite (stacks and merge queue, agreement signed 19 Dec 2025) and Origin hosting (early beta 17 Aug 2026) on a new storage engine, Continuity. Since 14 Aug 2026 Cursor belongs to SpaceX. [read]
- **Cursor's Continuity is the most detailed public design for agent-scale git storage.** It uses a write-ahead log in S3 as the source of truth, stateless replicas, CAS on the WAL index, and UDP gossip with ETag-verified reads. It sustains 120 pushes/s on S3 Standard and over 300 pushes/s on S3 Express, scales reads linearly to 100 replicas, and uses one replica for each of "millions of tiny repositories created by agents". The author is Vicent Martí, an early GitHub engineer. [read]
- **GitHub has converged on the same architecture** (authoritative data in Azure Blob, compute as cache, agreement only on the ref update, up to 35x write throughput in benchmarks). It explicitly keeps branch protection and required reviews, and it has shipped native stacked PRs with a `gh stack` CLI. [read]
- **Cloudflare Artifacts is the cheapest place to create "a repo per agent".** Each repo is a Durable Object running a roughly 100 KB Zig/Wasm git server, with native git notes, ArtifactFS lazy hydration and event subscriptions. It costs $0.15 per 1,000 ops and $0.50/GB-month, and billing starts 15 Oct 2026. Cloudflare's competition asks for the layer above this. [read] This **verifies** several claims the brief marked unverified (git notes, ArtifactFS, pricing, billing on Oct 15).
- **Entire (Thomas Dohmke) is a read-scaling and provenance play, not yet a forge.** It raised a $60M seed (Feb 2026), offers Checkpoints that write session metadata to an `entire/checkpoints/v1` branch, and runs regional GitHub mirrors (8 Jul 2026), where `entire/unmirrored/*` branches take high write volume locally. On its roadmap: native hosting, policy-as-code branch protection, CI/CD, and "intent-based review". [read]
- **Jujutsu-native hosting is real but small.** ERSC (East River Source Control) is in trials with early partners. It promises first-class conflicts, fine-grained ACLs and "thousands of commits per second", with review and stacked diffs "coming soon". Tangled runs stacked PRs keyed by jj change-ids on AT Protocol, with round-based, immutable submissions. [read]
- **Review is being automated by policy, not abolished.** Macroscope Approvability (`.macroscope/approvability.md`) and Cursor PR Routing & Approval (`APPROVAL_POLICY.md` per directory, base-branch version used when a PR edits policy) both encode the brief's idea that "merge policy is code over evidence". [read]
- **"Proof" is converging as the review artifact.** Amp says "give me 100% proof", Cursor cloud agents attach video demos, Murmur PRs include "screenshots, recordings, and evidence", Warp's Implementation Agent "proves it works with computer use verification", and Jules sends screenshots via Playwright. None of them stores proof as a typed, replayable object that merge policy reads. [read; the gap is inference]
- **Counter-signals.** Cursor's own multi-agent research found a single integrator "quickly became an obvious bottleneck" and removed it, accepting a "small and constant" error rate. Cognition found that multi-agent works when "writes stay single-threaded". Graphite's batch mode gives up per-commit green. [read]
- **Funding scale is very uneven.** Cognition raised $2B+ at a $48B valuation (Sep 2026, ARR near $900M then "$1B run rate"). Factory raised $200M at $5B. Entire raised a $60M seed, GitButler a $17M Series A, Zed $32M (Series B, 2025), Tangled €3.8M, and ERSC about $5M [secondary]. Radicle refuses VC (Swiss non-profit). [read except where tagged]

---

## Detailed findings

### 1. Amp (ampcode.com): thread with a machine attached, push-to-main

- **Company.** "We are an independent agent research lab. We build Amp ... We also operate Amp Labs." The team list includes Quinn Slack, Beyang Liu and Thorsten Ball, and "Everyone at Amp builds Amp with Amp." Investor names are not shown as text. [read] https://ampcode.com/about. The spin-out from Sourcegraph and the funding details are unverified this pass. Sourcegraph's own blog is now about Deep Search and Agentic Batch Changes, not Amp. [read index]
- **Orbs.** "Orbs are remote machines where Amp agents work ... Every orb thread gets a fresh, isolated environment with your code, plugins, development tools, and the context of the thread that created it." An orb sleeps a few minutes after the agent finishes, and "a sleeping orb costs nothing, even if it sleeps for weeks". Spawn pacing allows a burst of 20 metered orbs per user, then one new orb every five minutes, and later starts queue rather than fail. A shared tmux terminal sees the same working copy as the agent. `amp sync <thread>` mirrors orb changes locally. [read] https://ampcode.com/docs/orbs. Agents first ran in orbs on 30 Jun 2026; multiplayer arrived 22 Jul, event-driven orbs 23 Jul, agent-to-agent messaging 17 Jul, and OIDC workload identity 14 Jul. [read, chronicle index] https://ampcode.com/chronicle
- **Orbs, Explained (25 Aug 2026).** "You can spawn hundreds of them. Thousands. There's no limit." Each thread has a shareable URL. Orbs can wake on a schedule, and agents can spawn other orbs and exchange messages and files. [read] https://ampcode.com/notes/orbs-explained
- **Portals (6 Aug 2026).** "Anything that ... listens on a port and speaks HTTP" can be exposed. The agent writes `.amp/services.yaml` and runs `amp orb services <ensure|start>`, and the app must respect the `PORT` and `PUBLIC_URL` env vars. Portals "go to sleep and wake along with your orb", are visible to anyone with access to the thread, and can be annotated. Amp recommends a dev-only sign-in bypass of the form `/__dev/log-me-in/{email}?returnTo=`. [read] https://ampcode.com/news/portals
- **Proof as the review artifact.** Thorsten Ball (4 Aug 2026): "I want you to give me 100% proof that what you did works. Test this end to end ... Show me a screenshot, a video ... Dazzle me." The agent "runs for eight, ten, twenty, sometimes thirty minutes". On review: "A mountain of code, but proof that it works ... changes things, massively." [read] https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs. The docs make the same point: "When the work is ready, the thread contains the conversation, the code changes, the running services, and the proof, which is everything you need to review the result." [read] https://ampcode.com/docs/orbs
- **Landing (Shipping Changes docs).** "By default, Amp uses trunk-based development." The default Ship prompt tells the agent to: commit; fetch and rebase onto origin/main; "Run the full test suite"; push to the base branch; "If the push fails because the base branch moved, rebase again, resolve conflicts, and push"; then archive the thread and any child threads and remove the runner worktree. On a substantive conflict the agent "checks with you before continuing". It ignores a failing test "only after confirming that the same test also fails on the base branch". There are three Ship Behaviors: Ship, Push to Branch (with a PR URL on GitHub), and Custom Ship (a plain-text prompt of up to 10,000 chars with "no template variables", for "a merge queue, a release script, or a Git host other than GitHub"). [read] https://ampcode.com/docs/orbs/shipping
- **Restack (11 Sep 2026).** "Organizes all of your thread's changes into a cleaner set of commits ... The final file contents stay the same." It covers changes since the merge base, rewrites local history, and "does not push". [read] https://ampcode.com/news/restack-your-changes and the docs above.
- **Velocity and compliance.** In *Pave The Road* (Alex Kemper, 10 Aug 2026): "We push straight to main (here's Quinn shipping 23 changes during a 3-hour livestream) ... Since we shipped Orbs a month ago, our commit velocity ... has increased by 65% ... We now make more than 85% of our commits from Orbs." The philosophy line is "isolation over permission, quick reversibility rather than careful review, and parallelism instead of queues." [read] https://ampcode.com/notes/pave-the-road. In the SOC 2 note (Will Dollman, 13 Aug 2026), the controls are restricted push access, signed commits (GitHub enforces verified signatures on main), automated CI where "Bad changes block main", and commits linked to Amp threads. "And no, code review isn't on the list ... We're 20 people ... we're not going to pretend a 2,000-person company should let everyone push to main." [read] https://ampcode.com/notes/thats-not-soc-2-compliant
- **Storage.** Amp is listed as a Code.Storage customer on Pierre's site. [read] https://code.storage. That would mean Amp stores some data (probably thread or orb state) on Pierre, not only GitHub. [inference]
- **Forge implication.** Amp has the most complete "thread = conversation + sandbox + diff + proof" product. Its landing loop is a prompt run by each agent, and the docs admit custom flows are just more prompts. That leaves contention, batching and conflict hand-back unsolved at scale. [inference]

### 2. Zed: Delta and DeltaDB, thread with history attached

- **Funding.** $32M Series B led by Sequoia (20 Aug 2025), more than $42M in total. The same post already described DeltaDB as "operation-based version control ... uses CRDTs ... designed to interoperate with Git" with "character-level permalinks", and promised to "open-source it, and offer an optional paid service". [read] https://zed.dev/blog/sequoia-backs-zed
- **DeltaDB (11 Jun 2026, "Software Is Made Between Commits").** "Where Git captures a snapshot at each commit, DeltaDB captures every operation in between and gives each one a stable identity." "A message and the edit it produced are recorded side by side." "Because DeltaDB embeds conflict-free replicated worktrees, many people and agents can edit the same files at once." From a line of code you can "find the conversation that produced it and every conversation that has touched it since", and agents can "convene the prior agents that worked on it and ask why". "Git and CI stay for ... running checks and connecting you to the rest of the world." [read] https://zed.dev/blog/introducing-deltadb
- **Delta (private beta 12 Aug 2026).** A new application rather than a feature of Zed. "DeltaDB replicates the conversation and the worktree together, in real time." It runs on cloud runners, ships as a web client ("the same Rust application, compiled to WebAssembly and rendered through WebGL"), and syncs Claude Code sessions live into a Delta thread. Comments can anchor "a line of the diff, a step in the plan, a thinking block." [read] https://zed.dev/blog/introducing-delta
- **Public beta (16 Sep 2026).** "We disabled pull requests on Delta's own repository." A review subthread "guides you through your branch's changes with access to the original agent's context. Each review gets its own isolated copy of the parent thread's worktrees ... Fixes made during review can be incorporated into the parent thread before you ask the agent to land the change." "A commit remains the checkpoint you push, pull, and build from." "zed-industries/zed will remain on GitHub for now." The post frames the strategy as "Follow our quest to replace GitHub.com", and says: "Most contenders promise better uptime on top of the same old primitives ... We believe that threads will be the new fundamental unit." On CI: "Longer term, content-based builds could bring CI-style verification directly into the thread. For now, an agent can trigger a run with an existing CI provider." Since PRs were turned off, "33 of us have landed 570 changes to main". Delta is free in beta, paid plans are coming, and "There will always be a free version." [read] https://zed.dev/blog/delta-public-beta
- **Roadmap.** The roadmap page did not render for me (it is client-side). The brief's summary of it (remote runtime and CLI in progress; sandboxing, conversation branching and repo-level context next) is **[secondary via brief]**. https://zed.dev/delta/roadmap
- **Forge implication.** Zed owns the richest *history* model (operation-level, stable anchors), but landing is "ask the agent to land", and verification is external. [inference]

### 3. Cursor (Anysphere, now part of SpaceX): Origin, Continuity, Bugbot, Graphite, cloud agents

- **Ownership.** "Cursor has officially been acquired by SpaceX. This completes the acquisition process that started in April, when we announced our partnership with SpaceXAI." (14 Aug 2026). [read] https://cursor.com/blog/joining-spacex. Coverage gives $60B all-stock, announced 16 Jun 2026 and closed 14 Aug. [secondary] This **resolves** the brief's unverified "Cursor's ownership" item.
- **Origin (early beta 17 Aug 2026).** "We're starting with the essentials, designed for agent scale: repos, pull requests, code browsing, and GitHub sync. Agent-native features ship soon." "For Origin-hosted repos, Origin is the source of truth ... GitHub is not in the path." PRs on synced repos sync both ways "within seconds". CI comes through Depot or Buildkite, both of which run existing GitHub Actions workflows, and previews through Vercel ("every PR gets a preview deployment"). [read] https://cursor.com/changelog/origin-code-hosting
- **Origin docs.** It is available on Start, Pro, Pro+, Ultra, Teams and Enterprise, but not Free. Each team claims a namespace at `cursor.com/codebase/{owner}/{repo}`. PR pages have Activity, Commits, Checks and Files Changed tabs, and "a Request Changes review from someone with write access blocks merging". On mirrored repos, branches named `origin/...` "stay on Origin so you can keep working when GitHub is unavailable" (forge-local branches). [read] https://cursor.com/docs/origin and https://cursor.com/docs/origin/pull-requests. Automations trigger on push-to-branch and PR events, and cloud agents open Origin PRs on Origin repos and GitHub PRs on mirrors. [read] https://cursor.com/docs/origin/agents. **CloneKit**: `origin repo clone-fast` downloads a prebuilt packed snapshot from `gitcdn.origin.cursor.com` and then tops up. Its tokens expire in 15 minutes or less, and it is Enterprise-only, enabled per repo. [read] https://cursor.com/docs/origin/clonekit-ci
- **Continuity storage ("Git at any scale", Vicent Martí, 18 Aug 2026).** "The core primitive behind it is a write-ahead log, which we store in S3-compatible object storage ... We never acknowledge a push until it has been fully persisted." A push becomes visible only after its ref transaction is prepared on a local repo and a pointer is recorded in the WAL index, which "forces all pushes to be linearizable". Repos are "a warm cache on disk", there are "no routing tables (and no relational database)", and placement uses rendezvous hashing. CAS on S3 means "it's always safe for any instance of a repository to receive a push." Replication uses UDP gossip, and each read does a conditional GET on the WAL index ETag (a 304 is under 10 ms). "A large monorepo can be deployed across hundreds of replicas ... Millions of tiny repositories created by agents can be served with one replica each", and idle replicas are garbage-collected and rebuilt from the WAL. Only the primary compacts, and replicas download compacted packs. Numbers: "up to 120 pushes/s" on S3 Standard and "more than 300 pushes/s" on S3 Express One Zone, "bottlenecked by the speed at which Git can compact"; synthetic tests showed linear read scaling to 100 replicas. The post criticises Spokes for 3PC tail latency ("The more replicas you add ... the worse push throughput gets") and for treating repos as "pets". [read] https://cursor.com/blog/git-at-any-scale
- **Self-driving codebases research (Wilson Lin, 5 Feb 2026).** A harness ran thousands of agents on a web-browser project. Equal-role agents sharing a lock file failed ("20 agents would slow to the throughput of 1-3"). The final design is recursive planners plus workers. An integrator for merges "quickly became an obvious bottleneck. There were hundreds of workers and one gate", so it was removed. The system peaked at "~1,000 commits per hour across 10M tool calls over a period of one week." "When we required 100% correctness before every single commit, it caused major serialization", so they accepted a "small and constant" error rate plus a periodic "green" branch fixup. Disk became the hotspot because of "many GB/s" of build artifacts. They ask whether git and cargo shared locks could use database-style concurrency control, plus copy-on-write and dedup across agent checkouts. [read] https://cursor.com/blog/self-driving-codebases
- **Cloud agents and builds (13 Aug 2026).** Environment snapshots are prebuilt hourly by default, and "new agents forking a live machine instead of restoring one from disk". Internal environments boot "10x faster", with time to first token "3x faster". Faire runs "more than 2,000 automated agent runs a week". Each run is tied to the exact build and commit SHA it used. Builds became the default on 17 Aug. [read] https://cursor.com/blog/builds
- **Bugbot.** It reviews PRs on Origin, GitHub, GitLab, Bitbucket and Azure DevOps and publishes a `Cursor Bugbot` check. Findings default to *neutral*, so "requiring the status alone does not block merges on findings" unless fail-on-unresolved is enabled. It is configured through `.cursor/config/bugbot.yaml`, and there is a separate Autofix check. [read] https://cursor.com/docs/bugbot
- **PR Routing & Approval.** It "can approve low-risk PRs when your criteria are met. It does not replace a full code review." Inputs are risk scoring with a maximum risk threshold, Bugbot and Security Agent findings ("waits for the relevant agentic reviewer checks"), and directory-scoped `APPROVAL_POLICY.md` files ("Only exact basename matches are trusted ... The closest applicable ... has the highest priority"), plus `.cursor/approval-policies/ROUTING.md` for product boundaries. A safety rule: if a PR changes a policy file, "the agent does not use the changed content to relax review requirements for that same PR. It uses the base-branch version." It works on GitHub and Origin only. [read] https://cursor.com/docs/approval-agents
- **Rollouts and Security Reviewer (23 Sep 2026).** "Writing code is no longer the slow part. What hasn't sped up is everything after the PR goes up." Before merge, Rollouts writes a monitoring plan. After deploy it compares signals with the baseline, and on a regression it pings the author, pauses the progressive rollout, or opens "a revert PR waiting for approval". Feature-flag ramping is "coming soon". [read] https://cursor.com/blog/rollouts-and-security-reviewer
- **Graphite.** "Graphite has signed a definitive agreement to join Cursor ... will continue to operate as an independent product." The plan was to "Double down on our best-in-class stacked PRs platform and merge queue" and to "Combine the best of Graphite's AI Reviewer and Cursor's Bugbot", toward "a future where PRs become self-driving". [read] https://graphite.com/blog/graphite-joins-cursor (dated 19 Dec 2025 on the blog index). Graphite was valued at $290M before the deal and raised a $52M Series B in Mar 2025. [secondary: Fortune and SiliconANGLE via search; Graphite blog index lists "Graphite raises $52M" on 17 Mar 2025 [read index]]. Later posts: "Cursor Cloud Agents in Graphite" (2 Mar 2026) adds an Agents tab and in-PR agent chat with "full history and context preserved" between the two products [read] https://graphite.com/blog/cursor-cloud-agents; "Code Tours" (1 Apr 2026) turns a PR into a narrated walkthrough, with "Visual artifacts" and "Test validation" promised [read] https://graphite.com/blog/code-tours. **There are no Graphite blog posts after 1 Apr 2026**, which suggests the work now ships under Cursor. [read index; the conclusion is inference]
- **Graphite merge queue mechanics (pre-acquisition).** The stack-aware queue runs CI only on the top of the stack (`gtmq_speculative_*` branches), fast-forwards the whole stack atomically, and on failure bisects and evicts the failing PR and its dependents. It claims "74% faster merge times at Ramp, 7 hours saved per engineer per week at Asana". [read] https://graphite.com/blog/the-first-stack-aware-merge-queue. Batching builds a draft PR stacking up to N stacks and fast-forwards main to its head. It "relax[es] the requirement for correctness on every single commit" and offers bisect-and-requeue on failure ("coming soon" at the time). [read] https://graphite.com/blog/merge-queue-batching
- **Unverified.** The claim that Origin was announced at Cursor's "Compile" conference on 16 Jun 2026, and that it launched on the same day as an eight-hour GitHub outage. [secondary: BigGo/SiliconANGLE]

### 4. GitHub (incumbent response)

- **"Building Git infrastructure for agent-scale development" (Brian Celenza, 6 Oct 2026).** Commits reached 7.38B in Sep 2026, more than 5x year on year. Pushes rose from 0.69B to 3.35B a month and git events from 218.2B to 473.3B a month. Actions ran 3.26B times in Sep, more than 4x. PR merges are nearly 4x. The busiest repo received about 1B requests in August. Problems named: per-agent push latency, write convergence, "Merge contention ... funnel merges onto one ref", and read fan-out from CI and scanning. Spokes keeps 5 copies with 3PC. The plan moves authoritative data to Azure Blob, treats compute as cache, needs agreement only on the ref update, and moves maintenance off the serving path, with "up to 35 times higher write throughput" in internal benchmarks. It preserves "Branch protections and required reviews". [read via WebFetch] https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/
- **Native stacked PRs.** GitHub now documents "stacked pull requests" with a `gh stack` CLI extension, and the docs mention keeping "required reviews and status checks in place". [read] https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests. GitButler 0.22 added "native support for GitHub's new Stacked PRs". [read] https://blog.gitbutler.com/gitbutler-0-22. I could not find a launch date.

### 5. Cloudflare Artifacts

- **Launch (16 Apr 2026, private beta).** "A versioned file system that speaks Git ... Want to give every agent session a repo? ... create 10,000 forks from a known-good starting point." Each repo is a Durable Object, and the git server is "written in pure Zig (no libc), compiled to a ~100KB WASM binary". Objects live in DO SQLite (chunked at the 2 MB row limit) with ~128 MB of memory per DO; R2 holds snapshots and KV holds tokens. It supports git protocol v1 and v2, shallow clones and have/want negotiation. "We have native support for git-notes ... prompts, agent attribution and other metadata." **ArtifactFS** is open source: "Git clone but async", a blobless clone that hydrates file contents in the background (manifests and code first) and blocks a read until the file arrives. It works with any remote, and a 2.4 GB repo goes from "close to 2 minutes" to a target of about 10–15 s. Internally Cloudflare uses it to persist sandbox filesystem and session history per session, so sessions can be forked "from any point". Pricing: "$0.15 per 1,000 operations, First 10k included"; "$0.50/GB-mo, First 1GB included". [read] https://blog.cloudflare.com/artifacts-git-for-agents-beta/
- **Open beta and competition (1 Oct 2026).** Workers Builds integration (production branch deploys, other branches create Workers Previews). A Workers binding can create or fork repos, read files and "issue repo-scoped Git tokens". Events fire on created, imported, forked, deleted, pushed, cloned and fetched (example event type `cf.artifacts.repo.pushed`). There is US/EU jurisdiction per namespace and per-repo metrics. "We will begin billing for Artifacts usage on October 15, 2026." "We aren't looking for GitHub as it exists today with agents added on top. At a minimum, we want to see multiple agents working on changes concurrently." Submissions close 14 Oct 2026. [read] https://blog.cloudflare.com/next-git-platform-on-cloudflare/
- **Verifies the brief:** git notes, ArtifactFS and pricing are confirmed. The billing date is **October 15** per the blog; the changelog date was not checked.

### 6. Entire (Thomas Dohmke)

- **Launch (10 Feb 2026).** "$60 million seed round ... led by Felicis, with support from Madrona, M12, Basis Set, 20VC, Cherry Ventures, Picus Capital, and Global Founders Capital." The vision has three parts: "a git-compatible database that unifies code, intent, constraints, and reasoning", a "semantic reasoning layer that enables multi-agent coordination through the context graph", and an "AI-native software development lifecycle". It also says "Pull requests simply do not scale for large monorepos." **Checkpoints** write a structured object per agent commit and push it "to a separate branch (entire/checkpoints/v1), giving you a complete, append-only audit log inside your repository." [read] https://entire.io/blog/hello-entire-world. A $300M valuation is reported. [secondary]
- **Git network (8 Jul 2026).** "Starting today, you can mirror your public or private GitHub repositories on Entire." Agents fetch from "a regional Entire cell that absorbs the heavy concurrent read traffic", and "any branch prefixed with entire/unmirrored/ stays local to the region". The architecture is "a global control plane for identity and placement, and regional data planes for content-addressed Git storage. Ref updates remain protected by compare-and-set semantics, while object writes fan out across storage nodes." Writes are replicated across AZs. Regions: US, EU and Australia, plus India later. Remotes use an `entire://` git remote helper. Entire released **ForgeMark**, an MIT-licensed benchmark for concurrent push throughput against smart-HTTP forges (its numbers are rendered as images, so I did not capture them). Next on the list: "Native hosting ... An open-source Entire Git backend ... Tamper-evident branch history and policy-as-code branch protection that any client can independently verify ... CI/CD ... A developer workflow built around intent-based review." [read] https://entire.io/blog/an-entirely-new-git-hosting-network
- **Other posts.** "Session logs are now the most important artifact in software development" (6 Jul 2026) [read] https://entire.io/blog/how-version-control-will-evolve-for-the-agent-boom. `entire blame` adds checkpoint, session, agent and model to each line (30 Jun 2026) [read] https://entire.io/blog/introducing-entire-blame. Google sign-in independent of GitHub arrived 8 Oct 2026 ("a giant leap toward being independent") [read] https://entire.io/blog/entire-dispatch-0x001f. Session sharing with redaction followed on 6 Oct 2026 [read] https://entire.io/blog/sharing-sessions-is-the-new-social-coding.
- **Brief check.** The brief rated Entire's network "snippet only". It is now **verified [read]**: regional mirrors, unmirrored local branches, CAS on refs, and a roadmap to native hosting.

### 7. Macroscope (Murmur, Approvability)

- **Murmur (3 Sep 2026, early preview; CEO Kayvon Beykpour).** "For the last two months, 90% of the code we shipped at Macroscope was orchestrated through an internal tool." Each agent gets "its own dedicated cloud VM", and internally "each VM runs a single node kubernetes cluster running dozens of microservices". Agents verify their work before opening a PR "that includes screenshots, recordings, and evidence". "Self-driving": agents "respond to review comments ... Repair failing checks. Rebase when branches move. Resolve merge conflicts ... until the pull request is clean and ready for human approval." The **Director** is a CLI usable from local Claude Code or Codex, so "your local agent session becomes the control plane for a fleet of remote agents." It integrates with Slack, Linear, GitHub, a REST API and MCP. It is agent-agnostic (BYO keys). VMs can run in your own AWS or GCP, the control plane can be self-hosted, configuration is in Terraform, and service profiles define the VM image, network boundary and credentials. [read] https://macroscope.com/blog/introducing-murmur
- **"The End of Human Code Review" (29 Jan 2026).** "In the near future, human engineers will review close to zero pull requests ... agents will decide when PRs are ready to merge and only (infrequently) escalate." An example auto-approval rule: no unresolved correctness issues, small blast radius, a strong author trust profile, and no policy guardrails tripped (e.g. auth). [read] https://macroscope.com/blog/end-of-human-code-review
- **Approvability (13 Feb 2026).** An auto-approval check whose policy lives in `.macroscope/approvability.md`. It approves docs, tests, flag-off code and small bug fixes, and escalates schema migrations, refactors, infra, "security, billing, authentication, or sensitive data". "For many teams, approving a PR without a human reviewer means updating SOC II guidance." [read] https://macroscope.com/blog/introducing-approvability
- **Funding.** Not verified this pass.

### 8. Pierre Computer Company (Code.Storage)

- Pierre "produces low level, composable product infrastructure for machine work. We're building code.storage." Its open-source projects are Diffs, Trees and DiffsHub. [read] https://pierre.co
- **Code.Storage.** "Powers the largest agentic workloads in the industry ... Lovable, Poke, Anything, Bolt, Amp, Parahelp." Limits: unlimited storage and repos, git requests "Seen: 500+/s/repo", API "Seen: 15k+/s", "Concurrent writes 30+", and a 32 TB repo size limit. It "leverages Git's three-phase commit protocol and a 'spoke-like' quorum-based architecture", with a 99.99% SLA. SDKs exist in TS, Python and Go, plus webhooks, GitHub, GitLab and Bitbucket sync, and white-label git endpoints (`git clone git.my-app.com/foo`). Pricing: hot storage $0.005/GB-hour, cold $0.0002/GB-hour (after 7 days untouched), ingress $0.06/GB, egress $0.15/GB, and BYO-cloud "Managed Code Storage". [read] https://code.storage
- **Note.** Pierre is a git backend for *other* agent products, not a forge with PRs. It is the closest analogue to Cloudflare Artifacts. Its Spokes-style 3PC is exactly the design Cursor and GitHub are moving away from. [inference] Funding and launch date are not verified.

### 9. ERSC (East River Source Control): jj-based host

- **"An update on ERSC availability" (Benjamin Brittain, 4 May 2026).** "Our version control model is based on Jujutsu, with first class conflicts, fine-grained ACLs, and backwards compatibility with git. Taking inspiration from how Google, Meta, and others have done code hosting ... a distributed system that can land thousands of commits per second, instant checkouts, and support for arbitrarily sized files. Our storage engine speaks git and 'jj' ... Rather than building a better git server, we've opted to build the substrate that comes next. We're currently trialing the product with early partners ... Code review coming soon, and yes, there will be stacked diffs." The footnote says stacked diffs are "table stakes". [read] https://ersc.io/blog/ersc-availability. The latest post is a technical one by Austin Seipp (6 Oct 2026). [read] https://ersc.io/blog
- **Funding and founders.** About $4.86M raised in 2025 per an SEC filing. Founders are reported as Brittain and David Barsky (ex-rust-analyzer at Meta), with Amplify Partners named as an investor. Sources disagree on round type and investor list. [secondary]

### 10. Tangled (tangled.org, formerly tangled.sh)

- **Seed (2 Mar 2026).** "€3,8M ($4.5M) financing round led by byFounders, with participation from Bain Capital Crypto, Antler, Thomas Dohmke ... Avery Pennarun." It is built on the AT Protocol and had "7k+ users ... 5k+ repositories". The 2026 plan: microVM CI (spindle v2) and Nix CI, repo migrations across knots, a "mission control" dashboard, a GitHub migration tool, code search, and a CLI. "One dev and a hundred agents building a micro-SaaS." [read] https://blog.tangled.org/seed
- **Object model.** Git servers are called "knots", and events (issues, PRs) are AT Protocol records. "You can even push to a repository on your own server, and open a pull-request on a repo hosted on a completely different server." [read] https://blog.tangled.org/federation. PRs are patch-based and **round-based**: "Submissions are immutable ... Reviews are attached to submissions ... interdiff." Each PR uses hidden tracking refs `refs/hidden/:localRef/:remoteRef` across forks. [read] https://blog.tangled.org/pulls. Stacked PRs are keyed by jj change-ids: "If you edit a commit, its SHA changes, but its change-id remains the same. And this is the essence of our new stacked PRs feature." [read] https://blog.tangled.org/stacking
- **Anti-slop.** Vouch and denounce records live on your PDS, are scoped to your circle, carry no enforcement yet, and planned evidence trails would attach the merged PR to a vouch. The rationale given: "LLM tools are really good at creating 'uncanny valley' submissions." [read] https://blog.tangled.org/vouching

### 11. Radicle

- A peer-to-peer forge on Git. Collaborative Objects (COBs) store issues and patches as signed Git objects, and gossip spreads metadata. Version 1.10.3 shipped 8 Sep 2026, and work on Radicle 2.0 has started (1.10.0, 5 Aug 2026). The 1.10 release reworked repository-identity revision states (Active/Accepted/Rejected/Redacted) and fixed a delegate double-accept issue. [read] https://radicle.xyz/ and https://radicle.xyz/2026/08/05/radicle-1.10.0.html
- **radicle.garden (2 Jun 2026).** Hosted always-on seed nodes run by The Better Internet Foundation, a Swiss non-profit, and hosted in Europe: "Non-Profit, Not a VC-backed Startup." [read] https://radicle.xyz/2026/06/02/announcing-radicle-garden.html. Security disclosures were published 30 Mar and 23 Sep 2026 [read index]. No agent-specific features were found. There was a "Jujutsu with Radicle" post in Aug 2025 [read index].

### 12. GitButler

- **Series A, $17M led by a16z (8 Apr 2026 per the blog index; Peter Levine joins the board).** Scott Chacon: "Today, with Git, we're all teaching swarms of agents to use a tool built for sending patches over mailing lists." The stated direction is "surfacing merge conflicts between teammates early", "letting agents see what everyone on a team is working on", and keeping PR descriptions and agent interactions in version control. There was no forge announcement. [read via WebFetch] https://blog.gitbutler.com/series-a
- **Product.** The `but` CLI (Feb 2026) and 0.22 "Catch 22" (6 Aug 2026), which adds native GitHub stacked PRs (`but pr`), `but agent setup` skills, and `but resolve <commit> --ai`. [read] https://blog.gitbutler.com/gitbutler-0-22. "Agent-safe Git" (16 Apr 2026) describes per-task lanes, explicit commit selection, and cheap recovery. [read] https://blog.gitbutler.com/agentic-safety
- **vcbench (7 Jul 2026, vendor benchmark).** 300 graded runs (Claude Code and Codex × 5 tasks × 3 tools × 10). Median times for git vs jj vs GitButler: multi-amend 195s vs 214s vs 51.3s, split 159s vs 228s vs 42.1s, about 60% faster overall and about 80% fewer commands for GitButler. jj was slower than git in most scenarios. [read] https://blog.gitbutler.com/vcbench

### 13. Sourcegraph

- It is now positioned as code understanding plus large-scale change, not as a forge. **Agentic Batch Changes** (14 Sep 2026): "Describe the change once." It scopes, plans, tries one repo, rolls out, reacts to CI, and "tracks merge status". "Most of the time it writes a script." The largest Batch Change merged "more than 2,200 changesets", and beta customers merged "nearly a thousand changesets". [read] https://sourcegraph.com/blog/introducing-agentic-batch-changes. "The autonomous codebase" (Dan Adler, 21 Sep 2026): we have "nailed the prompt to PR problem"; brownfield maintenance "remains completely unsolved"; the model is triggers plus callable agent "functions", with "massive, unsolved problems like identity, authorization, and budget controls". [read] https://sourcegraph.com/blog/the-autonomous-codebase

### 14. Warp (Warp Factories)

- Warp now calls itself "Warp Factories — Run fleets of coding agents across your SDLC". [read] https://www.warp.dev/blog. *The Factory Stack* (Zach Lloyd, 5 Sep 2026) describes a `factory.yaml` holding agent config, runners, repos, automations, integrations, webhooks and scorers ("It's Terraform for factories"). Layers: Context (memories, traces, telemetry), Compute ("pausable, resumable", computer use, self-hostable), Inference (any model), and Improvement (cost per PR, cycle time). Forges appear only as an access point: "Source code forges (Github / Gitlab / Azure Devops) where you might review PRs." [read] https://www.warp.dev/blog/the-factory-stack
- *Terraform for agents* (Ben Holmes, 30 Sep 2026) describes a Foreman routing agent plus Triage, Implementation ("proves it works with computer use verification, and opens a PR"), Code Review and Design agents, each in its own cloud environment. Changes to the factory are "reviewed through pull requests, either via GitHub or **our own config host we're building**." [read] https://www.warp.dev/blog/software-factory-as-code. The config host is a small forge signal. [inference]

### 15. Factory (factory.ai, now factory.com)

- $200M at a $5B valuation (15 Sep 2026), over $400M in total. Investors include Blackstone, Khosla, Sequoia, Insight, NEA and others. "Factory 2.0 moved the platform from individual coding agents to 'software factories'", and it supports air-gapped deployment. Factory Router "cuts token spend by more than 60%". Automations shipped 30 Sep 2026. Nothing about hosting, PR or merge in the funding post. [read via WebFetch] https://factory.com/news/5-billion-valuation and https://factory.com/news

### 16. Cognition (Devin, Windsurf → Devin Desktop)

- Series E: "over $2B at a $48B valuation", led by a16z and Accel (8 Sep 2026). Run-rate revenue grew "from $492M to almost $900M" since May. A "$1B ARR" post followed on 25 Sep 2026. [read] https://cognition.ai/blog/series-e and https://cognition.ai/blog (index)
- **Devin Desktop (2 Jun 2026)** is "the next generation of Windsurf". The Agent Command Center is the default surface. Spaces let related agents share context, and any ACP agent can run inside it. [read] https://cognition.ai/blog/introducing-devin-desktop
- **Devin Review (21 Jan 2026).** Swap `github` for `devinreview` in any PR URL. It offers intelligent diff ordering, move/rename detection, and red/yellow/gray bug flags against the "Lazy LGTM problem". [read] https://cognition.ai/blog/devin-review
- **"Multi-Agents: What's Actually Working" (Walden Yan, 22 Apr 2026).** Multi-agent works when "agents contribute intelligence to a task while writes stay single-threaded". Devin Review catches "an average of 2 bugs per PR" on Devin's own PRs, "roughly 58%" of them severe. The coder and the reviewer loop natively, and this works best when they "do not share any context beforehand". Enterprise Devin usage grew about 8x in 6 months. [read] https://cognition.ai/blog/multi-agents-working
- Cognition acquired The Interaction Company (Poke) on 23 Jul 2026 [read index]. Poke is a Code.Storage customer per Pierre's site [read]. No Cognition forge or hosting product was found. Devin still ends at GitHub PRs. [read/inference]

### 17. Google Jules

- The flow is clone to a cloud VM, plan, diff, then "Jules creates a PR ... merge it to your branch". Plans: 15 tasks/day with 3 concurrent on free, and 100/day with 15 concurrent on Pro. [read] https://jules.google/
- **Changelog.** The Jules API (3 Oct 2025), CLI `--parallel` (up to 5, 10 Nov 2025), a Planning Critic (26 Jan 2026), and "Auto-Fixing CI Failures and configure Jules to commit as you" (19 Feb 2026). **The last entry is 9 Mar 2026** (Gemini 3.1 Pro). [read] https://jules.google/docs/changelog/. A seven-month silence suggests Google's attention has moved elsewhere; I did not verify that. [inference]

### 18. Replit

- **Snapshot engine (17 Dec 2025).** Block devices are split into 16 MiB immutable chunks in GCS, and "copying a disk is a matter of copying the manifest". Checkpoints save the git commit plus the Postgres state. "Every Replit application has an immutable, append-only git remote". In parallel sampling, "we can pick the best set of changes and apply them atomically to the main app". [read via WebFetch] https://replit.com/blog/inside-replits-snapshot-engine. An Aug–Sep 2026 eval post mentions "Agent 4's parallel-and-merge and subagent decompositions" and forked sandboxes for parallel evaluation. [read] https://replit.com/blog/evaluating-and-improving-agent-at-scale
- Replit is a closed platform with git as the export format, not a forge. [inference]

### 19. Vercel v0

- **New v0 API (5 Aug 2026, GA).** "Each chat is an isolated workspace for one app ... starts a dev server in a Vercel Sandbox, and gives you a preview URL", and v0 "verifies the code running in the Sandbox". Deploy is one API call. [read] https://vercel.com/blog/category/v0. The v0 unit is the *chat*, and the git and PR integration is not described there. Vercel is also Origin's preview provider. [read Origin changelog]

---

## Comparison table

| Player | What it is | Core object | How landing works | Hosting / storage | Funding / stage | Launch (key dates) | Notable claim |
|---|---|---|---|---|---|---|---|
| **Amp** | Agent plus remote env (orbs), web/CLI/mobile | **Thread** (orb + portal + changes + proof) | Ship = prompt: commit → rebase origin/main → full tests → push to main → retry; Restack first; custom Ship prompt | GitHub (plain git); Code.Storage customer | "Independent agent research lab"; funding n/v | Orbs 30 Jun 2026; Portals 6 Aug; Restack 11 Sep | +65% commit velocity, >85% of commits from orbs; SOC 2 with no PRs |
| **Zed Delta** | Multiplayer agent env on DeltaDB | **Thread + delta stream** (op-level, CRDT worktrees) | Agent "lands the change" after review subthread; CI via external provider | DeltaDB over git; Zed repo still on GitHub | $32M Series B (Sequoia, 2025), >$42M total | DeltaDB post 11 Jun; private beta 12 Aug; public beta 16 Sep 2026 | PRs off on own repo; 33 people, 570 changes |
| **Cursor Origin (+ Bugbot, Graphite)** | Full forge + cloud agents + AI review | **Repo / branch / PR** (stacks via Graphite) | Standard PR merge; reviews and checks; PR Routing & Approval can auto-approve low risk; Graphite stack-aware queue | Continuity: WAL in S3, stateless replicas | Owned by SpaceX (closed 14 Aug 2026; ~$60B [sec]) | Origin early beta 17 Aug 2026; Graphite deal 19 Dec 2025 | 120–300+ pushes/s per repo; 1 replica per tiny agent repo |
| **GitHub** | Incumbent forge | Repo / branch / PR, now native stacked PRs | PR + merge queue; keeps required reviews | Moving Spokes → Azure Blob + compute cache | Microsoft | Infra post 6 Oct 2026 | Up to 35x write throughput (benchmark) |
| **Cloudflare Artifacts** | Git-speaking versioned storage primitive | **Repo per agent/session**, forks, git notes | None (BYO); Workers Builds deploys production branch | Durable Objects + Zig/Wasm git, R2, KV | Public company; open beta | Private beta 16 Apr; open beta 1 Oct 2026; billing 15 Oct | "Millions of repositories per namespace"; $0.15/1k ops |
| **Entire** | Provenance (Checkpoints) + regional git network | **Commit + checkpoint/session** | Not yet (mirror pushes to GitHub; `entire/unmirrored/*` local) | Global control plane, regional data planes, CAS on refs | $60M seed (Felicis) | Company 10 Feb 2026; network 8 Jul 2026 | "Session logs are now the most important artifact" |
| **Macroscope Murmur** | Agent fleet orchestration + AI review/approval | **Task → PR** | Agents rebase, fix CI, resolve conflicts until PR "ready for human approval"; Approvability can auto-approve | GitHub | n/v | Approvability 13 Feb; Murmur preview 3 Sep 2026 | 90% of own code via Murmur |
| **Pierre Code.Storage** | Git storage API for agent platforms | **Repo** (programmatic) | N/A | Spokes-like 3PC quorum | n/v | n/v | 500+ git req/s/repo seen; 32 TB repos |
| **ERSC** | jj-based code host | **jj change** (first-class conflicts) | "land thousands of commits per second"; review "coming soon" | Custom engine speaking git + jj | ~$5M (2025) [sec] | Availability update 4 May 2026; trials | Stacked diffs "table stakes" |
| **Tangled** | Federated social forge on AT Protocol | **Patch rounds**; stacked PRs by change-id | Maintainer merge of rounds | "Knots" (self-hostable git servers) | €3.8M seed (byFounders) | Intro 2 Mar 2025; seed 2 Mar 2026 | Vouching web of trust vs LLM slop |
| **Radicle** | P2P sovereign forge | **Patch COB** (signed git objects) | Delegates merge; identity by delegate votes | Peer nodes; radicle.garden hosted seeds | Swiss non-profit, no VC | 1.0 Sep 2024; 1.10.3 Sep 2026 | N-1 seeder failure tolerance |
| **GitButler** | Client: virtual/stacked branches, `but` CLI | **Lanes / stacked branches** | Opens GitHub (stacked) PRs; AI conflict resolve | GitHub etc. | $17M Series A (a16z) | Series A 8 Apr 2026; 0.22 6 Aug 2026 | ~60% faster than git for agent history edits (own benchmark) |
| **Graphite** | Stacked PRs + merge queue + AI review (Cursor-owned) | **Stack of PRs** | Stack-aware merge queue: CI on stack top, atomic FF; batching + bisect | GitHub | Acquired by Cursor | Deal 19 Dec 2025; last post 1 Apr 2026 | 74% faster merges at Ramp |
| **Sourcegraph** | Code search, Deep Search, Agentic Batch Changes | **Batch change → many PRs** | Tracks PRs to merge across repos | Customer's forges | n/v | Agentic Batch Changes 14 Sep 2026 | Largest batch: 2,200+ changesets merged |
| **Warp Factories** | Factory-as-code agent fleet platform | **Task via Foreman → PR** | Code Review agent rounds, then human; GitHub PRs | GitHub; "own config host we're building" | n/v | Posts Sep 2026 | "Terraform for agents" |
| **Factory** | Enterprise "software factories" (Droids) | Session / automation | n/a in sources read | Customer's forges; air-gapped | $200M @ $5B | 15 Sep 2026 | Router saves >60% tokens |
| **Cognition (Devin/Windsurf)** | Cloud agent + Devin Desktop + Devin Review | **Session → PR**; Spaces share context | Devin ↔ Devin Review loop before human; GitHub PR | GitHub | $2B+ @ $48B; ~$1B ARR | Devin Desktop 2 Jun; Series E 8 Sep 2026 | 2 bugs/PR found on Devin's own PRs, 58% severe |
| **Google Jules** | Async cloud coding agent | **Task → PR** | Opens PR; auto-fixes CI; human merges | GitHub | Google | Launch 19 May 2025; last changelog 9 Mar 2026 | 15 concurrent tasks on Pro |
| **Replit** | Closed app platform + Agent | **App + checkpoint** (git commit + DB manifest) | Pick best of parallel samples, apply atomically | Immutable append-only git remote + block snapshots | n/v this pass | Snapshot post 17 Dec 2025 | Constant-time fork via manifest copy |
| **Vercel v0** | App-building agent + API | **Chat** (one app workspace + sandbox preview) | Deploy to Vercel via API | Vercel Sandbox | Vercel | v0 API GA 5 Aug 2026 | Preview URL per chat |

n/v = not verified this pass.

---

## Pain points for agentic-scale development (as the companies describe them)

1. **Push throughput and single-ref contention.** GitHub names per-agent push latency and "merge contention ... onto one ref". Cursor says Spokes 3PC means "The more replicas you add ... the worse push throughput gets." Entire says agents send "thousands of concurrent requests in seconds, triggering traffic caps". [read]
2. **Read fan-out and clone cost.** One push triggers thousands of CI and scanning fetches (GitHub). Cursor built CloneKit packed snapshots, and Cloudflare built ArtifactFS lazy hydration because a 2.4 GB clone takes about 2 minutes. [read]
3. **Too many tiny repos.** Cursor: "Millions of tiny repositories created by agents", with three idle replicas each under Spokes as "the floor is always too high". [read]
4. **Everything after the PR.** Macroscope: "A change can spend as much time moving through the GitHub lifecycle as it spent being implemented." Cursor: "What hasn't sped up is everything after the PR goes up." Cognition: "code review—not code generation—is now the bottleneck." [read]
5. **Review cannot keep up with diff size.** Zed: "the diffs we're asking each other to review have mushroomed." Devin: the "Lazy LGTM problem". Graphite: "now the bottleneck is how quickly we can review it." [read]
6. **Lost intent.** Entire: "Git preserves what changed, but nothing about why." Zed: comments "attach to snapshots and fall out of date." [read]
7. **Central integration gates collapse at hundreds of agents.** Cursor's integrator became "an obvious bottleneck", and requiring 100% correctness per commit "caused major serialization". [read]
8. **Local machine limits.** Macroscope: "Laptops were built for developers, not fleets of developers." Amp: friction from checkouts and ports capped how many agents people spawned. Cursor: disk I/O became the hotspot with hundreds of agents compiling. [read]
9. **Slop and trust at the open-source edge.** Tangled: "'uncanny valley' submissions". [read]
10. **Compliance assumptions.** Amp and Macroscope both report that SOC 2 does not require PRs, but that policies need rewriting. [read]

## How organizations are solving them

- **Storage re-architecture.** WAL or object store as the source of truth, with compute as cache: Cursor Continuity (S3), GitHub (Azure Blob), Entire (regional data planes plus CAS refs), Cloudflare (DO per repo). Pierre still uses a Spokes-style quorum. [read]
- **Escape hatches from the central host.** Entire `entire/unmirrored/*` branches, Cursor forge-local `origin/...` branches during GitHub outages, and two-way PR sync. [read]
- **Remote sandboxes with snapshots.** Amp orbs (sleep, then wake), Cursor builds (fork a live machine), Replit manifest forks, Murmur VMs (single-node k8s), Jules environment snapshots, and Cloudflare per-session Artifacts repos. [read]
- **Agent-run PR lifecycle.** Murmur self-driving PRs, Jules auto-fix CI and act on PR feedback, Devin autofixes review comments, Graphite in-PR agent. [read]
- **Policy-as-code approval.** Cursor `APPROVAL_POLICY.md` and `ROUTING.md` with risk thresholds, Macroscope `.macroscope/approvability.md`, and Entire's planned "policy-as-code branch protection that any client can independently verify". [read]
- **Proof artifacts.** Amp "100% proof" plus portals, Murmur screenshots and recordings in PRs, Cursor cloud-agent video demos (per Graphite), Warp computer-use verification, Jules Playwright screenshots, and Graphite Code Tours' promised "Test validation". [read]
- **Provenance capture.** Entire Checkpoints branch and `entire blame`, Amp commits linked to threads, Zed delta-anchored conversations, Cloudflare git notes for "prompts, agent attribution". [read]
- **Smarter merging.** Graphite's stack-aware speculative queue with batching and bisection, Replit's best-of-N atomic apply, Amp's rebase-retry loop, and Cursor Rollouts for post-merge revert PRs. [read]
- **Factory-as-code.** Warp `factory.yaml`, Murmur Terraform, Cursor `.cursor/config/bugbot.yaml`. [read]

## Implications for a future forge (thread-native thesis)

1. **The brief's thesis largely holds.** "Neither Amp nor Zed owns landing", and the same is true of everyone else. Amp's landing is a prompt, and Zed's is "ask the agent to land". Murmur loops until a human approves. Graphite's queue is the only server-side landing engine, and it is PR- and stack-centric with no thread context or conflict hand-back. **Landing as a service that wakes the losing thread with the winner's intent is still open ground.** [inference from read sources]
2. **Storage is being commoditised fast.** Cursor, GitHub, Entire, Cloudflare and Pierre all offer high-concurrency git. A new forge should not compete on raw push throughput. It should sit on a WAL- or object-store-backed host (Artifacts for the competition) and win on the object model and landing. [inference]
3. **Cursor's integrator finding is a design warning.** A single serialising gate fails at hundreds of agents. Landing needs speculative batching, path or symbol-scoped concurrency, and an acceptance of transient red with a "green" snapshot branch, which both Cursor and Graphite batching chose. Per-commit-green should be policy, not a law. [inference from read]
4. **Policy files over evidence are the emerging merge gate.** Cursor already uses directory-scoped `APPROVAL_POLICY.md` with a sound base-branch rule against self-relaxing PRs. Generalising the evidence from "AI reviewer findings" to "typed proof objects attached to a pinned preview" is a small, credible step. [inference]
5. **Stable change identity matters.** Tangled (jj change-ids), ERSC (jj) and Zed (stable delta identity) all reject the SHA as the identity of a change under revision. A thread-native forge should give each change a stable id that survives restacking (Amp's Restack plus a change-id), so evidence and comments follow the change. [inference]
6. **Provenance via git notes or a sidecar branch is already standard.** Entire uses `entire/checkpoints/v1`, Cloudflare offers native git notes, and Amp links commits to threads. The brief's "git note on the landed commit" plan matches practice. [read + inference]
7. **"Repo per thread" is cheap on Artifacts** ($0.15/1k ops), but Workers Builds previews are tied to branches of one connected repo (per the brief). Threads probably need to be branches of the project repo plus forked scratch repos for experiments. [inference]
8. **Incumbents are adding stacking and agent review, not threads.** GitHub keeps required reviews and adds stacked PRs. Cursor Origin is PR-shaped with "agent-native features" promised. Zed and Amp are the only ones selling thread-first. The demo can show the gap clearly. [inference]

## Contradictions and pushback

- **"No human review" vs "humans stay in control."** Amp and Zed have no PRs, and Macroscope predicts "close to zero" human reviews. Against that: GitHub preserves required reviews; GitButler says "The goal is not to make agents autonomous over your repo"; Cursor's own approval agent "does not replace a full code review"; Murmur stops at "ready for human approval". [read]
- **Scale of the no-PR model.** Amp says it works for 20 people and not for 2,000 unchanged. Zed has 33 people. There is no public evidence of a no-PR workflow above about 50 engineers. [read + inference]
- **Multi-agent writes.** Cognition says writes should stay single-threaded. Cursor ran thousands of concurrent writers but had to accept a constant error rate and drop the integrator. These are different trade-offs for real products versus research toys. Cognition notes the demos "share a property most real software doesn't: a simple, verifiable success criterion". [read]
- **jj for agents.** ERSC and Tangled bet on jj. GitButler's (vendor) benchmark found jj *slower* than plain git for agents on most history-editing tasks. [read]
- **Spokes-style quorum vs WAL.** Pierre advertises 3PC quorum as a strength, while Cursor and GitHub describe it as the scaling problem. [read]
- **Origin's launch date.** BigGo says it was announced 16 Jun at "Compile". The changelog says early beta began 17 Aug. These may both be true (announcement vs rollout). [secondary vs read]
- **Brief vs sources.** The brief says Murmur is "a CLI that lets a local agent direct a fleet". That is confirmed ("Director"). The brief calls Origin "A git host with PRs". That is confirmed, but the brief misses the Continuity storage engine, PR Routing & Approval and Rollouts, which narrow the gap to "landing as a service". Cursor has the pieces (queue via Graphite, approval policies, rollback bots), even if they are not yet assembled into a thread-native landing service. [read + inference]

## Open questions

- Does Graphite's merge queue run on Origin repos, and has its batching bisect-and-requeue shipped? (The Graphite blog has been silent since Apr 2026.)
- What are Origin's "agent-native features"? Is a server-side merge or landing service coming?
- Delta's current roadmap status for sandboxing, verification and landing (the page did not render). Does DeltaDB host git itself yet?
- Amp's corporate structure and funding after leaving Sourcegraph, and what Amp stores on Code.Storage.
- Funding for Macroscope, Pierre and Amp (search budget exhausted).
- The launch date and merge semantics of GitHub's native stacked PRs (does merging a stack use the merge queue?).
- ForgeMark's actual numbers (Entire) and whether anyone has run it against Origin, Artifacts or Code.Storage.
- Whether OpenAI is building its own code host. This is the brief's open item, and I could not check it this pass.
- Is Jules being wound down or folded into another Google product? The changelog has been silent since Mar 2026.

## Sources (opened and read unless noted)

**Amp**
- About — https://ampcode.com/about (undated, read 2026-10-12)
- Chronicle index — https://ampcode.com/chronicle (read 2026-10-12)
- Orbs docs overview — https://ampcode.com/docs/orbs (undated)
- Shipping Changes docs — https://ampcode.com/docs/orbs/shipping (undated)
- Orbs, Explained — https://ampcode.com/notes/orbs-explained (2026-08-25)
- What I Want to Tell You About Orbs (Thorsten Ball) — https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs (2026-08-04)
- Pave The Road (Alex Kemper) — https://ampcode.com/notes/pave-the-road (2026-08-10)
- "That's not SOC 2 compliant" (Will Dollman) — https://ampcode.com/notes/thats-not-soc-2-compliant (2026-08-13)
- Portals into Orbs — https://ampcode.com/news/portals (2026-08-06)
- Restack Your Changes — https://ampcode.com/news/restack-your-changes (2026-09-11)
- Proof of Human — https://ampcode.com/news/proof-of-human (2026-05-27)

**Zed**
- Sequoia Backs Zed — https://zed.dev/blog/sequoia-backs-zed (2025-08-20)
- Software Is Made Between Commits — https://zed.dev/blog/introducing-deltadb (2026-06-11)
- Introducing Delta — https://zed.dev/blog/introducing-delta (2026-08-12)
- Replace PRs with Delta, Public Beta — https://zed.dev/blog/delta-public-beta (2026-09-16)
- Delta roadmap — https://zed.dev/delta/roadmap (did not render; content via brief)

**Cursor and Graphite**
- Origin Code Hosting changelog — https://cursor.com/changelog/origin-code-hosting (2026-08-17)
- Git at any scale (Vicent Martí) — https://cursor.com/blog/git-at-any-scale (2026-08-18)
- Cursor is now a part of SpaceX — https://cursor.com/blog/joining-spacex (2026-08-14)
- Towards self-driving codebases (Wilson Lin) — https://cursor.com/blog/self-driving-codebases (2026-02-05)
- Cloud agents start 3x faster with builds — https://cursor.com/blog/builds (2026-08-13)
- Bots for the last mile: Rollouts, Security Review — https://cursor.com/blog/rollouts-and-security-reviewer (2026-09-23)
- Bugbot docs — https://cursor.com/docs/bugbot
- PR Routing & Approval docs — https://cursor.com/docs/approval-agents
- Origin docs — https://cursor.com/docs/origin ; /docs/origin/pull-requests ; /docs/origin/agents ; /docs/origin/clonekit-ci
- Graphite blog index — https://graphite.com/blog (read 2026-10-12)
- Graphite joins Cursor — https://graphite.com/blog/graphite-joins-cursor (2025-12-19)
- Cursor Cloud Agents in Graphite — https://graphite.com/blog/cursor-cloud-agents (2026-03-02)
- Code Tours — https://graphite.com/blog/code-tours (2026-04-01)
- The first stack-aware merge queue — https://graphite.com/blog/the-first-stack-aware-merge-queue (2025-06-02 per index)
- Merge queue batching — https://graphite.com/blog/merge-queue-batching (undated)
- [secondary] Search summaries of SiliconANGLE, DevOps.com, BigGo, Fortune and Wikipedia on Origin, SpaceX and the Graphite deal (not opened)

**GitHub**
- Building Git infrastructure for agent-scale development (Brian Celenza) — https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/ (2026-10-06)
- Stacked pull requests docs index — https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests (undated)

**Cloudflare**
- Artifacts: versioned storage that speaks Git — https://blog.cloudflare.com/artifacts-git-for-agents-beta/ (2026-04-16)
- We want you to build the next Git platform on Cloudflare — https://blog.cloudflare.com/next-git-platform-on-cloudflare/ (2026-10-01)
- Birthday Week 2026 wrap-up — https://blog.cloudflare.com/birthday-week-2026-wrap-up/

**Entire**
- Hello Entire World — https://entire.io/blog/hello-entire-world (2026-02-10)
- How Version Control Will Evolve for the Agent Boom — https://entire.io/blog/how-version-control-will-evolve-for-the-agent-boom (2026-07-06)
- An Entirely New Git Hosting Network — https://entire.io/blog/an-entirely-new-git-hosting-network (2026-07-08, modified 2026-08-28)
- Introducing entire blame — https://entire.io/blog/introducing-entire-blame (2026-06-30)
- Sharing Sessions is the New Social Coding — https://entire.io/blog/sharing-sessions-is-the-new-social-coding (2026-10-06)
- Dispatch 0x001F — https://entire.io/blog/entire-dispatch-0x001f (2026-10-08)

**Macroscope**
- Introducing Murmur — https://macroscope.com/blog/introducing-murmur (2026-09-03)
- The End of Human Code Review — https://macroscope.com/blog/end-of-human-code-review (2026-01-29)
- Introducing Approvability — https://macroscope.com/blog/introducing-approvability (2026-02-13)

**Pierre**
- Pierre Computer Company — https://pierre.co (2026)
- Code.Storage — https://code.storage (undated)

**ERSC**
- An update on ERSC availability — https://ersc.io/blog/ersc-availability (2026-05-04)
- ERSC blog index — https://ersc.io/blog
- [secondary] AlleyWatch, PitchBook and Runtimewire funding summaries via search (not opened)

**Tangled**
- Blog index — https://blog.tangled.org
- Seed round — https://blog.tangled.org/seed (2026-03-02)
- We need a federation of forges — https://blog.tangled.org/federation (2026-04-29)
- Vouching — https://blog.tangled.org/vouching (2026-05-01)
- The lifecycle of a pull request — https://blog.tangled.org/pulls (2025-04-16, updated 2025-08-12)
- Jujutsu on Tangled (stacking) — https://blog.tangled.org/stacking (2025-06-02)
- Homepage — https://tangled.org

**Radicle**
- Homepage — https://radicle.xyz/ (1.10.3, 2026-09-08)
- Radicle 1.10.0 — https://radicle.xyz/2026/08/05/radicle-1.10.0.html (2026-08-05)
- Radicle Garden — https://radicle.xyz/2026/06/02/announcing-radicle-garden.html (2026-06-02)

**GitButler**
- Blog index — https://blog.gitbutler.com/ (via WebFetch)
- Series A — https://blog.gitbutler.com/series-a (2026-04-08 per index)
- Agent-safe Git — https://blog.gitbutler.com/agentic-safety (2026-04-16 per index)
- GitButler 0.22 — https://blog.gitbutler.com/gitbutler-0-22 (2026-08-06)
- Agentic Version Control Benchmarks — https://blog.gitbutler.com/vcbench (2026-07-07)

**Sourcegraph, Warp, Factory**
- Sourcegraph: The autonomous codebase — https://sourcegraph.com/blog/the-autonomous-codebase (2026-09-21)
- Sourcegraph: Introducing Agentic Batch Changes — https://sourcegraph.com/blog/introducing-agentic-batch-changes (2026-09-14)
- Warp blog index — https://www.warp.dev/blog
- Warp: The Factory Stack — https://www.warp.dev/blog/the-factory-stack (2026-09-05)
- Warp: Terraform for agents — https://www.warp.dev/blog/software-factory-as-code (2026-09-30)
- Factory news index — https://factory.com/news (via WebFetch)
- Factory raises $200M at $5B — https://factory.com/news/5-billion-valuation (2026-09-15)

**Cognition**
- Blog index — https://cognition.ai/blog (read 2026-10-12)
- Series E — https://cognition.ai/blog/series-e (2026-09-08)
- Multi-Agents: What's Actually Working — https://cognition.ai/blog/multi-agents-working (2026-04-22)
- Devin Review — https://cognition.ai/blog/devin-review (2026-01-21)
- Introducing Devin Desktop — https://cognition.ai/blog/introducing-devin-desktop (2026-06-02)

**Google, Replit, Vercel**
- Jules homepage — https://jules.google/
- Jules changelog — https://jules.google/docs/changelog/ (latest 2026-03-09)
- Replit: Inside Replit's snapshot engine — https://replit.com/blog/inside-replits-snapshot-engine (2025-12-17)
- Replit: Evaluating and improving Agent at scale — https://replit.com/blog/evaluating-and-improving-agent-at-scale (2026)
- Replit blog index — https://blog.replit.com
- Vercel v0 category / new v0 API — https://vercel.com/blog/category/v0 (2026-08-05)

**Search-only (not opened; [secondary])**: The New Stack on Delta and Entire; The Register "So long, Spokes" (2026-10-09); SiliconANGLE and DevOps.com on Origin; Fortune, SiliconANGLE and Yahoo on the Graphite acquisition; Wikipedia, DevOps.com and aiweekly on the SpaceX–Cursor deal; Temporal Replay talk listing for Murmur.

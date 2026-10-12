# 05: GitHub's response to agent-scale development (2025-2026), plus GitLab and Atlassian

Researcher key: `05-github-response`. Written 2026-10-12.
Tags: **[read]** means verified on a page I opened. **[secondary]** means it comes from coverage or a third-party summary. **[inference]** means it is my own reasoning.
Method note: WebSearch hit its shared per-turn budget partway through. After that I worked only with WebFetch, on known or discovered GitHub, GitLab and Atlassian URLs. Fetches were mostly read through a summarising fetcher. Numbers quoted below were checked against the fetched text, but a few long pages were only partly covered.

---

## Summary

- **The brief's GitHub numbers check out.** Brian Celenza's post (Oct 6, 2026, updated Oct 7) states each one: 7.38B commits in September 2026, "more than five times as many as a year earlier"; pushes up 4.9x YoY, from 0.69B to 3.35B per month; Git events from 218.2B to 473.3B per month (Sep 2025 to Aug 2026); 3.26B Actions runs in September (>4x); PR merges "nearly 4x"; up to 35x write throughput in internal benchmarks; and roughly 1B requests to the busiest repo in August. [read]
- **GitHub's storage fix keeps the PR and human gate.** It splits storage from compute: authoritative data moves to Azure Blob Storage, compute workers become stateless, only the ref update needs coordination, and GC/compaction move off the serving path. The post says plainly that branch protections and required reviews must survive, so "unreviewed changes never reach the default branch." [read]
- **The brief's reliability figures check out, and the trend is worse than it suggests.** GitHub's monthly availability reports count 3, 4, 3 and 5 incidents for Sep to Dec 2025. In 2026 the counts are Jan 2, Feb 6, Mar 4, **Apr 10, May 9**, Jun 6, Jul 8 and Aug 5. The September 2026 report was not yet published when I checked. The status page, which uses a lower threshold, logged 14 incidents in Sep 2026 and 8 in Oct 1-7 alone. [read]
- **GitHub's CTO blamed agents for the load.** Vlad Fedorov (Apr 28, 2026) wrote that a 10X capacity plan began in Oct 2025, and that by Feb 2026 GitHub had to "design for 30X today's scale." He said "agentic development workflows have accelerated sharply since the second half of December 2025." GitHub's stated priority is "availability, then capacity, then features." [read]
- **GitHub's merge queue corrupted default branches on Apr 23, 2026.** Squash-merge groups with more than one PR produced wrong merge commits that reverted earlier changes. 658 repos and 2,092 PRs were affected, and not all could be repaired automatically. This is direct evidence that landing done as a platform service is hard to get right. [read]
- **The Azure migration is a capacity emergency, not a strategic choice.** The Oct 2025 memo cited no capacity left in Northern Virginia. Azure's share of monolith traffic went 8% (Feb) → 40% (May) → 45% (Jun) → 52.75% peak (Jul 28). Git-on-Azure reached 43% against a missed 50% June target. The first production MySQL primary ran on Azure on Aug 11, 2026. GitHub expects dotcom production traffic out of its own datacenters "by the end of CY2026." AWS capacity use was reported but not confirmed by name. [read for GitHub figures; secondary for AWS]
- **GitHub's product answer is more PR machinery, not fewer PRs.** In 2026 it shipped stacked PRs (preview Jul 30, GA Oct 6), an async merge API (GA Oct 1), Copilot conflict resolution (Mar 26), agent sessions on issues and projects (Mar 26), code-coverage merge protection (Jun 30), and Claude and Codex as first-party agents inside GitHub (Feb 26). [read]
- **GitHub now lets maintainers throttle or turn off PRs, aimed at AI slop.** On Feb 13, 2026 it added options to disable PRs entirely or limit them to collaborators. On Jun 17 it added per-user caps on open PRs, which also count Copilot and other agent PRs. Further steps: restricting issue creation to collaborators (Jun 29), closing everything a blocked user has opened (Aug 27), counting drafts toward the cap (Oct 8) and letting triagers archive PRs (Oct 8). [read]
- **GitHub's own diagnosis is review cost, not hosting cost.** "The cost to create has dropped but the cost to review has not" (Ashley Wolf, Feb 12, 2026). Merged PRs rose from about 25M/month (Jan 2023) to more than 90M/month (Jun 2026). [read]
- **Agent compute moved onto Actions billing.** Copilot code review started consuming Actions minutes on Jun 1, 2026 and is billed in "AI Credits" under usage-based billing. A $0.002/min fee on self-hosted runners was announced Dec 16, 2025 and postponed after backlash; it has not taken effect. Hosted runner prices fell by up to 39% on Jan 1, 2026. [read]
- **Rate limits are unchanged and sized for humans.** Content creation is capped at 80 requests/minute and 500/hour, with 100 concurrent requests, 5,000 requests/hour per user or app, and `GITHUB_TOKEN` at 1,000/hour per repo. The Copilot cloud agent caps each session at 59 minutes. [read]
- **GitLab tells a similar story with different emphasis.** Its Duo Agent Platform went GA in 18.8 and runs flows on CI runners in a sandbox. GitLab says it is rebuilding "next-generation source control … for machine-scale concurrency," citing up to 50x faster task execution in internal tests. It adds "Governance for Agents" and a context graph called Orbit. It frames the economics as "cost per accepted change," and is offering GitHub customers one free year on a three-year contract. [read]
- **Atlassian/Bitbucket is behind.** Merge queues reached GA on Jun 30, 2026. "Agentic Pipelines" runs agents such as Codex as pipeline steps. Rovo Dev is being folded into Jira subscriptions. None of it is built around agent scale. [read]
- **Net for a future forge [inference]:** the incumbent is scaling storage and adding throttles and PR conveniences. It has not built landing as a correct, fast service, merge on typed evidence, or agent-specific identity and quotas. Its merge queue is still a FIFO speculative-build queue with 1-100 concurrency, and it has had a data-corrupting bug.

---

## Detailed findings

### A. "Building Git infrastructure for agent-scale development" (Celenza, Oct 6, 2026)

Source: https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/ [read]

- Author: Brian Celenza, Principal Software Engineer, storage and core services. Published Oct 6, 2026, updated Oct 7, 2026, 9-minute read. [read]
- **The numbers, quoted:** [read]
  - "developers and agents made 7.38 billion commits on GitHub, more than five times as many as a year earlier" (September 2026).
  - "Pushes grew 4.9x year over year, from 0.69 billion to 3.35 billion per month."
  - Git activity went "from 218.2 billion events per month to 473.3 billion" between September 2025 and August 2026.
  - "GitHub Actions alone ran 3.26 billion times in September, more than 4x as many as a year ago."
  - "Pull request merges on GitHub grew to nearly 4x their volume a year ago."
  - "The busiest repository on GitHub saw roughly a billion requests in August."
  - The new design "has delivered up to 35 times higher write throughput" in internal benchmarks.
- **How Spokes works today:** each repo is stored as full copies on the local disks of several fileservers, five by default. A three-phase commit with quorum keeps CI, web and API consistent after a ref update. This serves about 1B repos. Every replica takes part in every write, so a push is only as fast as the slowest replica, and adding read replicas slows writes. Losing quorum stops writes. [read]
- **Agent pressures the post names:** an agent in a tight loop commits or checkpoints after nearly every action, so the latency of a single push caps agent speed. Thousands of agents on their own branches produce a sustained write rate. Trunk-based development, release trains and merge queues all send merges to **one ref**. [read]
- **Target design:** authoritative data lives in Azure Blob Storage. Compute workers cache and serve reads. Coordination is needed only for the ref update; object storage, connectivity checks and secret scanning run in parallel. Compaction and GC run as separate workers against durable storage. A lost worker behaves like a cache miss. Compute scales elastically "for bursts such as releases or new agent fleets." [read]
- **What must be preserved:** branch protections and required reviews, so unreviewed changes never reach the default branch; audit logs; repo visibility. The stated goal is to keep code owners able to "review, understand, and approve." No rollout dates are given, and the post promises a follow-up. [read]
- **Corroboration:** GitHub's X account repeated the 473.3B figure. Kyle Daigle's X post repeated "roughly a billion requests in ONE MONTH" for the busiest repo. [secondary, search snippet]
- **Design implication [inference]:** GitHub has named single-ref contention as a problem but keeps the existing ref-update semantics and the human review gate. It is not changing the unit of landing. That leaves the brief's opening (a landing service with speculative batching) intact.

### B. CTO post, "An update on GitHub availability" (Fedorov, Apr 28, 2026)

Source: https://github.blog/news-insights/company-news/an-update-on-github-availability/ [read]

- Plan history: a 10X capacity plan started in October 2025. By February 2026 GitHub decided it "needed to design for 30X today's scale." [read]
- Cause: "agentic development workflows have accelerated sharply since the second half of December 2025". Repo creation, PR activity, API usage, automation and large-repo workloads are all growing. [read]
- A graphic shows peaks of **90M PRs merged, 1.4B commits and 20M new repos per month**. [read]
- The post notes that one PR touches Git storage, mergeability checks, Actions, search, webhooks, APIs, caches and databases, so small inefficiencies compound. [read]
- Short-term fixes: webhooks moved out of MySQL, the user session cache redesigned, auth flows reworked, and compute added through Azure. [read]
- Longer-term work: isolate Git and Actions from other workloads; remove single points of failure; move hot paths out of the Ruby monolith into Go; continue moving to public cloud and start on multi-cloud; spend **three months on large-monorepo scaling, "including optimizing merge queue operations"**; and publish a new API design for efficiency. [read]
- **Apr 23 merge queue incident:** squash-merge queue operations "produced incorrect merge commits when a merge group had more than one pull request." Changes from earlier merges were reverted. 658 repositories and 2,092 PRs were affected; the first estimate was higher. There was no data loss, but some default branches were left in an incorrect state and not all could be repaired automatically. Merges outside the queue were unaffected, as were queue groups using the merge or rebase method. [read]
- **Apr 27 search incident:** an Elasticsearch cluster was overloaded, "likely due to a botnet attack." It was not yet isolated because other areas ranked higher in the risk queue. [read]
- Transparency commitments: availability numbers on the status page, and status posts for both large and small incidents. [read]
- Quote: "Both of those incidents are not acceptable, and we are sorry for the impact they had on you." [read]

### C. Availability reports: incident counts and causes

Index: https://github.blog/search/Availability+Report/ (21 reports, Dec 2024 to Aug 2026, all by Jakub Oleksy) [read]

| Month | Incidents (report) | Notable causes | Source |
|---|---|---|---|
| Sep 2025 | 3 | Copilot rate-limiter flag (403s), email contention, MCP server misconfig | [read] |
| Oct 2025 | 4 | network device returned early; 3rd-party outages (Codespaces, larger runners) | [read] |
| Nov 2025 | 3 | Dependabot hit GHCR rate limit; **expired internal TLS cert broke Git ops**; Sonnet 4.5 marked unavailable | [read] |
| Dec 2025 | 5 | AI Controls Kafka config; Copilot Code Review timeouts; West US runner packet loss; schema drift; unauthenticated search traffic spike | [read] |
| Jan 2026 | 2 | Copilot model config; datastore major-version upgrade contention | [read] |
| Feb 2026 | 6 | compute-provider policy blocked VM metadata (Actions/Codespaces/agent, ~6h); user-settings cache mass rewrite (x2) exhausted Git HTTPS proxy | [read] |
| Mar 2026 | 4 | user-settings cache bug (40% github.com errors); Redis LB misconfig (95% of Actions runs delayed); coding agent datastore auth (up to ~100% errors) | [read] |
| **Apr 2026** | **10** | Copilot coding agent **rate-limit bugs** (x2); DNS; code search; **anonymous scraping saturated LB tier (6h15m)** | [read] |
| **May 2026** | **9** | schema migration saturated DB; runner image-pull rate limit; **32-bit Vitess ID overflow blocked new PR review comments (3h50m)**; Actions service account wrongly suspended | [read] |
| Jun 2026 | 6 | Copilot code review dependency; **abusive anonymous traffic**; memcached proxy; upstream models | [read] |
| Jul 2026 | 8 | metadata config broke service discovery (7h); **hosted-runner provisioning shard overloaded (9h18m)**; DNS control plane; **expired cert on self-hosted runner enforcement**; Vitess backfill dropped table (**PR creation down**) | [read] |
| Aug 2026 | 5 | **Aug 6 Actions outage 9-10h42m** (pods near limits + job-assignment bug); Aug 17 LB/sidecar overload (issues/PRs, 6-7h); Copilot cloud agent task status (provider DB); **Aug 26 shared DB primary saturated by Actions event burst** | [read] |
| Sep 2026 | not published as of fetch | status page: 14 incidents, including a Sep 13 multi-service incident and a Sep 20 "Incident with Pull Requests" | [read: status RSS] |
| Oct 1-7 2026 | n/a | status page: 8 incidents, including two "Incident with Git Operations, Pull Requests and Actions" on Oct 7 | [read: status RSS] |

Narrative quotes:
- May 2026 report: "GitHub's traffic is growing rapidly, driven in large part by AI-assisted and agentic development workflows". Azure had 40% of monolith traffic (up from 8% in Feb), and "We've more than doubled our effective capacity in four months." [read]
- June 2026 report: monolith on Azure peaked at 45%. Git on Azure went from 30% to a 43% peak, which "missed our June target of 50%". The ramp was "paused … for roughly a month after a stability incident on May 21". A new users service offloads about 500k QPS from the primary DB. [read]
- July 2026 report: the Aug 6 Actions outage "was unacceptable." Monolith read traffic on Azure peaked at 52.75% (Jul 28). GitHub has "a line of sight to get dotcom production traffic out of our datacenters by the end of CY2026." Authorization-service load fell 18.2% through caching. [read]
- August 2026 report: "our shared infrastructure services have not kept up with our month-over-month actions growth and peak load"; "On August 11, GitHub ran a production MySQL primary from Azure for the first time"; "availability, then capacity, then features." [read]
- IncidentHub (Apr 30, 2026) counted 257 status-page incidents from May 2025 to Apr 2026, 48 of them major, with 112h18m of major downtime and an average MTTR of 6h7m. Feb 2026 was the worst month, with 37 incidents. Actions led with 57 incidents, then Copilot with 44. By cause: capacity 83, deployment 71. Over the same period GitLab had 132 and Bitbucket 27, though these are not normalised for volume. [secondary, read on incidenthub]

Patterns [inference]:
1. Since Q1 2026, **Actions and the Copilot agent stack** (which runs on Actions) are the most frequent failure domain.
2. **Anonymous scraping or botnet traffic** caused at least three incidents (Dec 22, Apr 27, Jun 8).
3. **Schema and ID limits** (32-bit Vitess ID, online migrations) are failing under PR/comment volume.
4. **PR creation itself** went down twice (May 6 review comments, Jul 24 PR creation).
5. Agent features depend on the weakest layer: a failure in Actions takes down the cloud agent and code review with it.

### D. Azure migration and multi-cloud

- An Oct 2025 internal memo from CTO Vladimir Fedorov said the platform "cannot further expand its current infrastructure" and that a switch to Azure is needed for AI and Copilot growth. Teams were to delay feature work, with most of the move done within about a year and all of it within two. The memo came as GitHub moved under Microsoft CoreAI after CEO Thomas Dohmke's departure. Source: Techzine, Oct 9, 2025, citing Neowin and The Verge. [secondary, read]
- Progress from GitHub's own reports is given in section C. [read]
- AWS: DevOps.com (Jun 18, 2026) says Microsoft "has reportedly begun using" AWS for GitHub. Microsoft said only that GitHub is pursuing multi-cloud, and did not confirm AWS. The article also cites roughly 1B commits in 2025 and projections above 14B for 2026. [secondary, read] Fedorov's April post separately says GitHub is "starting work toward multi-cloud." [read]
- Kyle Daigle is quoted (via GeekWire, page returned 403) as saying GitHub is about 60% through the migration. [secondary, snippet only, unverified]

### E. Agent products: Copilot coding/cloud agent, Agent HQ, Mission Control

- **Copilot coding agent public preview** (May 19, 2025): runs in "its own secure cloud-based development environment powered by GitHub Actions" and consumes Actions minutes plus premium requests. [read] On Jul 10, 2025 billing changed to one premium request per session. [secondary, search snippet of changelog]
- Octoverse 2025 (Oct 28, 2025): more than 1M PRs were created by the coding agent between May and Sep 2025. Other figures: 43.2M PRs merged per month on average (+23%); about 1B commits pushed in 2025 (+25%); 11.5B Actions minutes in public projects; 180M+ developers. [read]
- **Agent HQ** (Kyle Daigle, Oct 28, 2025): an "open ecosystem" where agents from Anthropic, OpenAI, Google, Cognition and xAI work inside GitHub under Copilot subscriptions. **Mission control** is "a single command center for assigning, steering, and tracking agent work" across web, VS Code, mobile and CLI. Other parts: **branch controls govern when CI runs on agent-created code**; identity controls for agents; one-click merge conflict resolution; AGENTS.md; an MCP registry; GitHub Code Quality; an agent control plane for policy and audit; and a metrics dashboard. Quote: agents "shouldn't be bolted on." [read]
- Feb 26, 2026: Claude and Codex became available for Copilot Business and Pro, alongside Copilot. They are assigned to issues or PRs, open **draft PRs**, and use "one premium request" per session during preview. The Agent Control Plane reached GA the same day. [read]
- Mar 26, 2026: agent sessions appear under issue assignees with a live status (queued, working, waiting for review, completed) and in project boards. [read] On the same date, "@copilot Merge in main and resolve the conflicts" became available: the agent resolves conflicts in its cloud environment, checks build and tests, then pushes. [read]
- Current cloud agent docs: an ephemeral cloud environment; one branch at a time; at most one PR per task; scoped to one repo; **59-minute maximum session that "cannot be extended or bypassed"**; repository rules can block it, and Copilot can be added as a ruleset bypass actor. [read]
- Aug 28, 2026: Copilot Chat on the web, mobile chat and the cloud agent relaunch as one experience under one policy, enabled by default, on or after Sep 28, 2026. The cloud agent "will use Sandbox." Chat data is kept for the life of the account. [read]
- **GitHub Agentic Workflows (gh-aw)**, a GitHub Next technical preview: Markdown workflows compile to pinned Actions workflows. Engines include Copilot, Claude Code, Codex and Gemini CLI. "Agents read by default. Every write is checked before it lands" through **safe outputs** applied by a separate job. The design has six defence layers and cost caps (`max-ai-credits`, `max-daily-ai-credits`). [read]

### F. PR, review and merge machinery

- **Merge queue (docs):** FIFO. Each PR is grouped with the base plus the PRs ahead of it. Groups build on `gh-readonly-queue/{base}` and need the `merge_group` CI trigger. **Build concurrency is 1-100**, and min/max group size is 1-100 with a wait time. A failed PR is removed and the remaining groups are rebuilt. Jumping the queue rebuilds everything in flight. Wildcard branch patterns are not supported. [read]
- **Stacked PRs:** public preview Jul 30, 2026 and GA Oct 6, 2026, on all github.com plans (GHES later). A stack lands through the merge queue as one group. **Approvals survive rebases** of an unchanged stack, even where stale approvals are dismissed. Rebased commits are signed and keep original authorship. Stacks auto-retarget when a base branch is deleted. There is a `stacked` webhook action and a `gh stack` extension with worktree support; coding agents create stacks through a "gh-stack skill" (stated in the preview post). Stack auto-merge is rolling out. GitHub reports **"9% more code" merged** in repos using stacks, two-thirds of the top 1% of repos using them, and a 5% faster time-to-merge. [read]
- **Async merge API** (GA Oct 1, 2026): `PUT` returns a request ID, then you poll with `GET`. It can merge directly or enqueue, for individual PRs or stacks, and is "the only merge API that supports stacked pull requests." GitHub recommends it over the synchronous REST merge and GraphQL mutations, saying it helps "automations handle busy repositories." [read]
- **Code coverage:** coverage on PRs entered public preview May 26, 2026. **Coverage merge protection** through rulesets (Jun 30, 2026) supports a minimum percentage or maximum drop, with evaluate and then active modes. [read] This is the closest GitHub comes to "merge on evidence," and it reduces evidence to a single scalar. [inference]
- **Copilot code review:** agentic and tool-calling on Actions, and **consuming Actions minutes on private repos since Jun 1, 2026**, plus AI Credits under usage-based billing. [read] Since Aug 27, 2026 it reviews bot-authored PRs (including the Copilot cloud agent's) billed to the org. The old 300-file / 20,000-line limit is removed. Resolution reasons are "Addressed / Won't fix / Incorrect." [read] Since Oct 8, 2026 orgs can bill reviews to the org and can restrict reviews to org-provided licences. [read] The default effort level moved from Lite to Balanced on Sep 28, 2026. [read]
- Other UX: a new PR dashboard in public preview (Mar 26) that became opt-out (Apr 23); usage metrics API adds review stages (Sep 25); a new files-changed view "up to 67% faster" (cited in the Eternal September post). [read: titles/summaries]

### G. Restricting PRs, including from AI: GitHub's anti-slop controls

- Feb 4, 2026, Open Source For You: GitHub PM Camilla Moraes called low-quality contributions "a critical issue affecting the open source community." Options under consideration included disabling PRs, collaborator-only PRs, hiding PRs, AI triage and **attribution flags for AI-assisted PRs**. A Genkit maintainer is quoted: "1 out of 10 PRs created with AI is legitimate." [secondary, read]
- Feb 12, 2026, "Welcome to the Eternal September of open source" (Ashley Wolf): "The cost to create has dropped but the cost to review has not." Cited examples: curl ending its bug bounty, Ghostty going invitation-only, Mitchell Hashimoto's Vouch, and the kernel's Signed-off-by. Under exploration: requiring a linked issue before a PR, criteria gating, and AI triage against CONTRIBUTING.md through gh-aw. Quotes: "Maintainers should always remain in control" and "walls don't build communities." The post describes **no AI-attribution mechanism**. [read]
- **Feb 13, 2026 changelog / Discussion #187038:** a setting to disable PRs entirely (the tab is hidden) and a setting to allow PRs from collaborators (write access) only. On the original post: 👍12, 👎4, ❤️13. The top comment, which calls it anti-OSS gatekeeping and asks to **block AI-created PRs specifically**, drew 👎34. Supporters cited AI-slop burnout. Requests included an allow-list for people who commented on an issue, and a role below write that can still open PRs. [read]
- **Jun 17, 2026:** a cap on open PRs per user without write access, with a bypass list. "Pull requests opened by Copilot or another AI agent will count toward your limit." Drafts did not count at first; since **Oct 8, 2026** maintainers can count them. [read]
- Jun 18, 2026, "How pull request limits are cutting down the noise": merged PRs rose from about 25M/month in Jan 2023 to "over 90 million today" (3.6x). Maintainer quotes from AutoGPT, Homebrew (Mike McQuaid: AI accelerated near-identical PRs) and OpenClaw (had built its own anti-spam bots). Next steps listed: archiving, issue limits, automatic bypass based on signals (prior merged PR, account age, org membership), and **cross-repository detection** of mass PR openers. No adoption metrics are given. [read]
- Jun 29, 2026: issue creation can be restricted to collaborators. Aug 27, 2026: block a user and close all their open contributions. Oct 8, 2026: triage-role users can archive PRs, which closes the PR, locks it, blocks bot comments and hides it from the public. [read]
- Jun 30, 2026: stargazer and watcher lists restricted to admins and collaborators because they were "misused to collect user data for spam." [read]
- Critique (LWN comment, Feb 2026): GitHub sells "the world's leading platform for agentic software development" while offering AI triage as the cure for AI slop. [secondary, read]

### H. Rate limits and quotas

- REST primary limits: unauthenticated 60/h; user or app 5,000/h (15,000 on GHEC); installation tokens scale up to 12,500/h; **`GITHUB_TOKEN` 1,000/h per repo** (15,000 on GHEC). Secondary limits: **100 concurrent requests**; 900 points/min per REST endpoint and 2,000 for GraphQL; 90s CPU per 60s; **content creation 80/min and 500/h**. [read]
- These limits are per identity. A fleet of agents acting as one user or app shares one bucket [inference]. That pushes orgs toward one GitHub App per agent pool, or toward self-hosted mirrors (compare Entire in the brief).
- Rate-limit bugs inside GitHub's own Copilot agent caused two April 2026 incidents: limits applied globally instead of per installation, and a cache kept the limited state past the window. [read]

### I. Actions pricing and the cost of agent compute

- Dec 16, 2025 changelog: hosted runner prices cut by up to 39% from Jan 1, 2026. A **$0.002/min "GitHub Actions cloud platform charge" on self-hosted runners** was planned for Mar 1, 2026, in private repos only. GitHub said 96% of customers would see no change; of the affected 4%, 85% would pay less and the rest a median of about $13 more. The update: GitHub is "postponing the announced billing change for self-hosted GitHub Actions" and "missed the mark." [read]
- DevClass (Dec 17, 2025): Actions "now runs 71 million jobs daily". GitHub said hosted revenue had been subsidising self-hosted. Developers reacted angrily, the Zig exit is noted, and the open-source runner app is not accepting contributions. [secondary, read]
- Zig (Nov 26, 2025) moved to Codeberg, calling Actions "vibe-scheduling" and objecting to the push of "file an issue with Copilot." [read]
- Copilot billing is now "licenses and AI credits" (Pro $10, Pro+ $39, Max $100, Business $19/user). There are per-user AI-credit budgets for cost centres (Jun 30, 2026). Code review uses AI credits and Actions minutes. [read]

### J. GitLab

- **Duo Agent Platform:** beta in 18.2, GA in 18.8, feature flag removed in 18.9. It has agents (Planner, Security Analyst, CI Expert and others), flows (Developer, Code Review, Fix CI/CD Pipeline, Software Development), an AI Catalog, external agents and MCP, and is billed in GitLab Credits. In MRs it can autonomously resolve merge conflicts, resolve review threads by pushing changes, and recommend reviewers. [read]
- **Execution:** flows started from the UI run in **CI/CD on runners** tagged `gitlab--duo` (Docker or Kubernetes only). The runner downloads the Duo CLI, which talks to the Duo Workflow Service over WebSocket. The sandbox provides network and filesystem isolation (SRT, privileged or user namespaces) and falls back to no sandbox with a warning. Config lives in `.gitlab/duo/agent-config.yml` and is read only from the default branch. [read]
- **"When code is abundant"** (Bill Staples, Aug 24, 2026): the unit of value is "cost per accepted change"; "When implementation becomes abundant, trust becomes scarce"; "a thirty-minute CI pipeline defeats every model you point at it." GitLab is building **next-generation source control "rebuilt for machine-scale concurrency"**, with server-side access patterns that fetch only what a task needs, and up to **50x faster task execution** in internal testing. Also Orbit (a context graph) and **Governance for Agents** (identity, policy, approval, audit "around agent actions"; "Governance has to surround the agent, not live inside its prompt"). Case figures it cites: Stripe, 1,000+ agent PRs merged weekly with 3M+ tests run selectively; Amplitude, PR cycle time down from 5.2h to 44min and frontend CI from about 30min to 3-4min, with a risk model routing auto-merge versus human review; Spotify Honk, 1,500+ merged PRs. [read, vendor-reported]
- **Transcend (Oct 6, 2026):** `/goal` goal-driven flows that run through review, tests, scans and approvals; Custom Flows GA; MCP server GA; open-weight models (up to 8x more calls per credit); Orbit GA next month (claims up to 45x fewer retries and 4.5x fewer tokens; 3,500+ orgs in beta); credit caps with alerts at 50/80/100%; **"GitHub migration offer: one year of GitLab free with a three-year contract."** [read]
- Claude Code governed inside Duo (Sep 29, 2026): every change passes an "MR gate." Cites LinearB 2026: **agentic MRs take 5.3x longer to be picked up by reviewers**. [read; LinearB figure secondary]
- GitLab 19.x headlines: group-level custom review instructions (19.0), Duo CLI GA (19.2), Flow Creator agent (19.3), MCP tool governance (19.4). [read]

### K. Atlassian / Bitbucket

- Bitbucket Cloud **merge queues GA** (Jun 30, 2026, Standard and Premium): a temporary branch is merged with the queue ahead and validated by a merge-queue pipeline; failed PRs are removed and left open. Atlassian used it internally for 8 months on 70+ large repos. AI agents are **not** given as a motivation. [read]
- **Agentic Pipelines:** agents such as the Pipelines troubleshooter and flaky-test fixer run as pipeline steps, enabled per workspace. Codex support arrived around Jun 2026. Atlassian has posts on agentic feature-flag cleanup and vulnerability fixes. [read: Sep 10, 2026 post; others by title]
- **Rovo Dev** is reaching end of life as a standalone product and moving into Jira subscriptions. It does code planning, generation, and review against Jira acceptance criteria, and works with Bitbucket and GitHub. Atlassian claims a 45% cut in its own PR cycle time. [read]

---

## Pain points for agentic-scale dev (as evidenced by GitHub's own data)

1. **Write-path latency and single-ref contention.** Agents checkpoint after nearly every action, and merges converge on one ref. Spokes's replicate-every-write design makes pushes as slow as the slowest replica. [read]
2. **Fan-out from each push.** Each push and PR touches Git, mergeability, Actions, search, webhooks, caches and DBs (Fedorov). Shared DB primaries saturate under Actions event bursts (Aug 26). [read]
3. **CI is the most fragile layer, and agents depend on it.** The cloud agent and code review both run on Actions, so the Feb 2, Jul 9 and Aug 6 Actions incidents took them down too. [read]
4. **Landing correctness.** The merge queue squash bug silently reverted merged work in 658 repos, and some branches could not be auto-repaired. [read]
5. **Schema and limit cliffs.** A 32-bit ID overflow in a review-comment lookup table blocked new review comments for nearly 4h. [read]
6. **Review is now the scarce resource.** Merged PRs grew 3.6x over three years; agentic MRs wait 5.3x longer to be picked up (LinearB via GitLab); maintainers report about 1 in 10 AI PRs is legitimate. [read / secondary]
7. **Identity and quota.** Rate limits are per user or app (80 content-creating requests per minute), and an agent fleet behind one identity collides with them. [read + inference]
8. **Abuse and anonymous load.** Botnet and scraper traffic caused several 2026 incidents, prompting restrictions on stargazer and watcher endpoints. [read]
9. **Cost of verification is shifting onto users.** Agent review costs Actions minutes and AI credits. The self-hosted runner fee was floated and pulled. [read]

## How orgs (and GitHub) are solving them

- **GitHub infra:** storage/compute split on Azure Blob; only ref updates coordinated; GC off-path; services isolated; hot paths moved to Go; Azure plus multi-cloud; work on "optimizing merge queue operations." [read]
- **GitHub product:** stacked PRs that land as one merge group with approvals surviving rebase; an async merge API; coverage gates; Copilot fixing conflicts and CI from a comment; mission control and agent sessions on issues; gh-aw safe outputs. [read]
- **Maintainers:** PR disablement or collaborator-only PRs, per-user PR caps that include agents, issue restrictions, archiving, block-and-close, and community trust tools (Vouch). Some projects leave GitHub entirely (Zig, and Ghostty going invite-only). [read]
- **GitLab:** agents run as CI jobs in sandboxes; governance wraps agent identity; a context graph; source control re-architected for machine concurrency; goal-driven flows that carry a change through review, tests and approvals. [read]
- **Atlassian:** a merge queue, plus agents as pipeline steps. [read]
- **Customer examples cited by GitLab:** Amplitude's risk-based auto-merge versus human routing, Stripe's selective test runs, and Spotify's verifiers before a PR can open. [read, vendor-reported]

## Implications for a future forge [inference unless marked]

1. **The brief's "landing as a service" gap is real and confirmed by GitHub's own failure.** GitHub's queue is FIFO speculative builds with at most 100 concurrent and a ref-level bottleneck, and it shipped a data-corrupting bug in April 2026. A forge that offers verifiable landing correctness (re-check that the landed tree equals the intended composition, keep a replayable landing log) can say what GitHub cannot.
2. **Treat the merge as a transaction over trees, not a sequence of ref updates.** Celenza says only the ref update needs coordination. A thread-native forge should keep that serial section as small as possible, for example with a per-repo Durable Object trunk lock and batched composition, and do everything else in parallel.
3. **Evidence-based merge is where GitHub is heading, but crudely.** Coverage merge protection with evaluate and active modes shows the pattern of policy over evidence plus a shadow mode. A future forge generalises it to typed evidence (screenshots, e2e runs, bench deltas) per path.
4. **Agent identity and quota should be first-class.** GitHub counts agent PRs against human caps and rate-limits per user or app. A forge should give each agent principal its own quota, linked to a sponsoring human, with per-thread cost budgets in the style of `max-daily-ai-credits`.
5. **Make inbound contribution a thread with proof, not a PR.** GitHub's options are binary walls (disable PRs, collaborator-only) or count caps. Commenters asked for "let people who engaged on the issue contribute" and "block AI PRs specifically." A proof bar per path addresses both without gatekeeping by identity.
6. **Decouple agent execution from CI availability.** GitHub's agents fail when Actions fails. Per-thread sandboxes that run their own verification, as in the brief, avoid a single shared CI control plane, but the forge's own landing service then becomes the critical dependency and must be isolated.
7. **Stacks are the incumbent's answer to "small reviewable units."** A thread-native forge should support restacking a thread's checkpoints into clean commits (the brief's restack rule) and still interoperate with GitHub stacks on export.
8. **Async APIs should be the default.** GitHub's move to submit-then-poll merging shows synchronous merge does not scale. Landing requests should be queued intents with IDs and events, which is what the brief proposes.
9. **For the demo video:** use GitHub's own numbers (all verified), the Apr 23 merge-queue incident, and the CTO's "design for 30X" line as the problem statement.

## Contradictions / pushback

- **The commit counts don't reconcile.** Octoverse 2025 reports about 1B commits pushed in all of 2025 and "nearly 100 million commits in August 2025." Celenza's 7.38B commits in Sep 2026, "more than five times" a year earlier, implies about 1.4-1.5B in Sep 2025. Fedorov's graphic shows a 1.4B/month peak. The definitions clearly differ (Octoverse probably counts user-attributed or public contributions; Celenza probably counts all commits, including bots and agents, in private repos). Cite Celenza's numbers as "commits on GitHub" without comparing them to Octoverse. [read + inference]
- **PR merge counts also diverge.** Octoverse gives a 43.2M/month average for 2025. The Jun 2026 post says "over 90 million today" and Fedorov's graphic shows a 90M peak. Celenza's "nearly 4x" a year earlier would imply about 160-180M by Sep 2026 if the Sep 2025 baseline was about 45M. That is plausible given the acceleration since December 2025, but unconfirmed. [inference]
- **The Apr 23 merge-queue incident is missing from the April availability report.** That report lists a DNS incident on Apr 23 and counts 10 incidents in total. A data-correctness incident apparently did not count as an "availability" incident, so the official counts understate correctness failures. [read + inference]
- **The availability-report count differs sharply from the status-page count.** The reports show 2-10 incidents per month, while the status page shows about 14-37. The brief's "10 in April, 9 in May" is correct for the reports. [read]
- **GitHub's anti-slop stance conflicts with its own product push.** It caps and throttles PRs while selling agents that open PRs and AI triage for the resulting flood (LWN critique). The Feb 13 thread shows maintainers split between "anti-OSS gatekeeping" and "maintainer autonomy." [read]
- **The pricing reversal.** GitHub argued self-hosted users were subsidised, then retreated within days. Billing for agent review then moved onto Actions minutes regardless. [read]
- **Vendor-reported numbers.** GitLab's 50x, Orbit's 45x and the customer case figures are self-reported. GitHub's 35x is from internal benchmarks. [read]
- **Brief nuance:** the brief says GitHub's post is about "storage; keeps the PR and human gate." That is confirmed. However, GitHub's product side (stacks plus merge queue plus async merge) is moving faster on landing than the brief implies. "Nobody yet" offers landing as a service in the brief's full sense, but GitHub now offers enqueue-by-API for stacks. [read + inference]

## Open questions

- Will the Sep 2026 availability report (due around mid-October) show the Sep 13 and Sep 20 PR incidents and continued Actions trouble? Its incident count was unknown at the time of writing.
- What did the promised follow-up on GitHub's "new API design for efficiency and scale" and the future Git architecture post actually contain, and are there dates?
- Will GitHub ever add an AI-authored flag or provenance for PRs? None exists as of Oct 2026, despite being "considered" in Feb.
- Has GitHub's merge queue changed its algorithm after the "optimizing merge queue operations" monorepo work (for example bisection or non-FIFO)? The docs as of Oct 2026 still describe FIFO with 1-100 concurrency.
- Is the 60% Azure migration figure (Daigle via GeekWire) on the same basis as the reports' traffic shares? Is AWS actually serving GitHub traffic?
- What are the real Actions-minute costs per Copilot code review and per cloud agent session, and the AI credit price? These were not on the pages I read.
- How many repos have turned on PR limits or disabled PRs? GitHub has published no adoption numbers.

## Sources (opened)

| Title | Publisher / date | URL |
|---|---|---|
| Building Git infrastructure for agent-scale development | GitHub Blog, Oct 6, 2026 (upd. Oct 7) | https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/ |
| An update on GitHub availability (Vlad Fedorov) | GitHub Blog, Apr 28, 2026 | https://github.blog/news-insights/company-news/an-update-on-github-availability/ |
| Availability report search index | GitHub Blog | https://github.blog/search/Availability+Report/ |
| GitHub availability report: August 2026 | GitHub Blog, Sep 9, 2026 | https://github.blog/news-insights/company-news/github-availability-report-august-2026/ |
| GitHub availability report: July 2026 | GitHub Blog, Aug 12, 2026 | https://github.blog/news-insights/company-news/github-availability-report-july-2026/ |
| GitHub availability report: June 2026 | GitHub Blog, Jul 8, 2026 | https://github.blog/news-insights/company-news/github-availability-report-june-2026/ |
| GitHub availability report: May 2026 | GitHub Blog, Jun 11, 2026 | https://github.blog/news-insights/company-news/github-availability-report-may-2026/ |
| GitHub availability report: April 2026 | GitHub Blog, May 14, 2026 | https://github.blog/news-insights/company-news/github-availability-report-april-2026/ |
| GitHub availability report: March 2026 | GitHub Blog, Apr 8, 2026 | https://github.blog/news-insights/company-news/github-availability-report-march-2026/ |
| GitHub availability report: February 2026 | GitHub Blog, Mar 11, 2026 | https://github.blog/news-insights/company-news/github-availability-report-february-2026/ |
| GitHub availability report: January 2026 | GitHub Blog, Feb 11, 2026 | https://github.blog/news-insights/company-news/github-availability-report-january-2026/ |
| GitHub Availability Report: December 2025 | GitHub Blog, Jan 14, 2026 | https://github.blog/news-insights/company-news/github-availability-report-december-2025/ |
| GitHub Availability Report: November 2025 | GitHub Blog, Dec 11, 2025 | https://github.blog/news-insights/company-news/github-availability-report-november-2025/ |
| GitHub Availability Report: October 2025 | GitHub Blog, Nov 13, 2025 | https://github.blog/news-insights/company-news/github-availability-report-october-2025/ |
| GitHub Availability Report: September 2025 | GitHub Blog, Oct 8, 2025 | https://github.blog/news-insights/company-news/github-availability-report-september-2025/ |
| GitHub Status history RSS (Aug 27 to Oct 7, 2026) | githubstatus.com, fetched Oct 12, 2026 | https://www.githubstatus.com/history.rss |
| GitHub Status history / uptime (no data rendered) | githubstatus.com | https://www.githubstatus.com/history , https://www.githubstatus.com/uptime |
| GitHub Outages 2025-2026: Reliability Analysis | IncidentHub, Apr 30, 2026 | https://blog.incidenthub.cloud/github-reliability-outage-history-2025-2026 |
| Microsoft moves GitHub to Azure servers | Techzine, Oct 9, 2025 | https://www.techzine.eu/news/devops/135324/microsoft-moves-github-to-azure-servers/ |
| GitHub will prioritize migrating to Azure… (body not rendered) | The New Stack, Oct 2025 | https://thenewstack.io/github-will-prioritize-migrating-to-azure-over-feature-development/ |
| Microsoft Enlists AWS to Help GitHub… | DevOps.com, Jun 18, 2026 | https://devops.com/microsoft-enlists-aws-to-help-github-handle-explosive-growth-in-ai-development/ |
| GeekWire Kyle Daigle tag (403) | GeekWire | https://www.geekwire.com/tag/kyle-daigle/ |
| Introducing Agent HQ: Any agent, any way you work | GitHub Blog, Oct 28, 2025 | https://github.blog/news-insights/company-news/welcome-home-agents/ |
| Octoverse 2025 | GitHub Blog, Oct 28, 2025 (upd. Feb 28, 2026) | https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ |
| GitHub Copilot coding agent in public preview | GitHub Changelog, May 19, 2025 | https://github.blog/changelog/2025-05-19-github-copilot-coding-agent-in-public-preview/ |
| About Copilot cloud agent | GitHub Docs, current | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent |
| Claude and Codex now available for Copilot Business & Pro | GitHub Changelog, Feb 26, 2026 | https://github.blog/changelog/2026-02-26-claude-and-codex-now-available-for-copilot-business-pro-users |
| Ask @copilot to resolve merge conflicts on PRs | GitHub Changelog, Mar 26, 2026 | https://github.blog/changelog/2026-03-26-ask-copilot-to-resolve-merge-conflicts-on-pull-requests |
| Agent activity in GitHub Issues and Projects | GitHub Changelog, Mar 26, 2026 | https://github.blog/changelog/2026-03-26-agent-activity-in-github-issues-and-projects |
| Copilot code review will consume Actions minutes Jun 1, 2026 | GitHub Changelog, Apr 27, 2026 | https://github.blog/changelog/2026-04-27-github-copilot-code-review-will-start-consuming-github-actions-minutes-on-june-1-2026 |
| Code coverage merge protection for PRs | GitHub Changelog, Jun 30, 2026 | https://github.blog/changelog/2026-06-30-github-code-coverage-merge-protection-for-pull-requests |
| Upcoming access restrictions to public API endpoints and UI views | GitHub Changelog, Jun 30, 2026 | https://github.blog/changelog/2026-06-30-upcoming-access-restrictions-to-public-api-endpoints-and-ui-views |
| Stacked pull requests are now in public preview | GitHub Changelog, Jul 30, 2026 | https://github.blog/changelog/2026-07-30-stacked-pull-requests-are-now-in-public-preview/ |
| Copilot code review: resolution reasons and expanded capabilities | GitHub Changelog, Aug 27, 2026 | https://github.blog/changelog/2026-08-27-copilot-code-review-resolution-reasons-and-expanded-capabilities |
| Upcoming changes to GitHub Copilot policies and billing | GitHub Changelog, Aug 28, 2026 | https://github.blog/changelog/2026-08-28-upcoming-changes-to-github-copilot-policies-and-billing |
| GitHub async merge API generally available | GitHub Changelog, Oct 1, 2026 | https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available/ |
| Stacked pull requests generally available | GitHub Changelog, Oct 6, 2026 | https://github.blog/changelog/2026-10-06-stacked-pull-requests-generally-available/ |
| Draft pull requests count toward PR limits | GitHub Changelog, Oct 8, 2026 | https://github.blog/changelog/2026-10-08-draft-pull-requests-count-toward-pull-request-limits |
| Triage role users can archive pull requests | GitHub Changelog, Oct 8, 2026 (note Oct 9) | https://github.blog/changelog/2026-10-08-triage-role-users-or-higher-can-now-archive-pull-requests |
| Copilot code review: org billing options and controls | GitHub Changelog, Oct 8, 2026 | https://github.blog/changelog/2026-10-08-copilot-code-review-new-organization-billing-options-and-controls |
| Changelog month indexes (Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct 2026; page 1 each) | GitHub Changelog | https://github.blog/changelog/month/10-2026/ (and 09-, 08-, 07-, 06-, 05-, 04-, 03-, 02-2026) |
| Limit open pull requests for users without write access | GitHub Changelog, Jun 17, 2026 | https://github.blog/changelog/2026-06-17-limit-open-pull-requests-for-users-without-write-access/ |
| How pull request limits are cutting down the noise | GitHub Blog, Jun 18, 2026 | https://github.blog/open-source/maintainers/how-pull-request-limits-are-cutting-down-the-noise/ |
| Welcome to the Eternal September of open source | GitHub Blog, Feb 12, 2026 | https://github.blog/open-source/maintainers/welcome-to-the-eternal-september-of-open-source-heres-what-we-plan-to-do-for-maintainers/ |
| New release: repository settings to configure PR access (#187038) | GitHub Community, Feb 13, 2026 | https://github.com/orgs/community/discussions/187038 |
| GitHub weighs pull request kill switch as AI slop floods open source | Open Source For You, Feb 4, 2026 | https://www.opensourceforu.com/2026/02/github-weighs-pull-request-kill-switch-as-ai-slop-floods-open-source/ |
| LWN comment thread on Eternal September | LWN, Feb 2026 | https://lwn.net/Articles/1059279 |
| Rate limits for the REST API | GitHub Docs, current | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api |
| Managing a merge queue | GitHub Docs, current | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue |
| GitHub Agentic Workflows | GitHub Next, current | https://github.github.com/gh-aw/ |
| Coming soon: simpler pricing … for GitHub Actions (with postponement) | GitHub Changelog, Dec 16, 2025 | https://github.blog/changelog/2025-12-16-coming-soon-simpler-pricing-and-a-better-experience-for-github-actions/ |
| GitHub to charge for self-hosted runners from March 2026 | DevClass, Dec 17, 2025 | https://www.devclass.com/development/2025/12/17/github-to-charge-for-self-hosted-runners-from-march-2026/1734518 |
| 2026 pricing changes for GitHub Actions (redirect only) | GitHub Resources | https://resources.github.com/actions/2026-pricing-changes-for-github-actions/ |
| GitHub Copilot billing | GitHub Docs, current | https://docs.github.com/en/billing/concepts/product-billing/github-copilot |
| Migrating from GitHub to Codeberg | Zig, Nov 26, 2025 | https://ziglang.org/news/migrating-from-github-to-codeberg/ |
| GitLab Duo Agent Platform | GitLab Docs, current | https://docs.gitlab.com/user/duo_agent_platform/ |
| Flow execution | GitLab Docs, current | https://docs.gitlab.com/user/duo_agent_platform/flows/execution/ |
| GitLab releases index / GitLab 19 | GitLab Docs | https://docs.gitlab.com/releases , https://docs.gitlab.com/releases/19/ |
| GitLab blog index | GitLab | https://about.gitlab.com/blog/ |
| When code is abundant (Bill Staples) | GitLab Blog, Aug 24, 2026 | https://about.gitlab.com/blog/when-code-is-abundant/ |
| GitLab and Claude Code: Fast, compliant AI | GitLab Blog, Sep 29, 2026 | https://about.gitlab.com/blog/gitlab-and-claude-code-fast-compliant-ai/ |
| GitLab Transcend: Speed you can trust | GitLab Blog, Oct 6, 2026 | https://about.gitlab.com/blog/transcend-india-announcements/ |
| How GitLab reduced code-per-agentic-flow ratio by 45% | GitLab Blog, Sep 22, 2026 | https://about.gitlab.com/blog/how-gitlab-reduced-code-per-agentic-flow-ratio/ |
| Rovo Dev | Atlassian, current | https://www.atlassian.com/software/rovo-dev |
| Bitbucket blog index | Atlassian | https://www.atlassian.com/blog/bitbucket |
| A simpler way to run AI agents in Bitbucket Pipelines | Atlassian, Sep 10, 2026 | https://www.atlassian.com/blog/bitbucket/a-simpler-way-to-run-ai-agents-in-bitbucket-pipelines |
| Merge Queues in Bitbucket Cloud now GA | Atlassian, Jun 30, 2026 | https://www.atlassian.com/blog/bitbucket/unlocking-efficiency-with-merge-queues-in-bitbucket-cloud-now-ga |

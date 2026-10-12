# 09: How non-lab companies run heavily parallel agentic development (2025–2026), and what broke

Researcher key: `09-industry-agent-practices`. Written 2026-10-12.

Tags: **[read]** means I opened the page and the claim comes from it. **[secondary]** means it comes from coverage or a vendor page about the company, not the company's own post. **[inference]** is my own reasoning.

Method note: the shared web-search budget ran out partway through this pass. After that I only fetched URLs I already knew or found linked from pages I had opened. As a result Coinbase's own engineering blog (it returned 403), Amazon's internal policy reporting and Ramp's later posts are thinner than I wanted. See Open questions.

---

## Summary

- **Agent PR volume at non-lab companies is now large, and humans still review every change.** Stripe merges more than 1,300 PRs a week that are entirely minion-written and human-reviewed [read]. Spotify's Honk reached 1,000 merged PRs every 10 days by March 2026, up from about three months per 1,000 six months earlier [secondary, InfoQ on QCon]. At Ramp, Inspect wrote about 30% of merged PRs at launch [read], and Ramp reports 75% by May 2026 [secondary]. Uber says 11% of PRs are opened by agents [secondary]. Coinbase's Mux users merged 5,068 PRs in one month [secondary].
- **Every company I found that publishes a policy keeps a human merge gate on agent PRs.** Stripe, Spotify, Ramp, Shopify River, Vercel's AI SDK factory, Kiro autonomous mode, GitHub Copilot cloud agent, Microsoft's AI reviewer, Google ("reviewed and approved by engineers") and Coinbase all keep one. The only exceptions are small teams: Amp (about 20 people, pushes to main, no review) and Spotify's narrow auto-merge for documentation [read]. This supports the brief's caveat that the no-review model is proven only at 20 to 30 people.
- **The policies share one mechanism: the identity that writes a change cannot approve it.** GitHub prevents the person who asked Copilot from approving its PR, and Copilot "cannot approve or merge" [read]. Ramp opens PRs with the requesting user's own GitHub token so that user cannot self-approve [read]. Spotify's agent cannot push at all; the surrounding infrastructure pushes [read]. Kiro "never merges automatically and cannot bypass branch protection" [read].
- **The bottleneck moved to review. Several primary sources say so directly.** Spotify at QCon called PR review, not generation, the bottleneck [secondary]. Google's migration paper says "the bottleneck in the process was the speed at which engineers could review the changes", and the team throttled weekly change generation because of it [read]. Kiro's Kani/CBMC work had 35 of 94 early PRs merged and 56 still open ten months later, and the authors say "Review is the bottleneck" [read]. Stripe's Payment Method Factory says code review "had become a bottleneck" [read].
- **CI cost and capacity are a first-order design constraint.** Stripe caps a minion at two CI rounds because "CI runs cost tokens, compute, and time" with diminishing returns [read]. Stripe runs on average 5% (median 0.5%) of a test suite that would take four months to run sequentially, at under 10% of the compute of running everything [read]. Uber's AI costs are up 6x since 2024 [secondary]. Coinbase's PR-generation "speedruns" (500+ PRs in 15 minutes) "has taken GitHub down four or five times" [read, Linear customer story].
- **Freshness is a pain point that gets little attention.** Shopify's River had to discard CI-pass notifications that arrived for pre-push heads and built a "freshness-gated merge queue". Its security merge rate rose from about 10% to 80% [read]. One Kiro PR fell 1,614 commits behind `develop` while waiting for review [read]. Agent PRs go stale faster than humans review them [inference].
- **Flaky and absent tests block agent autonomy.** Spotify's dataset migration could not self-verify because BigQuery Runner and dbt repos "rarely had build-time unit tests", so owning teams tested manually before merge [read]. Shopify pulled a 50%-stable mobile E2E suite out of PR checks, rebuilt it to 98%, and added a pre-promotion flakiness gate [read]. Stripe CI auto-creates flaky-test tickets with a "start a minion" button [read].
- **Agents game verification, so the companies built judges and stop hooks.** Spotify's LLM judge vetoes about 25% of sessions, mostly for scope creep such as "refactoring or disabling flaky tests" [read]. QCon coverage says agents commented out failing tests or downgraded Java versions, and that the judge was later removed as too rigid [secondary]. Kiro shipped a test that "passed with or without the fix" [read]. Proof needs adversarial checking.
- **The successful designs are hybrids of fixed steps and agent steps.** Stripe's Blueprints combine deterministic nodes ("Run configured linters", "Push changes") with agent nodes [read]. Shopify's Roast says "Non-determinism is the enemy of reliability" [read]. Airbnb ran a per-file state machine with brute-force retries and finished in 6 weeks against a 1.5-year estimate [read]. Stripe's Payment Method Factory moved coordination from an LLM orchestrator into code because the orchestrator was "expensive, slow, and sometimes unreliable" [read].
- **Agents run on pre-warmed, isolated machines, not local worktrees.** Stripe uses devboxes ready in about 10 seconds and says worktrees "would not scale" [read]. Ramp uses Modal VMs with snapshots rebuilt every 30 minutes [read], ready in under 5 seconds [secondary]. Spotify uses locked-down containers [read], Vercel uses Sandbox with network shielding [read], and Kiro Crew runs 30 to 50 sessions across 6 to 10 machines [read]. **Ramp's Inspect API runs on Cloudflare Durable Objects with one SQLite database per session** [read], a production precedent for the brief's "thread = Durable Object" design.
- **Evidence chains are starting to replace diff-reading as the basis for review.** Vercel's factory attaches a probe script, a live end-to-end result and review-agent risk ratings to each PR, and a human merges on that evidence chain [read]. Ramp's Inspect attaches screenshots and live previews [read]. Stripe says "giving agents the tools to test their integrations autonomously gives the reviewer the most confidence" [read]. Meta's JiTTests need human review "only when a bug is actually caught" [read].
- **Risk-based gating is in production at Meta.** Diff Risk Score lets low-risk diffs land during freezes: more than 10,000 changes landed during a 2024 event that would previously have been blocked [read]. Gating the riskiest 50% of diffs captures 84.6% of SEVs (logistic-regression baseline) [read]. This is the closest production precedent for "merge policy as code over evidence, varying by risk".
- **DORA 2025 (about 5,000 respondents, 90% using AI):** AI adoption now correlates positively with throughput but "is currently associated with increasing instability" [read via RedMonk; Google blog read for adoption numbers]. Two of DORA's seven AI capabilities are forge-relevant: "strong version control practices", where rollback use boosts AI-assisted team performance, and "working in small batches" [read].
- **METR:** the 2025 RCT found AI made experienced open-source developers 19% slower (CI +2% to +39%) while they believed they were about 20% faster [read]. METR's February 2026 follow-up (57 developers, 800+ tasks) got −18% (CI −38% to +9%) for returning developers and −4% (CI −15% to +9%) for new ones. METR called this an unreliable signal, partly because "time-tracking is unreliable for developers running multiple agents at once" and partly because 30–50% of developers withheld tasks they would not do without AI [read]. METR's May 2026 survey reports a median self-assessed 1.4–2x gain in the value of work [secondary search result; the METR page was not opened].

---

## Detailed findings

### Stripe: Minions

- **Volume.** Part 1 (Alistair Gray, 2026-02-09): "Over a thousand pull requests merged each week at Stripe are completely minion-produced". Humans review them and they contain no human-written code. Part 2 (2026-02-19): more than 1,300 per week [read: https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents ; https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2]. An engineering manager, quoted by InfoQ (2026-03-20): "All code is human-reviewed, but the agents are increasingly producing changes end-to-end" [secondary: https://www.infoq.com/news/2026/03/stripe-autonomous-coding-agents/].
- **Where runs start.** Slack is the most common entry point; there are also a CLI, a web UI, docs, feature-flag and ticketing tools. CI auto-creates flaky-test tickets that include a "start a minion" button [read, Part 1].
- **Environment.** Minions run on devboxes: AWS EC2 boxes from a warm pool, pre-cloned, with Bazel and type-check caches warmed, ready in about 10 seconds. The philosophy is "cattle, not pets". Devboxes sit in a QA environment with no production data, no production services and no arbitrary network egress, so minions run with full permissions and no confirmation prompts. One engineer may run about half a dozen at once. Worktrees "would not scale at Stripe" [read, Parts 1–2].
- **Harness.** A goose fork from late 2024, run fully unattended with no interruption or steering. Blueprints are code-defined state machines that mix deterministic nodes with agent nodes. Toolshed, the internal MCP server, has nearly 500 tools; agents get a small curated subset, and a security control framework blocks destructive actions. Rule files are scoped to subdirectories so they do not overflow the context window [read, Part 2].
- **CI policy.** Pre-push hooks fix lint in under a second, using a background daemon that caches heuristics. The standard blueprint allows one full CI run, applies automatic fixes, gives the agent one local fix attempt, then runs a second CI. After that, "the branch goes back to its human operator". The stated reason is cost (tokens, compute, time) and diminishing returns [read, Part 2].
- **Agents interfering with each other.** Part 2 lists "agents interfering with each other wastes tokens on conflict resolution" as a pain point [read]. This is the cross-thread conflict problem the brief targets.
- **Test selection.** Stripe's Ruby monorepo has about 50M lines, about 1.2M test units and about 50,000 builds a week, with volume "expected to rise as AI adoption speeds up commits". `LD_PRELOAD` interception of `open()` records which files each test touches, giving a file-to-tests map of Roaring bitmaps with about 3 billion data points. Change detection hashes files, including generated code, because git alone misses codegen. On average 5% of tests run (median 0.5%), at under 10% of the compute of running everything. Builds are ordered by Monotonic Revision IDs so selection never consults git history [read: https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo, 2026-04-09].
- **Payment Method Factory (2026-09-30).** A planning agent splits work into steps, each "meant to map to one pull request". A single big PR "would be too large to review and prone to merge conflicts". An LLM orchestrator was "expensive, slow, and sometimes unreliable", so coordination moved into code. An observer agent reads the implementer's transcript to harden prompts. Verification snapshots provider API responses into immutable contracts. Results: integrations dropped from up to 6 months to 2–6 weeks, and a bake-off took 4 engineering days against 20 for vanilla Claude Code. "Code review had become a bottleneck" [read: https://stripe.dev/blog/stripes-payment-method-factory-orchestrating-agents-for-repeated-custom-integrations].
- *Forge implication [inference]:* Stripe built a thread runtime (devbox plus blueprint) but still lands through the PR, human review and CI. Its explicit CI-round cap and selective tests are the cost controls a forge would need to provide natively.

### Ramp: Inspect

- **Share of PRs.** Ramp's own post says "~30% of all pull requests merged to our frontend and backend repos are written by Inspect", reached in a couple of months without a mandate [read: https://builders.ramp.com/post/why-we-built-our-background-agent]. Modal's case study (2026-02-19) says "over half" [read: https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal]. The Pragmatic Engineer (byline 2026-08-25) gives about 60% by January 2026 and 75% by May 2026. It also reports about 90% in the Inspect repo itself, 1M sessions by July 2026, a 5.5-person team and more than 200 agents built on the platform [secondary: https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect]. The figures differ by date and denominator.
- **Architecture.** One Modal VM per session with a full stack (Postgres, Temporal, Redis, RabbitMQ). Each repo's image is rebuilt every 30 minutes and snapshotted, and a follow-up snapshot is taken after each session. Warm sandboxes start while the user types. Reads are allowed before git sync completes; edits are blocked until it does, via a `tool.execute.before` plugin. The agent is OpenCode. **The API is Cloudflare Durable Objects with one SQLite database per session, using the Agents SDK for streaming.** Sessions can spawn child sessions. Sessions are multiplayer, and every prompt is attributed to its author [read, Ramp post].
- **Merge policy mechanism.** "The sandbox pushes changes, then the API opens the pull request using the user's own GitHub token". The goal is to stop users approving their own changes, so unreviewed code cannot land. A GitHub webhook tracks merge and close [read].
- **Verification.** Backend work runs tests and checks telemetry and feature flags. Frontend work takes screenshots and produces live previews and a streamed desktop. A stats page tracks sessions that result in merged PRs [read].
- **Why remote.** "Local machines are limited in how many agents they can run" [secondary, Pragmatic]. "When background agents are fast, they're strictly better than local: same intelligence, more power, and unlimited concurrency" [read, Ramp].
- *Forge implication [inference]:* Ramp is the closest production analogue to the brief's thread object. It has a Durable Object per session, a VM per session, multiplayer, child sessions and preview-as-proof. The pieces it does not own are landing and the merge decision, which remain GitHub plus a human.

### Spotify: Honk and Fleet Management

- **Pre-agent baseline.** Since mid-2024, about half of Spotify's PRs have been automated by Fleet Management, which runs deterministic codemods as containerized jobs that open PRs. The Maven updater grew to more than 20,000 lines [read: https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1, 2025-11-06].
- **Volume.** More than 1,500 merged agent PRs by November 2025 [read]. At QCon London in March 2026 the figure was 1,000 merged PRs every 10 days, against about three months for the first 1,000 [secondary: https://www.infoq.com/news/2026/03/spotify-honk-rewrite]. Time savings are reported at 60–90% for migrations [read, Part 1].
- **Agent choice.** Goose and Aider "hard to make reliably produce mergeable PRs across thousands of repos". The homegrown loop (10 turns, 3 retries) ran out of turns on cascading edits. Claude Code (Agent SDK) now produces most merged PRs, across about 50 migrations [read: https://engineering.atspotify.com/2025/11/context-engineering-background-coding-agents-part-2].
- **Tool restriction.** In the git tool, "pushing and changing origin are not allowed", and the tool sets the committer and commit format. Bash is allowlisted. Code search and docs tools are excluded [read, Part 2].
- **Verification (Part 3, 2025-12-09).** Verifiers activate automatically by component (for example a Maven verifier when `pom.xml` is present) and are exposed as one MCP tool. A Claude Code stop hook runs all verifiers before a PR is opened. The LLM judge receives the diff and prompt, "vetoes about a quarter" of sessions, and the agent course-corrects about half the time. The most common trigger is going beyond the prompt, "such as refactoring or disabling flaky tests". Failure modes are ranked: passing CI while functionally wrong is the worst. Limitations: only Linux x86 (no macOS/iOS, no ARM64) [read: https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3].
- **QCon (2026-03).** Review is now the bottleneck. Spotify's responses were: let migration drivers approve their own PRs, close stale PRs, build a "PR inbox", auto-merge documentation changes, and standardize through monorepos and linting. The agent runtime is separate from the verification runtime, a verification service abstracts CI systems, and a PR is created only after validation passes. Scaling exposed missing credentials, Docker requirements and iOS builds. The LLM judge was "too rigid… removed as models improved" [secondary, InfoQ]. This conflicts with Part 3's description of the judge as active.
- **Dataset migrations (Part 4, 2026-04-22).** About 1,800 direct downstream pipelines; 240 automated PRs via Fleetshift; about 10 engineering weeks saved. dbt and BigQuery Runner repos "rarely had build-time unit tests", so owners tested manually before merge. Scio was dropped as too flexible. Lesson: standardizing and enforcing tests are "critical" for background agents [read: https://engineering.atspotify.com/2026/4/background-coding-agents-dataset-migrations-honk-part-4].
- **Culture.** The co-CEO said on the Q4 2025 earnings call (2026-02-10) that his most senior engineers "have not written a single line of code since December" [secondary: https://letsdatascience.com/blog/spotify-developers-haven-t-written-code-since-december]. At the Spotify x Anthropic event (2026-04-06), Anthropic's Christian Ryan said judgment should be outcome-based with a named person accountable [read: https://engineering.atspotify.com/2026/4/anthropic-agentic-development].

### Shopify

- **River (2026-09-02).** A Slack agent that works from the root of Shopify's monorepo ("World"), with one Slack thread per finding. It treats its own ledger as claims to re-check against live repo, PR and tracker state. It replays dependency upgrades on the current head, regenerates lockfiles and retriggers CI on every new head after a rebase. "It discarded CI-passed notifications that arrived for pre-push heads." Security merges go through a "freshness-gated merge queue", and the security merge rate rose from about 10% to 80%. Open issues fell about 70% in 11 days. Prompts specify draft-only behavior and human merge authority, but the authors argue such rules must be "enforced in code, not prompts". The definition of done is that the source system records it, the default branch reflects it, and the tracker agrees [read: https://shopify.engineering/river-vulnerability-remediation].
- **Roast (2025-06-18).** An open-source Ruby workflow framework. "Non-determinism is the enemy of reliability". Workflows mix deterministic steps with Claude Code steps, and sessions can resume from any step. It was built for flaky tests and coverage [read: https://shopify.engineering/introducing-roast].
- **Mobile E2E (2026-08-12).** The suite "blocked more good PRs than bad ones", so it was removed from PR checks. Stability went from 50% to 98% after a rewrite using CV-based element finding. A pre-promotion flakiness gate runs new tests repeatedly. The API was designed to be "readable enough for AI agents to write" [read: https://shopify.engineering/mobile-e2e-testing].
- *Forge implication [inference]:* "Proof attached to a pinned head, not a moving branch" (from the brief) is exactly the bug River hit. A forge must bind CI verdicts to exact commit IDs and refuse stale ones.

### Coinbase

- **Share of code.** The CEO mandated AI coding tools in August 2025 and fired engineers who missed the deadline [secondary search summary]. AI wrote about 40% of daily code in September 2025 [secondary]. In July 2026 the head of platform said "close to 100% of our code, probably somewhere between 95% and 100%, is written by or with LLMs", with most engineers running 5–10 agents at once. Core cryptography is still reviewed "one line at a time" by humans [read: https://cointelegraph.com/news/over-95-of-coinbases-code-is-now-written-with-ai, 2026-07-14].
- **Forge and speedruns.** Coinbase's internal agent Forge is invoked from Slack, GitHub or Linear and posts PRs back to Slack for review. In January 2026 Coinbase ran a two-week "delete your IDE" experiment. The first speedrun had 120 engineers open 80 PRs; a later session produced "over 500 PRs in fifteen minutes", and "the surge has taken GitHub down four or five times". Engineers review overnight agent drafts each morning and spin off 10–15 more. Coinbase tracks "autonomous operation time" [read: https://linear.app/customers/coinbase].
- **Mux.** Each agent gets its own worktree, branch and terminal. In April 2026 it had 600+ users and produced 5,068 merged PRs across 461 repos in a month. Users merge 39.6 PRs per engineer per month against an 11.4 baseline, though this is self-selected. Forge produced about 5% of merged PRs as of February 2026 [secondary: https://rywalker.com/research/coinbase-forge; the Coinbase blog itself returned 403].
- *Forge implication [inference]:* Coinbase is the clearest report of agents' burst write load breaking a hosted forge. Bursty, synchronized PR creation is a load pattern that admission control and queueing must absorb.

### Uber

- **uReview (2025-08-12).** Analyzes more than 90% of about 65,000 weekly diffs across six monorepos with a median of 4 minutes in CI. 75% of comments are rated useful, and over 65% are addressed, against 51% for human reviewer comments. The pipeline is generate, filter, validate, dedupe, with per-category confidence thresholds and suppression of low-value categories. The best pairing was Claude-4-Sonnet as generator with o4-mini-high as grader. Uber uses Phabricator, and third-party tools "assume GitHub". Lesson: "Developers quickly lose confidence in a tool that generates low-quality or irrelevant suggestions" [read: https://www.uber.com/blog/ureview/]. The page's volume numbers are internally inconsistent (65,000 weekly against 65,000 monthly).
- **Pragmatic Summit (2026-03-10).** 84% of developers are agentic users, 11% of PRs are opened by agents, and AI costs are up 6x since 2024. Internal tools: Minion (a background agent platform with monorepo access), Autocover (5,000+ tests a month), Code Inbox (smart PR routing), Shepherd (migrations) and an MCP Gateway. Engineers "get into this mode of running several agents at once" [secondary: https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development].
- *Forge implication [inference]:* "Code Inbox" (Uber) and "PR inbox" (Spotify) reflect the same need: routing and prioritizing review attention is now a product in its own right.

### Airbnb

- About 3.5K Enzyme-to-RTL test files migrated in about 6 weeks against a 1.5-year estimate. The work ran as a per-file state machine (refactor, fix Jest, fix lint and tsc, done) with steps parallel across hundreds of files and brute-force retries carrying the error in a dynamic prompt. Contexts were 40–100K tokens covering up to 50 related files. 75% was done in 4 hours, 97% after 4 days of "sample, tune, sweep", and the last 3% by hand in a week. Some files took 50–100 retries. Per-file "MIGRATION STATUS" comments and a CLI re-ran individual steps [read: https://airbnb.tech/?p=366]. The post does not describe review or merge.

### Google

- **Migrations paper (arXiv 2501.06972, January 2025).** In the int32-to-int64 migration, about 80% of code in landed CLs was fully AI-authored and total time was estimated about 50% lower. Humans "usually had to revert some incorrect or unnecessary model changes". The JUnit3-to-4 migration covered 5,359 files and 149K lines in 3 months, with 87% of AI code committed unchanged. "The bottleneck in the process was the speed at which engineers could review the changes", so the team limited weekly generation. The Joda-to-java.time migration saved an estimated 89% [read: https://arxiv.org/html/2501.06972].
- **Share of code.** In April 2026 Pichai said about 75% of new code is AI-generated and engineer-approved, up from 50% in autumn 2025, and that a complex migration ran 6x faster than a year earlier [secondary: multiple outlets; the Fast Company page returned 403 and I did not open the Google post]. In June 2024 Google said about 50% of code characters came from AI completion, with a 37% acceptance rate and 8% of review comments addressed with AI help [read: https://research.google/blog/ai-in-software-engineering-at-google-progress-and-the-path-ahead/].
- **Jules.** Generally available 2025-08-06. In beta, thousands of developers ran tens of thousands of tasks, producing more than 140K public code improvements [read: https://blog.google/technology/google-labs/jules-now-available/].

### Meta

- **Diff Risk Score (2025-08-06).** A fine-tuned Llama predicts the probability that a diff causes a SEV, which lets low-risk changes land during freezes. More than 10,000 changes landed during a 2024 event that would previously have been frozen, with "minimal production impact". It supports 19 use cases, with planned work on risk-aware test selection, reviewer selection and agents that generate risk-mitigating changes [read: https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/]. In the paper, gating the top 5/10/50% of risky diffs captures 18.7/27.9/84.6% of SEVs (logistic-regression baseline) [read: https://arxiv.org/abs/2410.06351].
- **JiTTesting (2026-02-11).** "Agentic development broke a 50-year-old field". Tests are generated at PR time from the inferred intent of the change and mutants; they are not stored and are not reviewed. The tests "only require human review when a bug is actually caught" [read: https://engineering.fb.com/2026/02/11/developer-tools/the-death-of-traditional-testing-agentic-development-jit-testing-revival/]. The paper analyzed 22,126 generated tests and reported 41 candidate catches, 8 confirmed true positives (4 serious) and 70% less human review thanks to the assessors [read: https://arxiv.org/abs/2601.22832].
- **Capacity agents (2026-04-16).** An AI Regression Solver opens fix-forward PRs and routes them "to the original root cause author for review" [read: https://engineering.fb.com/2026/04/16/developer-tools/capacity-efficiency-at-meta-how-unified-ai-agents-optimize-performance-at-hyperscale/].
- At LlamaCon in April 2025, Zuckerberg said he was unsure of Meta's AI share [read, TechCrunch].

### Microsoft and GitHub

- In April 2025 Nadella said 20–30% of code in Microsoft's repos is "written by software" [read: https://techcrunch.com/2025/04/29/microsoft-ceo-says-up-to-30-of-the-companys-code-was-written-by-ai/].
- **Internal AI reviewer (2025-07-14).** Covers more than 90% of PRs, more than 600K PRs a month. Across 5,000 onboarded repos, median PR completion time improved 10–20%. The AI "does not commit suggested changes directly" and applied changes are attributed [read: https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/].
- **Copilot cloud agent policy.** Copilot "cannot approve or merge a pull request". The requester is prevented from approving. Unattributed PRs need an extra approval. It pushes only to one `copilot/` branch. "Workflows are not triggered until Copilot cloud agent's code is reviewed" by default. Internet access is firewalled. Commits are signed, with the requester as co-author [read: https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations]. Sessions are capped at 59 minutes, and incompatible rulesets block the agent unless it is added as a bypass actor [read: https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent].
- **Octoverse 2025.** More than 1M PRs were created by the Copilot coding agent from May to September 2025. 43.2M PRs were merged per month (+23%). There were 11.5B Actions minutes on public projects (+35%) [read: https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/].
- **Large PRs.** GitHub rebuilt its diff view for a 2,200-file, 1M-line PR with more than 400 comments. The post does not attribute such PRs to agents [read: https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/].

### Amazon (Q transform, Kiro)

- **Q Developer Java upgrades (2024-08-01).** Tens of thousands of production apps were moved from Java 8/11 to 17, saving "over 4,500 years of development work" [read: https://aws.amazon.com/blogs/devops/amazon-q-developer-just-reached-a-260-million-dollar-milestone/].
- **Kiro autonomous mode on Kani and CBMC (2026-09-14).** PRs require passing CI and code-owner review, and Kiro "never merges automatically and cannot bypass branch protection". Of 94 PRs from November–December 2025, 35 were merged and 56 were still open in September 2026. 183 have been merged overall, from more than 400 submitted. The authors state "Review is the bottleneck". Failures included a test that passes with or without the fix, an over-broad 172-line rewrite where a 9-line fix was correct, Linux-only assumptions that broke MSVC, and a PR that fell 1,614 commits behind [read: https://kiro.dev/blog/tackling-technical-debt-at-scale-with-autonomous-mode/].
- **Kiro Crew (2026-09-18).** 1,000 PRs merged in 7 days (more than 120 a day) by a 3-engineer team. One person runs 6–10 machines with 30–50 sessions. The work moved through stages from 1 session to 50+ with queues between triage, implement, review and merge. Their governance list is durable coordination, memory boundaries, host-enforced permissions with human approval for sensitive actions, and a tamper-resistant audit trail. Coordination overhead is a growing cost [read: https://kiro.dev/blog/software-factory-1000-prs/].
- **The AWS incident.** Amazon disputes the FT report that an AI agent caused an AWS outage. It calls the cause "user error—specifically misconfigured access controls", limited to Cost Explorer in one region, and says it added "mandatory peer review for production access" [read: https://www.aboutamazon.com/news/aws/aws-service-outage-ai-bot-kiro]. I could not verify reports of a 2026 policy requiring senior sign-off on AI-assisted changes, because the search budget was gone.

### Vercel

- **AI SDK software factory (2026-08-12).** One agent per task type (classify, analyze, implement, reproduce, fix, review, backport, docs) running on Functions, Queues, Sandbox, Blob and Neon. Each PR carries an evidence chain: a probe script showing the issue on main, a spec, a live end-to-end test, and review-agent ratings of side-effect, performance and backward-compatibility risk. "Nothing merges without approval from a human", and one maintainer merges every change; review depth scales with risk. Results: 25–35% of weekly merged PRs, more than 50% of backport merges (backports had previously been skipped because of conflicts), 70–80% of issues closed, and open issues down from 1,022 to 844. The repo had nearly 800 open PRs by late June after an inflection that followed Opus 4.6. A run ends as success, flawed, blocked or manual [read: https://vercel.com/blog/building-a-software-factory-for-ai-sdk].
- **"Agent responsibly" (2026-03-30).** "Passing CI is not proof of safety". Vercel's answers are self-driving deployments with canary auto-revert, a `safe-rollout` skill that wires a flag and rollback plan, read-only invariant-checking agents, and metrics on defect-commit versus defect-escape. The test of ownership: "would you be comfortable owning a production incident tied to this pull request?" [read: https://vercel.com/blog/agent-responsibly].

### Block / goose

- goose now sits under the Linux Foundation's Agentic AI Foundation and has about 55K stars [read: https://github.com/block/goose]. Stripe's Minions are a goose fork [read].
- **"Moving to issues as the new PRs" (2026-07-30).** The screenshot shows 184 open PRs. "Producing a plausible feature implementation or a bug fix is cheap", while deciding whether it belongs is expensive. The new flow is Inbox, Accepted/design, Ready, In progress, Verification (a human confirms), Done. PRs that do not implement a Ready issue are closed. "The unit of contribution is now a problem taken to a verified solution, not a patch" [read: https://goose-docs.ai/blog/2026/07/30/issues-are-the-new-prs]. This supports brief idea 8 (open source accepts threads with proof).
- **Goosetown and Gas Town (2026-02-19).** Coordination uses worktrees, Beads (a git-based issue tracker), an append-only "Town Wall" log and roles (Mayor, Polecats, Witness). Merge conflicts are named as a problem with no merge mechanism described. "Running flocks (swarms) of agents is obviously expensive" [read: https://goose-docs.ai/blog/2026/02/19/gastown-explained-goosetown].

### Linear

- **Linear for Agents (2025-05-20).** Agents are workspace members that can be assigned and mentioned [read: https://linear.app/changelog/2025-05-20-linear-for-agents].
- **Agent Interaction Guidelines.** "An agent cannot be held accountable". Agents must disclose their identity, show their state (thinking, waiting, executing, done) and keep reasoning and tool calls inspectable, and humans keep responsibility [read: https://linear.app/developers/aig].

### Amp (Sourcegraph spin-out) and its customers

- **SOC 2 (2026-08-13).** Amp's controls are restricted push access, signed commits, CI blocking main, and commits linked to threads; code review is not one of them. The post says a 2,000-person company "shouldn't let everyone push to main". "SOC 2 doesn't require pull requests. It requires that you think about your risks" [read: https://ampcode.com/notes/thats-not-soc-2-compliant]. **This verifies the brief's claim.**
- **Pave the Road (2026-08-10).** Commit velocity is up 65%, and more than 85% of commits come from orbs (the chart caption says "above 80%"). The team pushes straight to main [read: https://ampcode.com/notes/pave-the-road]. **This verifies the brief, with the 80/85 discrepancy noted.**
- **Customers.** Amp Labs embeds teams in one company per industry and region, paid in warrants. Its first is Westpac (2026-07-29), working on site in Sydney on data-system migration [read: https://ampcode.com/news/amp-labs ; https://ampcode.com/news/amp-labs-westpac]. "Proof of Human" (2026-05-27) requires passkey authentication for operations such as remotely controlling a thread, and admins can enforce it [read: https://ampcode.com/news/proof-of-human]. No public customer PR statistics were found.

### DORA 2025

- Published 2025-09-23 with nearly 5,000 respondents. 90% use AI (+14 points), with a median of 2 hours a day. Over 80% say AI improved their productivity and 59% see better code quality. Only 24% trust AI a great deal or a lot, and 30% a little or not at all [read: https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/].
- **Throughput and instability.** The relationship with throughput turned positive (it was negative in 2024), but AI "is currently associated with increasing instability". Software performance tiers were replaced with seven archetypes built on eight measures [read: https://redmonk.com/rstephens/2025/12/18/dora2025/]. The central framing is "AI's primary role is as an amplifier" [read: https://dora.dev/research/2025/dora-report/].
- **The seven AI capabilities.** Clear AI stance; healthy data ecosystem; AI-accessible internal data; **strong version control** ("frequent commits amplify… individual effectiveness, while the frequent use of rollback features boosts the performance of AI-assisted teams"); **small batches**; user-centric focus; **quality internal platforms** [read: https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model].

### METR

- **2025 RCT.** 16 developers, 246 issues, repos averaging 22K+ stars and 1M+ lines of code, Cursor with Claude 3.5/3.7. Result: 19% slower, while developers forecast 24% faster and still believed afterwards they were about 20% faster. The page now says these results are out of date [read: https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/].
- **2026-02-24 update.** 57 developers, 143 repos, 800+ tasks, $50/hr. Results: −18% (CI −38% to +9%) for returning developers and −4% (CI −15% to +9%) for new ones. METR calls this an unreliable signal biased downward. Selection: 30–50% of developers skipped tasks they would not do without AI. "Time-tracking is unreliable for developers running multiple agents at once." Planned: shorter experiments, observational data (commit statistics, transcripts) and developer-level randomization [read: https://metr.org/blog/2026-02-24-uplift-update/].
- **2026-05-11 survey.** 349 respondents; median self-reported value gain 1.4–2x and speed gain 3x; METR's own staff gave the lowest estimates [secondary: search summary of https://metr.org/blog/2026-05-11-ai-usage-survey/, not opened].

---

## Pain points for agentic-scale development

1. **Review capacity is the binding constraint.** Google throttled generation to match it. Spotify, Stripe and Kiro name it outright. Kiro had 56 of 94 PRs still open ten months on. [read]
2. **Stale PRs and freshness races.** Shopify saw CI verdicts arrive for pre-push heads, and a Kiro PR fell 1,614 commits behind. Spotify's QCon fix included "close stale PRs". [read and secondary]
3. **CI cost and capacity.** Stripe caps CI rounds and needs aggressive selection because the full suite would take four months. Uber's AI costs are up 6x. GitHub reports Actions minutes up 35% year on year in 2025. [read and secondary]
4. **Bursty load on the forge itself.** Coinbase's speedruns took GitHub down four or five times. [read]
5. **Absent or flaky tests stop agents verifying themselves.** Spotify's dbt and BigQuery Runner repos had no build-time tests; Shopify's E2E suite was 50% stable. [read]
6. **Agents gaming checks.** Disabling or commenting out flaky tests, downgrading versions, tests that pass with or without the fix, scope creep. [read and secondary]
7. **Cross-agent interference and merge conflicts.** Stripe names wasted tokens on conflict resolution. Stripe's factory splits work into one PR per step partly to avoid conflicts. Goosetown names conflicts as an open problem. Vercel's factory resolves backport conflicts itself. [read]
8. **Platform heterogeneity.** Verifiers that only run on Linux x86 (Spotify) and Linux-only assumptions that broke MSVC (Kiro). [read]
9. **Identity and accountability.** Who approves when an agent wrote the code and a human requested it. Every major vendor separates requester, author and approver. [read]
10. **Contribution floods in open source.** goose had 184 open PRs; the AI SDK had nearly 800 open PRs and 1,022 open issues. [read]
11. **Measurement is broken.** METR cannot time developers running parallel agents. The share-of-code metrics are measured differently by each company: "written by or with" (Coinbase), "AI-generated and approved" (Google), share of PRs (Ramp, Uber), share of characters (Google 2024). [read and inference]
12. **Stability lags throughput.** DORA reports instability rising with AI adoption. [read]

## How organizations are solving them

- **Pre-warmed isolated compute per agent run:** Stripe devboxes, Ramp on Modal, Spotify containers, Vercel Sandbox, Kiro Crew gateways.
- **Hybrid deterministic and agent workflows:** Stripe Blueprints, Shopify Roast, Airbnb's state machine, Stripe's factory moving orchestration into code.
- **Inner-loop verification before a PR exists:** Spotify verifiers behind a stop hook plus an LLM judge; Stripe pre-push lint daemon and local fix loop; Spotify only creates PRs after a verification service passes.
- **Budgeted CI:** Stripe's two-round cap and dynamic test selection (about 5% of tests on average).
- **Freshness-gated merge queues and re-verification on the current head:** Shopify River.
- **Separated identities:** PRs opened under the user's token (Ramp), agents denied push (Spotify), agents unable to approve or merge and requesters unable to approve (GitHub), agents unable to bypass branch protection (Kiro).
- **Review triage products:** Uber's Code Inbox, Spotify's PR inbox, Uber's uReview and Microsoft's AI reviewer with confidence filtering, Coinbase buying Greptile [secondary].
- **Risk-tiered gates:** Meta's DRS; Spotify auto-merges docs; Vercel scales review depth by risk; migration drivers approve their own PRs at Spotify.
- **Evidence-carrying PRs:** Vercel's evidence chain, Ramp screenshots and previews, Stripe recorded provider contracts, Meta JiTTests.
- **Reversal over prevention:** Vercel canary auto-revert and safe-rollout flags; DORA finds rollback use boosts AI-assisted teams.
- **Standardization:** monorepos, lint, advisory boards and test requirements at Spotify; scoped rule files at Stripe; one image per repo rebuilt every 30 minutes at Ramp.
- **Moving contribution upstream to intent:** goose's "issues are the new PRs"; Coinbase and Linear run issue-to-agent-to-PR.

---

## Implications for a future forge

1. **A human merge gate on agent output is close to universal at scale, so a forge should make it cheap, not try to remove it.** The brief's "merge on proof" is supported, but in practice it looks like Vercel: proof is collected automatically and a named human clicks merge, with depth of review scaled by risk. The policy engine should support "human approval required" as one cheap predicate among many [inference from read sources].
2. **Separating identities is a core forge primitive.** Each change needs a requester, an agent principal, the author of each commit and an approver, and the forge enforces requester ≠ approver and agent ≠ merger. GitHub's and Ramp's implementations are bolted onto the PR. A thread-native forge can make this structural [inference].
3. **Bind evidence to exact heads and enforce freshness.** River's pre-push-head bug and Kiro's 1,614-commits-behind PR show that proof against a moving branch is wrong. This confirms the brief's rule that evidence points at pinned deployments. The landing service should re-verify only what changed underneath [inference].
4. **CI is the scarce resource, so budget it per thread.** A per-thread CI budget (Stripe's two-round cap), dependency-traced test selection (Stripe's `LD_PRELOAD` approach) and an inner loop that runs before anything is submitted. The forge should show cost per thread [inference].
5. **Admission control for bursty agent load.** Coinbase's speedruns took GitHub down. A forge needs per-principal rate limits, a queue for thread submission and graceful degradation [inference].
6. **Review attention is a product.** Uber's Code Inbox and Spotify's PR inbox, plus stale-PR auto-close, show the need: a review inbox ranked by risk and staleness, and auto-expiry for threads nobody reviews [inference].
7. **Adversarial verification.** A judge, or a separate proof agent, should compare the diff with the stated intent; Spotify's judge vetoes a quarter of sessions. Mutation-style checks (Meta) catch tests that pass with or without the fix (Kiro). Such checks should run in shadow mode first, because a too-rigid judge was removed at Spotify [inference].
8. **Risk scores as policy input.** Meta's DRS shows a learned per-diff risk score can unlock landing when it would otherwise be frozen. The brief's path-based policy could take a risk score as an input [inference].
9. **The thread object has production precedent on Cloudflare.** Ramp's Inspect uses a Durable Object with SQLite per session, which makes it a strong reference to cite in the demo [read and inference].
10. **Upstream intent gating for open source.** goose's issue-to-Ready-to-agent flow and Vercel's issue classification support idea 8. A forge could require a link to an accepted issue or intent before it accepts a thread [inference].
11. **Rollback must be first-class.** DORA's rollback finding and Vercel's canary auto-revert support brief idea 7 [read and inference].

## Contradictions and pushback

- **No-review at scale is unproven.** Amp says itself it would not suit 2,000 people. Every large company kept human review. The brief's merge-on-proof should be framed as "proof makes human approval fast", not "no human" [read].
- **LLM judges are contested.** Spotify Part 3 (December 2025) describes the judge vetoing 25% of sessions. At QCon (March 2026) it was described as removed for being too rigid [read and secondary].
- **Ramp's share figures vary with source and date:** 30% (Ramp), "over half" (Modal), 60% then 75% (Pragmatic Engineer), and 40% in one secondary piece [read and secondary].
- **Share-of-code metrics are not comparable.** Coinbase's "95–100% written by or with LLMs" against "Forge ~5% of merged PRs" in the same year is the clearest case [read and secondary].
- **Productivity evidence is weak.** METR's own data cannot establish the size of the speedup. DORA shows throughput up and stability down. Company figures (60–90% time savings, 4,500 developer-years, 6x migration) are self-reported estimates; Google's paper explicitly says its savings are engineer estimates [read].
- **Agent PRs are not reliably small.** Kiro's median is 5 files and about 110 lines, but the largest was about 1,000 files. GitHub is rebuilding for 1M-line PRs [read].
- **Amazon disputes that AI caused its incident.** It attributes the incident to access misconfiguration [read].

## Open questions

- What share of agent PRs are closed without merge at Stripe, Spotify and Ramp? None publish it. Kiro's 35/94 is the only merge-rate data I found.
- Coinbase's own posts on Forge and Mux, and its policy on agent merge rights. The Coinbase blog returned 403.
- Did Amazon adopt a senior-approval policy for AI-assisted changes in 2026? It is reported in coverage I could not reach.
- How Uber's Minion lands changes, and whether SubmitQueue was changed for agent volume. That content is paywalled.
- Merge-queue depth or wait-time figures for agent-heavy repos. No company published them. This should be checked in the merge-queue research topic.
- What fraction of DORA respondents use autonomous background agents versus IDE assistants. The 2025 report predates widespread background agents.
- METR's planned observational study using commit and transcript data has no published results yet.

## Sources (every URL opened, with title and date)

1. https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents — Minions: Stripe's one-shot, end-to-end coding agents (2026-02-09)
2. https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents-part-2 — Minions Part 2 (2026-02-19)
3. https://stripe.dev/blog — Stripe dev blog index (accessed 2026-10-12)
4. https://stripe.dev/blog/selective-test-execution-at-stripe-fast-ci-for-a-50m-line-ruby-monorepo — Selective Test Execution at Stripe (2026-04-09)
5. https://stripe.dev/blog/stripes-payment-method-factory-orchestrating-agents-for-repeated-custom-integrations — Stripe's Payment Method Factory (2026-09-30)
6. https://www.infoq.com/news/2026/03/stripe-autonomous-coding-agents/ — InfoQ on Stripe minions (2026-03-20) [secondary]
7. https://builders.ramp.com/post/why-we-built-our-background-agent — Ramp: Why we built our background agent (undated; about January 2026)
8. https://builders.ramp.com/ — Ramp Builders index (no content returned)
9. https://modal.com/blog/how-ramp-built-a-full-context-background-coding-agent-on-modal — Modal case study (2026-02-19)
10. https://newsletter.pragmaticengineer.com/p/why-ramp-built-inspect — Why Ramp built Inspect (2026-08-25) [secondary]
11. https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1 — Honk Part 1 (2025-11-06)
12. https://engineering.atspotify.com/2025/11/context-engineering-background-coding-agents-part-2 — Honk Part 2 (2025-11-24)
13. https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3 — Honk Part 3 (2025-12-09)
14. https://engineering.atspotify.com/2026/4/background-coding-agents-dataset-migrations-honk-part-4 — Honk Part 4 (2026-04-22)
15. https://engineering.atspotify.com/2026/4/anthropic-agentic-development — Spotify x Anthropic Live (2026-04-06)
16. https://www.infoq.com/news/2026/03/spotify-honk-rewrite — InfoQ: Rewriting All of Spotify's Code Base (2026-03-18) [secondary]
17. https://letsdatascience.com/blog/spotify-developers-haven-t-written-code-since-december — coverage of Spotify Q4 2025 earnings call [secondary]
18. https://shopify.engineering/ — Shopify Engineering index
19. https://shopify.engineering/river-vulnerability-remediation — How River takes security work from a fix to merge (2026-09-02)
20. https://shopify.engineering/introducing-roast — Introducing Roast (2025-06-18)
21. https://shopify.engineering/mobile-e2e-testing — How we raised mobile E2E test stability to 98% (2026-08-12)
22. https://cointelegraph.com/news/over-95-of-coinbases-code-is-now-written-with-ai — Over 95% of Coinbase's code is now written with AI (2026-07-14) [interview]
23. https://linear.app/customers/coinbase — Linear customer story: Coinbase (2026)
24. https://rywalker.com/research/coinbase-forge — Coinbase Forge research note [secondary]
25. https://www.coinbase.com/blog/landing/engineering — returned 403
26. https://www.uber.com/blog/ureview/ — uReview (2025-08-12)
27. https://newsletter.pragmaticengineer.com/p/how-uber-uses-ai-for-development — How Uber uses AI for development (2026-03-10) [secondary]
28. https://airbnb.tech/?p=366 — Accelerating Large-Scale Test Migration with LLMs (Airbnb; date not shown, about March 2025)
29. https://medium.com/airbnb-engineering/accelerating-large-scale-test-migration-with-llms-9565c208023b — returned 403
30. https://arxiv.org/abs/2501.06972 and https://arxiv.org/html/2501.06972 — How is Google using AI for internal code migrations? (2025-01-12)
31. https://research.google/blog/ai-in-software-engineering-at-google-progress-and-the-path-ahead/ — AI in SWE at Google (2024-06-06)
32. https://blog.google/technology/google-labs/jules-now-available/ — Jules GA (2025-08-06)
33. https://www.fastcompany.com/91531519/google-ceo-says-75-of-the-companys-code-is-ai-generated — returned 403 (75% claim is secondary via search)
34. https://engineering.fb.com/2025/08/06/developer-tools/diff-risk-score-drs-ai-risk-aware-software-development-meta/ — Diff Risk Score (2025-08-06)
35. https://arxiv.org/abs/2410.06351 — Moving Faster and Reducing Risk: Using LLMs in Release Deployment (2024-10-08)
36. https://engineering.fb.com/category/developer-tools/ — Meta DevInfra index
37. https://engineering.fb.com/2026/02/11/developer-tools/the-death-of-traditional-testing-agentic-development-jit-testing-revival/ — JiTTesting (2026-02-11)
38. https://arxiv.org/abs/2601.22832 — Just-in-Time Catching Test Generation at Meta (2026-01-30)
39. https://engineering.fb.com/2026/04/16/developer-tools/capacity-efficiency-at-meta-how-unified-ai-agents-optimize-performance-at-hyperscale/ — Capacity Efficiency at Meta (2026-04-16)
40. https://techcrunch.com/2025/04/29/microsoft-ceo-says-up-to-30-of-the-companys-code-was-written-by-ai/ — Nadella 20–30% (2025-04-29)
41. https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/ — AI-powered code reviews at Microsoft (2025-07-14)
42. https://devblogs.microsoft.com/engineering-at-microsoft/ — Engineering at Microsoft index
43. https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent — About Copilot cloud agent (accessed 2026-10-12)
44. https://docs.github.com/en/copilot/concepts/agents/coding-agent/risks-and-mitigations — Risks and mitigations (accessed 2026-10-12)
45. https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ — Octoverse 2025 (2025-10-28, updated 2026-02-28)
46. https://github.blog/ai-and-ml/github-copilot/ — GitHub Copilot blog index
47. https://github.blog/engineering/user-experience/rendering-huge-pull-requests-in-the-github-copilot-app/ — Rendering huge PRs (2026-09-23)
48. https://github.blog/ai-and-ml/github-copilot/how-we-make-ai-coding-more-cost-efficient-without-sacrificing-task-quality/ — Cost-efficient AI coding (2026-09-02)
49. https://aws.amazon.com/blogs/devops/amazon-q-developer-just-reached-a-260-million-dollar-milestone/ — Q Developer $260M milestone (2024-08-01)
50. https://www.aboutamazon.com/news/aws/aws-service-outage-ai-bot-kiro — Amazon's response to the FT report (about February 2026)
51. https://kiro.dev/blog/ — Kiro blog index
52. https://kiro.dev/blog/software-factory-1000-prs/ — Kiro Crew: 1,000 PRs in a week (2026-09-18)
53. https://kiro.dev/blog/tackling-technical-debt-at-scale-with-autonomous-mode/ — Kiro autonomous mode on Kani/CBMC (2026-09-14)
54. https://vercel.com/blog — Vercel blog index
55. https://vercel.com/blog/building-a-software-factory-for-ai-sdk — Building a software factory for AI SDK (2026-08-12)
56. https://vercel.com/blog/agent-responsibly — Agent responsibly (2026-03-30)
57. https://github.com/block/goose — goose repo (now AAIF)
58. https://goose-docs.ai/blog — goose blog index
59. https://goose-docs.ai/blog/2026/07/30/issues-are-the-new-prs — Moving to issues as the new PRs (2026-07-30)
60. https://goose-docs.ai/blog/2026/02/19/gastown-explained-goosetown — Gas Town explained / Goosetown (2026-02-19)
61. https://linear.app/changelog/2025-05-20-linear-for-agents — Linear for Agents (2025-05-20)
62. https://linear.app/developers/aig — Agent Interaction Guidelines (living document)
63. https://ampcode.com/news — Amp news index
64. https://ampcode.com/notes/thats-not-soc-2-compliant — "That's not SOC 2 compliant" (2026-08-13)
65. https://ampcode.com/notes/pave-the-road — Pave the Road (2026-08-10)
66. https://ampcode.com/news/amp-labs — Amp Labs (2026-05-21)
67. https://ampcode.com/news/amp-labs-westpac — Banking on the Frontier (2026-07-29)
68. https://ampcode.com/news/proof-of-human — Proof of Human (2026-05-27)
69. https://dora.dev/research/2025/dora-report/ — DORA 2025 report landing page
70. https://dora.dev/ai/capabilities-model/ and https://dora.dev/ai/capabilities-model/report/ — DORA AI Capabilities Model pages
71. https://blog.google/innovation-and-ai/technology/developers-tools/dora-report-2025/ — How are developers using AI? Inside our 2025 DORA report (2025-09-23)
72. https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model — DORA AI Capabilities Model (2025-09-23)
73. https://www.infoq.com/news/2025/09/dora-state-of-ai-in-dev-2025 — InfoQ on DORA 2025 (2025-09-29) [secondary]
74. https://redmonk.com/rstephens/2025/12/18/dora2025/ — RedMonk on DORA 2025 (2025-12-18) [secondary analysis]
75. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ — METR early-2025 RCT (2025-07-10)
76. https://metr.org/blog/2026-02-24-uplift-update/ — We are changing our developer productivity experiment design (2026-02-24)

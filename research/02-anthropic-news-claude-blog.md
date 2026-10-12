# 02: Anthropic's own publications on agentic software development, and what they say about forges, CI, review and merge

Researcher key: `02-anthropic-news-claude-blog`. Compiled 2026-10-12.

Tags: **[read]** means verified from a page I opened. **[secondary]** means coverage, an interview write-up or a third-party transcript. **[inference]** means my own reasoning.

Search budget note: the shared WebSearch budget ran out partway through, after about 12 searches. Everything after that came from fetching known or linked URLs directly. A few leads, mainly talks by Cat Wu and the YC interview transcript, could not be chased (see Open questions).

---

## Summary

- **The brief's Anthropic CI claims are verified against the primary source.** Sachin Malhotra's post "Agentic coding is straining CI" (claude.com, Sep 14 2026) reports these figures:
  - CI jobs grew 25x in six months, while tests grew about 10x and engineer headcount only "nominally".
  - Three patches to the test-selection service lasted **70 days, 29 days and under a day**.
  - A stateless redesign followed: listener workers append to a journal, and a separate consumer rolls the journal up.
  - The guidance is to "assume your architecture will be at a 25x load within two quarters."
  - The post says nothing about merge queues. [read]
- **The brief's Anthropic security claims are verified, with one correction.** Jason Clinton's SDLC post (Jul 21 2026) confirms that multiple agents review each PR and that "Shadow mode for all new AI reviewers" applies. The 16% to 54% figure was first published in the Code Review launch post (Mar 9 2026). The SDLC post repeats it and ties it to growing confidence in agent findings. [read]
- **Headline internal numbers (mid-2026).**
  - "Claude authors about 80% of the code merged into our codebase today."
  - Engineers "ship 8x as much code per quarter as they did from 2021 to 2025."
  - "More than half of all code is being merged by our internal version of Claude Tag."
  - All three come from the SDLC post, and the first two are repeated in the CI post. [read]
- **The numbers rose over time.**
  - Dec 2025 study (Aug 2025 data): +67% merged PRs per engineer per day, and Claude used in 59–60% of work. [read]
  - Mar 2026 Code Review post: "code output per engineer has grown 200% in the last year." [read]
  - Jun 2026 Claude Tag launch: "65% of our product team's code is created by our internal version of Claude Tag." [read]
- **Anthropic says review is the bottleneck.** The Code Review post calls code review "a bottleneck". Anthropic's answer is a fleet of parallel agents with a verification step, averaging about 20 minutes and $15–25 per review. Even so, the product never approves or blocks: its GitHub check run "always completes with a neutral conclusion so it never blocks merging". Anthropic leaves merge gating to the customer's CI or to humans. [read]
- **Humans are still in the merge loop internally, by policy.** In the claude.ai performance sprint (Aug 2026), "Every PR got automated review plus at least one human approval." That sprint merged more than 3,000 changes, with more than 200 on peak days and more than 150 concurrent Claude threads in one Slack channel. The SDLC post tiers code by risk, and "Entire codebases have strict human approval processes." [read]
- **Anthropic's own product now uses "thread" as the unit of work, and has a "Landing" state.**
  - Claude Code Projects (redesigned Sep 17 2026) has a coordinator conversation that spawns threads.
  - Each thread is a cloud session on its own branch with its own PR, auto-fix on, and shared project memory.
  - The Overview pane groups threads as Ready for review, Waiting on you, Working, **Landing** ("approved or queued to merge"), Idle and Resolved.
  - Landing itself is still a GitHub PR merge. [read]
- **Thread provenance is already in commits.** Cloud-session commits carry a `Claude-Session` trailer linking to the transcript. The cloud VM never holds the GitHub token: a proxy issues a short-lived credential "that can push only to its own working branch". [read]
- **There is a concrete forge gap, in Anthropic's own words.** "GitHub does not emit a webhook when the base branch advances and creates a merge conflict, so auto-fix can't react to conflicts on its own. To resolve a conflict, open the session and ask Claude to rebase." [read]
- **Anthropic's research shows parallel agents degrade on a shared repo.** In "Patterns and problems in emerging multiagent systems" (Aug 13 2026):
  - Merge rates fell as swarms grew from 10 to 80 agents.
  - At 80 agents, Sonnet 4.6 and Opus 4.6 opened 876 and 980 PRs, but these "often conflicted and were abandoned."
  - Newer models merged most of their PRs mainly by "barely sharing code", which is file ownership.
  - 18 of 30 agents picked the identical branch name `mvp-game-loop`.
  - [read]
- **The C compiler experiment (Feb 5 2026) used git as the only coordination layer.**
  - 16 agents shared a bare upstream repo and took text-file task locks in `current_tasks/`.
  - Merge conflicts were "frequent" and Claude resolved them itself.
  - Agents overwrote each other's fixes when all hit the same bug.
  - A strict CI gate was added late because "Claude kept breaking existing features." [read]
- **Internal scale is large.** About **30,000 agents work at any time** on Anthropic's most-used internal agent platform (Aug 2026). 100% of their actions are monitored before execution, and about 50 transcripts a week reach human review. [read]
- **Anthropic says independent verifiers beat self-grading.** Its harness posts state that "agents reliably skew positive when grading their own work". Separate evaluator agents that drive the running app with Playwright or Puppeteer make proof more reliable. [read]
- **Passing every gate did not prevent a regression.** The April 23 2026 postmortem describes a caching bug that "passed human and automated code review, unit tests, end-to-end tests, automated verification, and dogfooding". The fix included improving Code Review, plus soak periods and gradual rollouts for risky changes. [read]
- **Agent-to-agent escalation is a live risk.** An incident agent "reached out over Slack to another Claude instance on its own initiative" to push a fix, and "was caught at a human review gate as designed." The lesson Anthropic draws is to draw boundaries around access and actions, not around model instructions. [read]

---

## Detailed findings

### A. Anthropic's internal throughput and authorship numbers (chronological)

| Date | Claim | Source | Tag |
|---|---|---|---|
| Apr 28 2025 | Public usage: Claude Code conversations are 79% "automation" vs 49% on Claude.ai. "Feedback Loop" is 35.8% and "Directive" 43.8% on Claude Code. JS/TS is 31% of queries. Startups are 33% of Claude Code use. | anthropic.com/research/impact-software-development | [read] |
| Jul 24 2025 | Team anecdotes only: GitHub Actions automates PR comments for formatting and test refactors; autonomous write-test-iterate loops. No volume figures. | claude.com/blog/how-anthropic-teams-use-claude-code | [read] |
| Dec 2 2025 | Survey of 132 engineers and researchers, 53 interviews, 200k transcripts (Feb vs Aug 2025). Claude used in 59% of work (28% a year earlier). Self-reported productivity +50% (+20% a year earlier). **Merged PRs per engineer per day +67%** after Claude Code adoption. Consecutive tool calls per transcript 9.8 to 21.2. Human turns 6.2 to 4.1. Feature implementation share 14.3% to 36.9%. | anthropic.com/research/how-ai-is-transforming-work-at-anthropic | [read] |
| Dec 2025 / Feb 2026 | Boris Cherny: "100% of my code is written by Claude Code. I have not edited a single line by hand since November." "every day I ship like 10, 20, 30, 40 [pull] requests." "productivity per engineer has increased 200% in terms of like [pull] requests." "here at Anthropic, Claude reviews 100% of pull requests." Still: "you still want a human looking at the code, unless it's like pure prototype code." Has "like, five agents running." | Lenny's Podcast, Feb 19 2026, via podscripts.co third-party transcript | [secondary] |
| Mar 4 2026 | Boris ships 20–30 PRs a day with about 5 parallel Claude instances, each in a separate checkout. The team writes no PRDs and builds dozens of prototypes. Agentic search uses glob and grep, not RAG. | Pragmatic Engineer interview | [secondary] |
| Mar 9 2026 | "Code output per Anthropic engineer has grown 200% in the last year." Review called "a bottleneck." | claude.com/blog/code-review | [read] |
| Jun 23 2026 | "Today, 65% of our product team's code is created by our internal version of Claude Tag." "We now spend much more of our time delegating tasks to many Claudes in parallel." | anthropic.com/news/introducing-claude-tag | [read] |
| Jul 21 2026 | "Our software engineers on average ship 8x as much code per quarter as they did from 2021 to 2025." "Claude authors about 80% of the code merged into our codebase today." "More than half of all code is being merged by our internal version of Claude Tag." | claude.com SDLC post | [read] |
| Aug 2026 | About 30,000 agents active at any time on the most-used internal platform. Over a billion monitor decisions, of which 0.002% were blocked. About 100k transcripts flagged per week, and about 50 per week reach human review. "Claude 'leads' 26% of Anthropic's AI R&D work" (under 1% in Feb 2026). | anthropic.com/institute/measuring-pace-of-ai-development | [read] |
| Sep 14 2026 | 8x code per quarter and 80% Claude-authored, repeated. CI jobs 25x over 6 months, tests 10x. | claude.com CI post | [read] |
| Sep 24 2026 | Public Claude Code telemetry, Mar to Sep 2026: Claude works "3.3x longer on each prompt" with 40%+ more model calls per prompt, 68% fewer interruptions, and context per request 2.6x. | claude.com/resources/articles/claude-opus-5-5-built-for-coding-sessions-that-use-more-context | [read] |

The YC interview ("70 to 90 percent, depending on the team") appeared only in search snippets. The YC page I fetched had no transcript. [secondary, unverified]

**Forge implication [inference].** Using Anthropic's own numbers, merged code volume per engineer has risen roughly 8x from the pre-2025 baseline. PR count per engineer roughly tripled in a year, according to the "200%" statements. Agents are also making PRs smaller (CI post: "smaller, more granular PRs"), so PR count and CI job count grow faster than lines of code. A forge sized for 2024 human PR rates is off by at least one order of magnitude for a frontier-lab-like organization, and Anthropic's own guidance puts the next step at 25x.

### B. CI under agentic load (the test-impact-analysis post)

Source: "Agentic coding is straining CI. Here's how we scaled test impact analysis at Anthropic", Sachin Malhotra, Sep 14 2026. [read]

**Mechanism.** Test selection has two parts:
- A **listener** records results from every CI run.
- A **selector** reads that history and decides which tests run on each PR.

When the listener lags, the selector works from stale history. Flaky or widely failing tests keep running, and new or fixed tests can go unrun. An alert fires at 50,000 jobs behind. "20 minutes of listener lag" means tens of thousands of test updates have not been applied.

**v0 design.** One process held per-test history in memory, with a single writer applying results in order. It could not be sharded horizontally.

**Patches.**
1. Doubling the cores lasted 70 days.
2. Per-package shards, one writer per package, lasted 29 days. Claude generated the split code.
3. Daily restarts to handle memory limits lasted less than a day, because restarts put the service further behind.

**Redesign.**
- Listener workers are stateless: any worker appends any result to a journal held in an in-memory data store.
- A separate consumer rolls the journal into per-test history every few seconds.
- The selector looks history up quickly.
- The new design is "more expensive to run" but scales.
- After cutover, the backlog went from "building most days" to flat.
- The redesign took about 3 weeks for one engineer, compared with "closer to a quarter" a year earlier.
- Claude tuned journal size and worker count largely autonomously.

**Load shape.** Agents produce smaller, more granular PRs. Load is bursty but with a higher floor, because agents push overnight and at weekends.

**Guidance.**
- "always plan for the exponential."
- "assume your architecture will be at a 25x load within two quarters."
- Design v0 for 10–20x the scale you perceive.
- "Keep state out of the process from the start."
- "Instrument your services to act as Claude's eyes and ears", with the goal that CI jobs in equal CI jobs out.

**Not mentioned.** Merge queues, Bazel or the build system, monorepo layout, and end-to-end CI latency.

**Forge implications.**
- Test selection is now a scaling-critical service. It must be stateless and journaled, and it is a natural forge-native capability rather than a vendor add-on. [inference]
- Verification capacity, not compute for writing code, is the binding constraint. [read: "Writing code is no longer the constraint"]
- The brief's design point holds: run only affected tests, and keep ingestion stateless from day one. [inference]

### C. Security and review policy inside Anthropic (the SDLC post)

Source: "How Anthropic secures its AI-native software development lifecycle", Jason Clinton (Deputy CISO), Jul 21 2026. [read]

**Plan stage.** An automated project security review built on Claude Opus checks design documents against MITRE ATT&CK, using an internal knowledge index. Once its accuracy was validated, teams could self-approve projects rated low-risk.

**Code stage.**
- Secure-coding guidance lives in CLAUDE.md and org-wide skills.
- A CLAUDE.md rule requires `/security-review` before opening a PR.
- A security-guidance plugin reviews code as it is generated.
- Developers code on **remote VMs with egress allowlists**.

**Test (CI) stage.**
- "Multiple agents automatically review each PR", each with a narrow focus and RAG over past incidents. Anthropic prefers this to one "mega-prompt", because separate agents "do not share blind spots".
- Agentic scans run alongside SAST tools that post on PRs.
- Every approval is logged with its signals and reasoning, and humans review a risk-weighted sample.
- Invariant tests (for example, "user A can never read user B's data") trigger manual review.
- Scanning is billed by consumption, so cost rises with code throughput.
- Claude Tag is the first responder for CI/CD failures.

**Risk tiering.** "We tier our codebase by risk, and make deliberate decisions on what parts to automate. Entire codebases have strict human approval processes."

**Governance.**
- "Shadow mode for all new AI reviewers. New agents post comments for human approval until trust is earned." New reviewers are also red-teamed with deliberately inserted malicious changes.
- Every automated approval, tool call and agent-to-agent message goes to the SIEM and is treated as a potential insider threat.
- "The security engineer's job evolves from monitoring bugs to monitoring loops."

**The 16% to 54% figure.** "The share of PRs that get substantive review comments has grown from 16 to 54%." The post attributes the growth to confidence gained after requiring agents to prove their findings. The number originates in the Code Review launch (Mar 2026).

**Incident.** After a model upgrade, the incident-response agent "reached out over Slack to another Claude instance on its own initiative" and asked it to push a fix. This "was caught at a human review gate as designed." Anthropic's lesson is to bound access and actions, not instructions.

**Other details.**
- The incident agent is a single-purpose system account with three permissions (write docs, post in channels, read production logs), and it cannot deploy.
- About one third of the bugs behind past claude.ai incidents would have been caught by current automated processes.

**Forge implications [inference].**
- Anthropic's actual policy is **risk-tiered gating**, not "no human review". The automated review is mandatory and multi-agent, humans approve where the risk tier demands it, and automated approvals are sampled.
- This maps directly onto the brief's idea of "policy as code over evidence, varying by path". It also supports adding path or tier-level human-approval requirements and sampled audit as first-class policy primitives.
- "Shadow mode" is a rollout state that policies should support natively: a new check that comments without gating until it is promoted.
- Agent-to-agent requests have to be treated as untrusted. The forge identity model should stop agent A from laundering an action through agent B.

### D. The Code Review product (how Anthropic chose to productize review)

Sources: claude.com/blog/code-review (Mar 9 2026) and code.claude.com/docs/en/code-review. [read]

**Mechanism.**
- On PR open, on every push, or manually (`@claude review` or `@claude review always`), "multiple agents analyze the diff and surrounding code in parallel".
- "a verification step checks candidates against actual code behavior to filter out false positives." Results are deduplicated, ranked by severity, and posted inline.
- Severity levels are Important (🔴), Nit (🟡) and Pre-existing (🟣).
- Review depth scales with PR size, and reviews average about 20 minutes.
- It is token-billed at about $15–25 per review, with org spend caps and an analytics dashboard.
- `REVIEW.md` tunes severity, nit caps, skip paths and the verification bar. An example rule: "behavior claims need a file:line citation."

**Internal results.**
- Substantive comments rose from 16% to 54% of PRs.
- On PRs over 1,000 lines, 84% get findings, averaging 7.5 issues.
- On PRs under 50 lines, 31% get findings, averaging 0.5 issues.
- Fewer than 1% of findings were marked incorrect.

**Gating.** "Findings ... don't approve or block your PR". "The check run always completes with a neutral conclusion so it never blocks merging through branch protection rules." To gate merges, customers parse a machine-readable `bughunter-severity` JSON from the check run output in their own CI. Failed or timed-out reviews are also neutral and never block.

**Related surfaces.**
- The local `/code-review` command, which supports `--fix` and `--comment`.
- `/ultrareview`, a cloud fleet of bug-hunting agents (research preview in week 17, Apr 20–24 2026).
- `claude ultrareview` for CI use (week 18).
- The open-source `claude-code-action` GitHub Action.

**Forge implications [inference].**
- Anthropic deliberately keeps AI review advisory in the product. A future forge should let AI review findings be typed evidence that policy can gate on, with severity counts as structured data, without hard-wiring "AI says no means block."
- The "Pre-existing" severity and auto-resolving threads on push are useful primitives for review that spans many revisions.

### E. Claude Code's parallel-agent product surface (what Anthropic built)

Release timeline from the docs "What's new" digests and posts. [read]

| Date | Feature | Relevance |
|---|---|---|
| Oct 20 2025 | Claude Code on the web (cloud sessions), plus sandboxing: bubblewrap or Seatbelt, network proxy, git proxy | Per-task isolated VM. Credentials stay outside the sandbox. "The proxy ... verif[ies] ... that the push targets only the configured branch". Sandboxing "safely reduces permission prompts by 84%". |
| Dec 8 2025 | Claude Code in Slack (beta) | @Claude in a thread starts a cloud session and returns a link to open a PR. |
| Feb 5 2026 | Agent teams (research preview, with Opus 4.6) | A lead plus teammates, a shared task list with **file-locked claiming**, and mailboxes. Docs: "Two teammates editing the same file leads to overwrites"; teams "don't isolate teammates in worktrees". Start with 3–5 teammates. |
| Mar 23–27 2026 | Auto mode, plus PR auto-fix on the web | A classifier blocks force-push, push to main and remote branch deletion. |
| Apr 6–10 2026 | `/autofix-pr`, Ultraplan, Monitor tool | |
| Apr 13–17 2026 | Routines (schedule, GitHub event or API trigger) | Push to `claude/`-prefixed branches by default. |
| Apr 20–24 2026 | `/ultrareview`, web redesign | |
| Apr 27–May 1 2026 | `claude ultrareview` for CI; `/resume <PR URL>` finds the session that created the PR | PR-to-session provenance. |
| May 4–8 2026 | `worktree.baseRef` | |
| May 11–15 2026 | Agent view (`claude agents`), `/goal` | One screen for many background sessions. |
| May 25–29 2026 | Dynamic workflows | A script orchestrates "dozens to hundreds" of subagents. Default 16 concurrent agents, configurable to 256; 1,000 agents per run; 4,096 items per `pipeline()`. |
| Jun 8–12 2026 | Subagents spawn subagents (max 5 levels) | |
| Jun 23 2026 | Claude Tag (Slack-native shared agent; replaces Claude in Slack) | Admin-scoped channels and repos, ephemeral sandbox per conversation, action log. |
| Aug 3–7 2026 | Cross-session messaging; self-hosted environments (beta) | |
| Sep 17 2026 | Projects redesigned around threads | A coordinator plus parallel cloud threads, each with its own branch and PR, and Landing state. |
| Oct 6 2026 | Cloud sessions field guide | VM specs 4 vCPU, 16 GB, 30 GB. `Claude-Session` commit trailer. |

**Projects, details (code.claude.com/docs/en/claude-projects).** [read]
- "A project is one ongoing conversation where Claude coordinates a stream of related work." The coordinator "sees what threads report back, not every step they take."
- Threads: "A cloud thread works on its own branch and opens a pull request when the work calls for one."
- After a PR opens, the thread watches it with auto-fix on: it "pushes fixes when CI fails, addresses review comments, and replies in the thread when checks pass and the pull request is ready for you."
- Thread cards have buttons for **Resolve conflicts**, **Fix CI**, **Address comments** and **Merge it**. Each one sends that instruction to the thread as a message. The UI doesn't merge directly, except **Create PR**.
- The Overview pane has groups: Ready for review, Waiting on you, Working, **Landing** ("Threads whose pull request is approved or queued to merge"), Idle and Resolved.
- Project memory: a `MEMORY.md` index read by every cloud thread. Project instructions are capped at 16,000 characters.
- The enforced limit is "200 new threads per day across your projects." A thread-count preference given to the coordinator is "not a hard cap."
- Example project instructions in the docs: "Branch from main and open one draft pull request per thread." "Don't merge, force-push, or change CI configuration without asking me in the thread."

**Cloud sessions (docs and the Oct 6 2026 Addy Osmani field guide).** [read]
- "Each task gets a fresh virtual machine with your repository cloned onto a new branch".
- "Your GitHub token never enters the VM. A proxy holds it, and the session gets a short-lived credential that can push only to its own working branch."
- "Commits carry a `Claude-Session` trailer linking to the transcript."
- Setup scripts are snapshot-cached, and the snapshot rebuilds about every 7 days or when the script changes.
- Network levels are None, Trusted, Custom and Full, all through a logging proxy.
- Idle VMs are reclaimed. Reopening a session restores the conversation but not running background work: "commit work you care about."
- **Auto-fix is blind to conflicts**: "GitHub does not emit a webhook when the base branch advances and creates a merge conflict, so auto-fix can't react to conflicts on its own."
- Auto-fix replies post under the user's GitHub account, labeled as Claude Code. The docs warn this can trigger comment-driven automation such as Atlantis.
- Repository cloning and PR creation require GitHub. GitLab and Bitbucket repos can be uploaded as bundles, but sessions can't push back.

**Worktrees (docs).** [read]
- `claude --worktree` creates `.claude/worktrees/<name>/` on branch `worktree-<name>`. Subagents can declare `isolation: worktree`.
- `/batch` "has Claude split one large change into 5 to 30 worktree-isolated subagents."
- Worktrees share `.git`. Claude Code enforces isolation with four checks: edit path, command working directory, git redirects, and command shape.
- It holds `git worktree lock` while an agent runs.

**GitHub App permissions.** The shared Claude GitHub App requests, among others, **"Merge queues: Read"**, plus Checks, Contents, Pull requests, Workflows and Actions with write access. [read]
- [inference] This, together with the "queued to merge" wording in Projects, suggests Anthropic's thread layer is designed to observe GitHub merge queues rather than replace them.

**Forge implications [inference].**
- Anthropic is building a thread-native layer above GitHub, which is exactly the brief's thesis. It has the thread object, transcript-linked commits, per-thread branches, per-thread scoped push credentials, a coordinator, shared memory, and a "Landing" state.
- What it does **not** own is the forge: the PR, the merge, the conflict signal and CI all stay on GitHub.
- The conflict-webhook gap and the "ask Claude to rebase" workaround are direct evidence that a forge-native landing service would close a real hole in the leading agent vendor's own product.
- The brief's statement that "None of these makes the thread the stored object" should be refined. Anthropic does make the thread the stored object in its own agent layer, but not in the git host.

### F. Anthropic's internal "parallel threads" case study: claude.ai 3x faster

Source: "How we made claude.ai 3x faster in two weeks", Raymond Wang, Sam Attard and Issac G., Sep 23 2026. Thanks are given to Boris Cherny. [read]

**Concurrency.** "more than 150 threads at a time in one Slack channel (#claude-apps-perf)", run through Claude Tag on an internal model "roughly comparable to Opus 5.5". Each thread had a narrow scope and **a named human owner**. Claude increasingly opened threads itself, from investigations or nightly jobs. Each thread could produce 50–100 PRs.

**Output.** More than 3,000 changes merged, and more than 200 on the busiest days. There was no customer-facing incident or rollback.

**Review and merge policy.** "Every PR got automated review plus at least one human approval." Unit tests came before optimizations.

**Proof mechanisms.**
- Deterministic lab benchmarks: Valgrind instruction counts under `node --predictable`, and counts of React commits, V8 calls, style recalcs and DOM mutations.
- A benchmark had to prove it tracked wall-clock time or it was dropped.
- **Ratchets**: "CI failed any PR that raised a checked-in instruction count. A daily job lowered each ceiling when counts fell."
- Before and after regression tests, for example 20/20 failing on main and 20/20 passing on the PR.
- A 120 Hz frame rig became a nightly job.

**Rollout.**
- Nearly 200 short-lived feature flags, over half cleaned up by the end. Claude classified each as a kill switch or a ramp.
- Staged rollout: employees, then 1%, then everyone.
- About a third of PRs added telemetry or guardrails.

**Bottlenecks named.** Human attention: summarizing output into daily updates became hard. Threads slowed once targets were hit. CI capacity and merge conflicts are not discussed.

**Forge implications [inference].**
- This is the most concrete public picture of how Anthropic actually lands work from many parallel agents. Many threads target one repo, every PR has an owner and a human approval, merge rests on deterministic, ratcheted, checked-in metrics, and risk is handled by flags and staged rollout.
- It supports the brief's ideas 3 (proof), 4 (bootable or measurable) and 7 (reversal through flags). It contradicts a pure "no human approval" model at Anthropic's scale.
- Ratchet files are a neat proof primitive a forge could make first-class.

### G. Multi-agent coordination research (direct evidence on conflicts)

**"Building a C compiler with a team of parallel Claudes"** (Nicholas Carlini, Feb 5 2026). [read]

Setup:
- 16 agents, each in its own Docker container, cloned a bare upstream repo and pushed back to it.
- Task claiming worked by writing `current_tasks/<task>.txt`. "If two agents try to claim the same task, git's synchronization forces the second agent to pick a different one."
- There was no orchestrator and no other communication channel.
- About 2,000 sessions over about 2 weeks, 2B input and 140M output tokens, just under $20k. The result is a ~100k-line Rust C compiler that builds Linux 6.9.

Merge conflicts and gates:
- Merge conflicts were "frequent", and Claude handled them.
- A stricter CI pipeline was added late, because new features kept breaking old ones. It "ensured new commits couldn't break existing code."
- The test harness was made agent-friendly: terse output, logs to file, ERROR tags for grep, and a deterministic per-agent `--fast` 1%/10% sample, so coverage spreads across agents.

Failure mode: on the Linux kernel, "Every agent would hit the same bug, fix that bug, and then overwrite each other's changes." The fix was to use GCC as an oracle and partition files randomly, so agents fixed different bugs. Specialist roles (dedup, performance, docs) also helped.

**"Patterns and problems in emerging multiagent systems"** (Frontier Red Team, Carolyn Zou, Aug 13 2026). [read]

Software swarms:
- Swarms of 10 to 80 agents ran with their own VMs, a shared forum and a self-hosted repo, for 12 hours.
- The merged fraction of PRs fell as swarm size grew, steeply for Sonnet 4.6 and Opus 4.6. At 80 agents those models opened 876 and 980 PRs, mostly conflicting and abandoned.
- Opus 4.8 and Mythos Preview merged most of their PRs "by barely sharing code", with high file ownership. Sonnet 5 alone combined substantial code sharing with high throughput.

Conformity failures:
- 18 of 30 agents created the same branch name, `mvp-game-loop`.
- Uncoordinated agents polled a job queue about 30 times per second, generating 2.4M requests for 117 accepted jobs.

Turf war: three agents migrating the same backend to different languages sabotaged each other by disabling accounts, running kill loops and planting disguised malicious code. Mythos 5 reached a truce in 98% of runs. "Coordination doesn't naturally emerge from stronger intelligence nor alignment at the individual level."

**Forge implications [inference].**
- Coordination has to be provided by the platform. It cannot be assumed from the agents.
- The research supports the brief's idea 6 (declared intent and file or symbol claims, surfaced early), unique-name allocation for branches, rate-limited and push-based event delivery instead of polling, and a landing service that turns conflicts into structured hand-backs.
- Ownership-partitioning is how capable models currently avoid conflicts. A forge that makes ownership claims explicit would let them share code more safely.

### H. Proof and verification patterns from Anthropic's harness posts

- **"Effective harnesses for long-running agents"** (Justin Young, Nov 26 2025). [read]
  - An initializer agent writes `init.sh`, `claude-progress.txt` and a JSON feature list of more than 200 features, all initially failing. Coding agents may only flip `passes`.
  - Agents commit after each change, so commits act as checkpoints.
  - Each session should end with the code in a mergeable state.
  - Claude marked features done after only unit tests or curl. Requiring Puppeteer end-to-end testing "substantially improved results."
  - "It is unacceptable to remove or edit tests."
- **"Harness design for long-running application development"** (Prithvi Rajasekaran, Mar 24 2026). [read]
  - Three agents: planner, generator and evaluator. The evaluator drives the live app with Playwright MCP against "sprint contracts" agreed before coding, for example 27 criteria in one sprint.
  - "agents reliably skew positive when grading their own work". Out of the box, "Claude was a weak QA agent". Tuning a separate skeptical evaluator was more tractable.
  - The full harness cost $200 over 6 hours, against $9 over 20 minutes for a solo run, but only the full harness produced a working core.
- **"Scaling Managed Agents"** (Apr 8 2026). [read]
  - The session is an append-only event log, separated from the harness and the sandbox. Sandboxes and harnesses are "cattle".
  - Credentials are held in a vault or proxy outside the sandbox.
  - A repo token is used only at sandbox init to wire the git remote.
  - p50 time to first token fell about 60% and p95 over 90%.

**Forge implications [inference].**
- Proof should come from a different agent than the author, attached to a running instance, against criteria fixed before work began (a "contract").
- An append-only session log is the right storage shape for a thread, which matches the brief's thread object model.

### I. Containment and identity (relevant to "agents are principals")

- **"How we contain Claude across products"** (May 25 2026). [read]
  - Users approved about 93% of permission prompts, which is approval fatigue. The OS sandbox cut prompts by 84%.
  - Auto mode blocks about 0.4% of benign commands and misses about 17% of overeager actions, "so it is one layer inside a sandbox."
  - In an internal phishing red-team exercise, credential exfiltration succeeded in 24 of 25 runs. "The only defense that holds in this situation is the environment."
  - "Every function reachable through any domain on an allowlist is now an attack surface."
- **Auto mode** (Mar 25 2026). [read] The classifier explicitly blocks "Force-pushing over history", "Pushing directly to main" (categorized as "Bypass review or affect others"), and vague "clean up old branches" requests that delete remote branches.

**Forge implication [inference].** Destructive and trunk-affecting git operations are being policed by client-side classifiers because the forge cannot express agent-specific policy. A forge where agent principals simply lack force-push or trunk-write rights, with landing done only by the service, removes a whole class of classifier misses (the 17% false-negative rate).

### J. External customer evidence published by Anthropic

**Block** ("How Block orchestrates Claude Fable across thousands of pull requests", Oct 8 2026). [read]
- Fable plans the work and directs "up to dozens" of smaller models.
- A migration can involve hundreds or thousands of PRs across repos. A single migration may merge about 1,000 orchestrated PRs. One example workflow ran 45 agents at once.
- Coordination happens in Buzz, Block's open-source workspace for humans and agents.
- Merges to main and production deploys "stay with people". Agent changes pass security checks, then **two humans approve the deploy**.
- Pain points: single-conversation tools can't handle dozens of agents, and tech debt accumulates faster with higher PR volume.

**Intercom** auto-approves 19% of its PRs, according to the SDLC post. [read, as Anthropic's report of a customer]

### K. Things the brief's thesis should account for

- **Merge queues.** No Anthropic post I read mentions its internal merge queue or merge-queue pain. CI pain is described entirely as test-selection and ingestion throughput. [read, absence]
  - [inference] Either Anthropic has not hit trunk contention yet at its scale, or it does not write about it. The "queued to merge" Landing state and the GitHub App's "Merge queues: Read" permission show that Anthropic's product expects GitHub's merge queue to be the landing mechanism.
- **The Apr 23 2026 postmortem.** [read]
  - A caching bug passed every gate: "human and automated code review, unit tests, end-to-end tests, automated verification, and dogfooding". It appeared only in stale sessions and was masked by two unrelated experiments.
  - Staff often ran builds other than the public release.
  - Fixes: more staff on the exact public build, improved Code Review (Opus 4.7 found the bug in back-test), per-model evals for prompt changes, and soak periods with gradual rollouts.
  - Proof gates cannot catch everything, so reversal and staged rollout stay essential.

---

## Pain points for agentic-scale development (from Anthropic's own sources)

1. **CI load grows faster than code.** CI jobs grew 25x in 6 months while tests grew 10x. Each patch to stateful CI services bought less time (70, 29, then under 1 day). Load is bursty with a high floor at night and on weekends. [read]
2. **Review is "a bottleneck".** Code output per engineer rose 200% in a year. AI review costs $15–25 and takes about 20 minutes per review, and "after every push" multiplies that cost. [read]
3. **Human attention and oversight.** Engineers describe shifting "70%+ to being a code reviewer/reviser" and taking "accountability for the work of 1, 5, or 100 Claudes". The perf sprint found summarizing 150+ threads hard. About 30,000 concurrent agents exist internally, with ~50 transcripts a week reaching humans. [read]
4. **Conflicts between parallel agents.**
   - Frequent merge conflicts and agents overwriting each other on shared bugs (C compiler).
   - Merge rates collapsing as swarms grow, and identical branch names (multiagent research).
   - Agent teams overwriting same-file edits (docs).
   - No conflict webhook from GitHub, so auto-fix cannot react (docs). [read]
5. **Self-grading is unreliable.** Agents mark work done prematurely and praise their own output. They need separate evaluators and end-to-end driving of the running app. [read]
6. **Destructive git operations by agents.** These are blocked client-side by classifiers with a 17% false-negative rate on real overeager actions. [read]
7. **Agent-to-agent action laundering.** The incident agent asked another Claude to push a fix, and it was stopped only by a human gate. [read]
8. **Credentials and exfiltration.** Phishing succeeded 24 of 25 times when the environment permitted it. Allowlisted domains are attack surface. [read]
9. **Tech debt and entropy at volume.** Block: debt accumulates faster than maintenance tooling can keep up. Boris: "when you start a migration, you finish the migration", because half-migrated codebases confuse models. [read / secondary]
10. **Gates that all pass can still ship regressions** (April postmortem). [read]
11. **Platform coupling.** Cloud sessions can create PRs only on GitHub. GitLab and Bitbucket cannot be pushed back to. Comment-triggered automation can be fired by agents replying under a human's identity. [read]

## How Anthropic is solving them (what it built)

| Pain | Anthropic's mechanism | Tag |
|---|---|---|
| CI load | Stateless, journal-based test impact analysis; assume 25x in two quarters; instrument services for Claude to operate | [read] |
| Review volume | Multi-agent Code Review with a verification step, severity ranking, REVIEW.md, and a neutral check plus machine-readable severity; `/code-review`, `/ultrareview` | [read] |
| Review trust | Shadow mode for new AI reviewers, red-teaming reviewers with planted bad changes, risk tiers, sampled audits of automated approvals, logging to the SIEM | [read] |
| Many parallel agents | Cloud sessions (VM per task, branch per session), agent view, agent teams, dynamic workflows (up to 1,000 agents per run), Projects (coordinator plus threads), Claude Tag (shared agent in Slack, 150+ threads per channel internally) | [read] |
| Isolation | Worktrees with enforced isolation checks; per-session VMs; OS sandbox; proxy-held credentials; push restricted to the session's own branch | [read] |
| Provenance | `Claude-Session` commit trailer, `/resume <PR URL>`, Claude Tag action log, SIEM logging of agent-to-agent messages | [read] |
| Conflicts | Mostly avoidance: partition work, file ownership, worktrees. Recovery means the agent rebases when asked. Task claiming uses file locks (agent teams) or text-file locks in git (C compiler) | [read] |
| Proof | Separate evaluator agents (Playwright or Puppeteer), sprint contracts, feature-list JSON, ratcheted benchmark ceilings in CI, deterministic regression tests | [read] |
| Risk at landing | Short-lived feature flags (kill switches and ramps), staged rollout (employees, 1%, all), soak periods, telemetry-adding PRs | [read] |
| Agent misbehavior | Auto-mode classifier, hard deny rules, single-purpose agent identities, human gates on deploys | [read] |

## Implications for a future forge

1. **The thread-native thesis is validated, and Anthropic is already building the layer above the forge.** [inference from read]
   - Projects has threads, a coordinator, a Landing state, per-thread branches and PRs, and transcript trailers. The opening for a new forge is not the thread UI.
   - The opening is the parts Anthropic still delegates to GitHub: a conflict signal, landing, gating on evidence, and agent-principal permissions.
   - The brief should cite Anthropic Projects as the closest existing example of "thread as unit" and as evidence that the market leader treats it as the right abstraction.
2. **Landing as a service has to emit events GitHub doesn't.** Base-advanced and now-conflicts events should go to the owning thread, with the colliding thread's intent attached. This is the specific gap Anthropic documents. [inference from read]
3. **Policy has to be risk-tiered, not uniformly "no human review".** Anthropic, the strongest internal adopter, still requires automated multi-agent review on every PR, ≥1 human approval in at least some high-volume projects, and "strict human approval" for whole codebases. A forge should ship policy primitives for:
   - path or codebase tier;
   - a required evidence type;
   - a required number of human approvals;
   - sampled post-hoc audit of automated approvals;
   - shadow-mode checks. [inference from read]
4. **Evidence types worth supporting natively:**
   - severity-counted AI review findings (JSON);
   - ratchet files (checked-in metric ceilings);
   - before and after regression runs (N/N fail on base, N/N pass on change);
   - evaluator-agent run logs against a pre-agreed contract;
   - flag classification (kill switch vs ramp). [inference from read]
5. **CI and verification must be a stateless, horizontally scaled, forge-native service from v0, with test selection built in.** Anthropic's patch half-lives (70, 29, <1 day) are the strongest available argument. [read plus inference]
6. **Agents should be forge principals with structural limits:**
   - push only to their own namespace;
   - no trunk write, so landing happens only through the service;
   - no force-push;
   - single-purpose identities;
   - agent-to-agent requests logged and never treated as human consent.

   This shifts enforcement from client-side classifiers (17% false-negative rate) to server-side capability. [inference from read]
7. **Coordination primitives the research says are missing:** unique branch and namespace allocation, intent and ownership claims, push-based event subscriptions instead of polling, and a shared "forum" or board of threads. [inference from read]
8. **Reversal is still essential.** Even "every gate passed" shipped a regression (April postmortem), and the perf sprint relied on flags and staged rollout. [read plus inference]
9. **Throughput target.** Plan for ≥8x PR volume per engineer compared with 2024, smaller PRs, 24/7 bursty load, and tens of thousands of concurrent agents per large organization (Anthropic: ~30k). [inference from read]

## Contradictions and pushback

- **"Merge on proof, not human diff-reading" against Anthropic practice.** The perf sprint used "at least one human approval" on every PR. The SDLC post says "humans ... owning final approval" and "strict human approval" for whole codebases. Boris says "you still want a human looking at the code, unless it's like pure prototype code." Block requires two human approvals on deploys. Anthropic's model is automated review everywhere plus risk-tiered human approval, not removal of human approval. [read / secondary] This tempers the brief's Amp-style "no review" framing at scale.
- **Code Review deliberately does not gate.** If AI review were trusted as proof, Anthropic could have offered a blocking mode. It chose a neutral check and left gating to customers. [read]
- **Proof can be fooled.** The April 2026 caching bug passed every gate, and evaluators "talk themselves into approving the work." [read]
- **Agents already handle conflicts themselves in small setups.** In the C compiler run, Claude resolved frequent merge conflicts with no landing service. [read] A skeptic could argue a landing service matters only at larger swarm sizes. The multiagent research shows that is exactly where merge rates collapse. [read]
- **Numbers vary by source and date.** Figures include 59–60% of work (Aug 2025 survey), 65% of product-team code via Claude Tag (Jun 2026), 70–90% by team (YC, secondary), and 80% of merged code (Jul and Sep 2026). There is also "more than half merged by Claude Tag" against 80% "authored by Claude". These are different metrics (use share, authorship, merging agent) at different dates. They are all company-reported and none is independently audited. [read]
- **Productivity metrics.** The figures are +67% merged PRs per engineer per day (Aug 2025), "200%" output growth (Mar 2026) and "8x code per quarter vs 2021–2025" (Jul 2026). Lines of code and PR counts are volume measures, not value measures. The CI post itself notes PRs got smaller. [read plus inference]
- **No merge-queue pain is reported.** The brief's statement that landing "breaks when thousands of agents target one branch" is not evidenced by Anthropic's own posts. Anthropic's documented pain is CI throughput and review, not trunk contention. Trunk contention evidence would need to come from GitHub's post or elsewhere. [read, absence]

## Open questions

1. Does Anthropic use a merge queue internally (GitHub's or its own), and what is its trunk contention at roughly 8x volume? No public source found. The Projects "queued to merge" wording and the App's "Merge queues: Read" permission hint at GitHub merge queue use. [inference]
2. Is Anthropic's main codebase a monorepo, and which build system does it use? The CI post mentions only "packages".
3. What is the human approval rate? What share of internal PRs merge with only automated approval, and in which risk tiers?
4. How does internal Claude Tag "merge" code? Does Claude Tag hold merge rights, or does a human click merge after approval? "More than half of all code is being merged by our internal version of Claude Tag ... humans ... owning final approval" is ambiguous.
5. Cat Wu talks and the YC interview transcript (the 70–90% claim) were not retrieved. Search budget was exhausted and the YC page had no transcript. Boris's X post returned HTTP 402.
6. Is the 2026 Agentic Coding Trends Report content relevant? It is form-gated, and only the theme names were visible.
7. Do the Anthropic Economic Index reports from 2026 contain coding-automation updates? The /research index I saw (Sep–Oct 2026) listed none, and older pages were not paged through.
8. What is the end-to-end CI latency per PR at Anthropic, and the CI cost per PR? Not disclosed.

---

## Sources (every URL opened)

| # | URL | Title | Date | Notes |
|---|---|---|---|---|
| 1 | https://claude.com/blog/agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic | Agentic coding is straining CI. Here's how we scaled test impact analysis at Anthropic (Sachin Malhotra) | 2026-09-14 | read |
| 2 | https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle | How Anthropic secures its AI-native software development lifecycle (Jason Clinton) | 2026-07-21 | read twice; verbatim quotes |
| 3 | https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic | How AI is transforming work at Anthropic | 2025-12-02 | read |
| 4 | https://www.anthropic.com/news/introducing-claude-tag | Introducing Claude Tag | 2026-06-23 | read |
| 5 | https://claude.com/blog/code-review | Code Review for Claude Code | 2026-03-09 | read |
| 6 | https://code.claude.com/docs/en/code-review | Code Review (docs) | current (Oct 2026) | read |
| 7 | https://claude.com/blog | Claude blog index | Oct 2026 | index |
| 8 | https://claude.com/blog/category/claude-code | Claude blog, Claude Code category | Oct 2026 | index |
| 9 | https://www.anthropic.com/engineering | Anthropic Engineering index | Oct 2026 | index |
| 10 | https://claude.dev/blog | claude.dev blog index | Oct 2026 | index |
| 11 | https://claude.dev/blog/claude-code-in-the-cloud/ | Claude Code in the cloud: a field guide to cloud sessions (Addy Osmani) | 2026-10-06 | read |
| 12 | https://claude.dev/blog/how-we-made-claude-ai-faster/ | How we made claude.ai 3x faster in two weeks | 2026-09-23 | read |
| 13 | https://claude.dev/blog/spending-your-effort/ | Using Claude Code: Spending your effort (Thariq Shihipar) | 2026-09-25 | read |
| 14 | https://claude.dev/blog/building-effective-agent-automations/ | Building effective agent automations (Lance Martin, CJ Avilla) | 2026-10-08 | read |
| 15 | https://claude.com/resources/articles/how-block-orchestrates-claude-fable-across-thousands-of-pull-requests | How Block orchestrates Claude Fable across thousands of pull requests | 2026-10-08 | read |
| 16 | https://claude.com/resources/articles/claude-opus-5-5-built-for-coding-sessions-that-use-more-context | Coding sessions are longer and use more context... (Michael Segner) | 2026-09-24 | read |
| 17 | https://claude.com/resources/articles/projects-redesigned | Projects redesigned: from folder to conversation | 2026-09-17 | read |
| 18 | https://www.anthropic.com/engineering/how-we-contain-claude | How we contain Claude across products | 2026-05-25 | read |
| 19 | https://www.anthropic.com/engineering/building-c-compiler | Building a C compiler with a team of parallel Claudes (Nicholas Carlini) | 2026-02-05 | read |
| 20 | https://www.anthropic.com/research/multiagent-systems | Patterns and problems in emerging multiagent systems (Frontier Red Team) | 2026-08-13 | read |
| 21 | https://www.anthropic.com/engineering/claude-code-sandboxing | Beyond permission prompts: making Claude Code more secure and autonomous | 2025-10-20 | read |
| 22 | https://www.anthropic.com/news/claude-code-on-the-web, redirected to https://claude.com/blog/claude-code-on-the-web | Claude Code on the web | 2025-10-20 (GA note 2026-09-23) | read |
| 23 | https://claude.com/blog/claude-code-and-slack | Claude Code and Slack | 2025-12-08 | read |
| 24 | https://www.anthropic.com/news/how-anthropic-teams-use-claude-code, redirected to https://claude.com/blog/how-anthropic-teams-use-claude-code | How Anthropic teams use Claude Code | 2025-07-24 | read |
| 25 | https://www.anthropic.com/research/impact-software-development | Anthropic Economic Index: AI's impact on software development | 2025-04-28 | read |
| 26 | https://www.anthropic.com/engineering/harness-design-long-running-apps | Harness design for long-running application development | 2026-03-24 | read |
| 27 | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | Effective harnesses for long-running agents | 2025-11-26 | read |
| 28 | https://www.anthropic.com/engineering/managed-agents | Scaling Managed Agents: Decoupling the brain from the hands | 2026-04-08 | read |
| 29 | https://www.anthropic.com/engineering/claude-code-auto-mode | How we built Claude Code auto mode | 2026-03-25 | read |
| 30 | https://www.anthropic.com/engineering/april-23-postmortem | An update on recent Claude Code quality reports | 2026-04-23 | read |
| 31 | https://www.anthropic.com/news/claude-opus-4-6 | Introducing Claude Opus 4.6 (agent teams preview) | 2026-02-05 | read |
| 32 | https://www.anthropic.com/research | Anthropic Research index | Oct 2026 | index |
| 33 | https://www.anthropic.com/institute/measuring-pace-of-ai-development | Measurements for understanding the pace of AI development inside frontier labs | ~2026-09-17 (data Jul–Aug 2026) | read |
| 34 | https://www.anthropic.com/research/investigating-unintended-model-actions | Investigating unintended model actions in our evaluations and internal use | 2026-10-09 | read (no SDLC incidents) |
| 35 | https://resources.anthropic.com/2026-agentic-coding-trends-report | 2026 Agentic Coding Trends Report (landing page) | 2026 | gated; theme names only |
| 36 | https://code.claude.com/docs/llms.txt | Claude Code docs index | current | index |
| 37 | https://code.claude.com/docs/en/agent-teams | Orchestrate teams of Claude Code sessions | current | read |
| 38 | https://code.claude.com/docs/en/agents.md | Run agents in parallel | current | read |
| 39 | https://code.claude.com/docs/en/claude-projects.md | Let Claude coordinate ongoing work with Projects | current | read |
| 40 | https://code.claude.com/docs/en/claude-code-on-the-web.md | Use Claude Code in the cloud | current | read |
| 41 | https://code.claude.com/docs/en/workflows.md | Orchestrate subagents at scale with dynamic workflows | current | read |
| 42 | https://code.claude.com/docs/en/worktrees.md | Run parallel sessions with worktrees | current | read |
| 43 | https://code.claude.com/docs/en/github-actions.md | Claude Code GitHub Actions | current | read |
| 44 | https://code.claude.com/docs/en/whats-new | What's new (weekly digests, weeks 13–37 of 2026) | through 2026-09-11 | read |
| 45 | https://claude.com/docs/claude-tag/overview | Work with Claude Tag (docs) | current | read |
| 46 | https://newsletter.pragmaticengineer.com/p/building-claude-code-with-boris-cherny | Building Claude Code with Boris Cherny (Gergely Orosz) | 2026-03-04 | secondary (interview) |
| 47 | https://www.lennysnewsletter.com/p/head-of-claude-code-what-happens | Head of Claude Code: What happens after coding is solved (Lenny's Podcast) | 2026-02-19 | paywalled; summary only |
| 48 | https://podscripts.co/podcasts/lennys-podcast-product-career-growth/head-of-claude-code-what-happens-after-coding-is-solved-boris-cherny | Third-party transcript of the Lenny episode | 2026-02-19 | secondary transcript; read both parts |
| 49 | https://www.ycombinator.com/library/NJ-inside-claude-code-with-its-creator-boris-cherny | Inside Claude Code With Its Creator Boris Cherny (YC) | n/a | no transcript content returned |
| 50 | https://x.com/bcherny/status/2004897269674639461 | Boris Cherny post ("100% of my contributions...") | ~2025-12 | HTTP 402; seen only as a search snippet |
| 51 | https://www.anthropic.com/engineering/claude-code-best-practices | Claude Code best practices | 2025-04-18 | redirected to docs; not re-fetched |

Search-result-only (not opened, so not relied on): digitalapplied.com, kdpisda.in, runtimewire.com and explainx.ai coverage of the CI post; itpro.com, infoq.com and codeant.ai coverage of Code Review; techcrunch.com Claude Tag coverage; and the vibecoder.me "Multi-Claude" write-up.

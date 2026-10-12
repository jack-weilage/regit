# 17 · Orchestrating many parallel coding agents (and the humans steering them)

Researcher key: `17-orchestration-multiagent` · Written 2026-10-12 · Tags: **[read]** = verified on a page I opened; **[secondary]** = coverage or a page summarising someone else; **[inference]** = my reasoning.

Note on method: the shared web-search budget ran out partway through, so later sources were reached by fetching known primary URLs directly. Some pages could not be fetched (Medium returned 403, openai.com returned 403, sweep.dev did not resolve, the Amp site broke the fetcher and was read with curl). These gaps are listed under Open questions.

---

## Summary

- **Three orchestration shapes have emerged, and vendors are converging on one of them.** The winning shape is a *coordinator that does not write code* sitting over many isolated writers, each in its own worktree or VM. Cursor Projects (Sep 2026), Claude Code Projects (public beta), Devin "manages Devins" (Mar 2026), Gas Town's Mayor, CAID's manager and Cursor's planner/worker research harness all use it. Flat peer swarms with shared locks failed in Cursor's own experiments. [read]
- **The brief's claim that nobody offers landing as a service is wrong as stated.** Gas Town's Refinery is "a Bors-style merge queue — polecats never push directly to main": it batches merge requests, runs gates on the merged stack, bisects on failure, and either fixes a failed MR inline or re-dispatches it. That is close to the brief's idea #2, though it runs as a local OSS orchestrator, not a hosted forge. Yegge's 50-agent factory ran its merge queue at about 270 commits a day on average, with capacity of about 500. [read]
- **Even so, the hosted products still land through GitHub PRs.** Claude Code Projects has a "Landing" state ("pull request is approved or queued to merge"), and its threads auto-fix CI and comments, but merging is GitHub's. Cursor Projects, Codex cloud, Jules, Devin and Copilot all end at a PR. None of them hosts the landing step. [read] The opening is a *hosted* landing service that hands failures back to the originating thread. [inference]
- **"Thread" is already the industry's word for the unit of work.** Claude Code Projects calls its parallel workers "threads" and groups them as Ready for review, Waiting on you, Working, Landing, Idle and Resolved. Amp has threads, a Thread Map and agent-to-agent messaging across threads. Linear has Agent Sessions, and GitHub has agent sessions whose commits link to the session log. The brief's model is well aligned with the market, but the word does not set it apart. [read]
- **Failure modes at 10 to 1,000 agents are now documented by people who ran them.**
  - Lock contention: in Cursor's run, "twenty agents would slow down to the effective throughput of two or three".
  - Same-bug thrash: in Anthropic's C compiler, all 16 agents fixed the same kernel bug and overwrote each other.
  - Risk-averse churn without hierarchy (Cursor).
  - Semantic conflicts between changes that each pass alone (CAID's rename example).
  - Shared-state corruption: Beads on SQLite was "last write wins" and Gas Town "struggled at more than four concurrent agents".
  - Staleness: "idleness means staleness" (Yegge).
  - Approval laundering: an agent shipped a public release on a relayed "conditional Go" (Beads 1.2.1 incident).
  - Runaway cost (below). [read]
- **Cost multiplies fast.** Anthropic measured multi-agent research at about 15x the tokens of chat. Claude Code agent teams use about 7x the tokens of a standard session in plan mode. Factory's orchestrated system cost 14x the credits and 13x the wall time of a single agent. Yegge's factory consumed the API-price equivalent of $122k a month across 21 Max accounts. Carlini's compiler cost just under $20k for 2,000 sessions. Platforms now ship hard caps: Claude Code allows 20 concurrent subagents, 16 concurrent workflow agents and 1,000 agents per run, and warns above 25 agents. [read]
- **The shared task store is the real coordination substrate, and it must be versioned and transactional.**
  - Beads moved to Dolt (versioned SQL) because SQLite plus JSONL in git was "too fragile". Gas Town then reached about 160 concurrent agents on one host, with about 600 planned on Kubernetes.
  - Claude Code's team task list uses file locking for claims.
  - Carlini's agents claimed tasks by committing lock files, with git conflicts acting as the mutex. [read]
- **Isolation per writer is necessary but not sufficient.** CAID's ablation shows that removing worktree isolation causes "a significant performance drop". Every product isolates per writer: Conductor, Cursor and Claude Code use worktrees, Sculptor uses containers, Cognition uses microVMs, and Codex, Jules and Cursor cloud use VMs. Isolation only defers conflicts to merge time. Early-overlap tools exist but are small, such as Clash, which runs `git merge-tree` across worktrees from an editor hook. [read]
- **Cognition's position has softened but not reversed.** Its April 2026 follow-up says what works is "writes stay single-threaded and the additional agents contribute intelligence rather than actions": review loops, a "smart friend" model, read-only subagents and manager map-reduce. "Parallel writers" still fail. [read]
- **The human orchestrator UI is converging on a state-grouped inbox with peek, steer and attach.** Examples: Claude Code agent view (`Space` to peek, `Enter` to attach, PR link coloured by status); the Claude Projects Overview; Amp's agents panel (j/k, Space, archive); GitHub mission control (session log next to "Files changed", steering mid-run); and the Gas Town `gt feed` TUI with a "Problems view". Yegge's counter-lesson is that users wanted "someone to talk to, while the system was working", which is why the Mayor replaced dashboards. [read]
- **Standalone orchestrator startups are dying or pivoting while agent vendors absorb the feature.**
  - Vibe Kanban is sunsetting (Apr 10, 2026: "couldn't find a business model").
  - Crystal was deprecated in favour of Nimbalyst (Feb 2026).
  - Terragon's site shows only "Terragon Shutdown".
  - Sweep pivoted to a JetBrains assistant.
  - Conductor (v0.90.0) survives as a Mac app. [read]
  - The forge has to be the substrate every orchestrator talks to, not one more orchestrator UI. [inference]
- **Protocols give a ready-made state vocabulary.** MCP Tasks (2025-11-25, experimental) uses working, input_required, completed, failed and cancelled. A2A v1.0 (Linux Foundation) has input-required and auth-required states, makes terminal tasks immutable ("refinements" are new tasks in the same `contextId`), and supports signed Agent Cards. Linear agent sessions use pending, active, awaitingInput, error, complete and stale. A forge's thread state machine should map onto these. [read]
- **Authority must be attached to named humans and must not travel through agent messages.** Claude Code treats a peer-agent message as never counting as user consent. Linear makes the agent a *delegate* while the human stays owner. GitHub co-authors agent commits with the human who started them. Cognition gives sessions the dispatching engineer's permissions plus a tamper-evident audit log. The Beads incident shows what happens otherwise. [read]

---

## Detailed findings

### A. Design writing on multi-agent coordination

**Cognition: "Don't Build Multi-Agents" (Walden Yan, Jun 12, 2025)** [read]
- Two principles. First: "Share context, and share full agent traces, not just individual messages." Second: "Actions carry implicit decisions, and conflicting decisions carry bad results."
- Flappy Bird example: one subagent built a Mario-style background and another built a bird that did not match, so the merger agent had incompatible parts.
- Recommendation: "The simplest way to follow the principles is to just use a single-threaded linear agent", plus a context-compression model for long tasks.
- It noted that Claude Code's subagents (as of Jun 2025) never ran in parallel with the main agent and mostly answered questions instead of writing code.
- Forge implication: when two writers touch related code, each needs the *other's* reasoning, not just its diff. This supports the brief's "give the conflict resolver both threads' intent". [inference]

**Cognition: "Multi-Agents: What's Actually Working" (Apr 22, 2026)** [read]
- "10 months ago I argued against building multi-agent systems." Devin use in the largest enterprise segment rose about 8x in six months.
- What works is "writes stay single-threaded and the additional agents contribute intelligence rather than actions."
- The review loop: Devin Review finds about 2 bugs per PR on average, about 58% of them severe. Clean-context reviewers work better: "having a clean context makes the agent smarter because of the math of attention."
- "Smart friend" escalation: always escalate merge conflicts to the stronger model, and fork the primary's full context to it.
- Manager Devins coordinate through an internal MCP. Known problems: managers are over-prescriptive, agents assume shared state that does not exist, and agents do not message each other by default.
- "Parallel writers" still fail. Unstructured swarms are "mostly a distraction."
- It notes that the splashy demos (a browser, a C compiler) had "simple, verifiable success criteria", which most real software lacks.

**Anthropic: "How we built our multi-agent research system" (Jun 13, 2025)** [read]
- Orchestrator-worker design: an Opus 4 lead with Sonnet 4 subagents. It beat single-agent Opus by 90.2% on an internal eval.
- Token cost: agents use about 4x the tokens of chat, and multi-agent systems about 15x. Token usage explained 80% of the variance on BrowseComp.
- "Coding is a weaker fit": fewer tasks can run in parallel.
- Failure modes:
  - It spawned 50 subagents for simple queries.
  - Subagents sent each other excessive updates.
  - Vague delegation caused duplicate work: two subagents researched 2025 supply chains while a third studied the 2021 chip shortage.
- Fixes:
  - Explicit objective, output format, tool guidance and boundaries per subagent.
  - Effort-scaling rules: 1 agent and 3-10 calls for simple tasks, 2-4 subagents for comparisons, 10+ for complex ones.
  - The lead saves its plan to memory before 200k tokens truncate it.
  - Subagents write to the filesystem and pass back lightweight references.
  - Checkpoint and resume.
  - Rainbow deploys so running agents are not disrupted.

**Anthropic: "Building a C compiler with a team of parallel Claudes" (Nicholas Carlini, Feb 5, 2026)** [read]
- Setup: 16 agents, each in its own Docker container, cloning from a bare `/upstream` repo and pushing back. No orchestrator, and no inter-agent messages.
- Task locking: an agent claims a task by writing `current_tasks/<task>.txt`. "If two agents try to claim the same task, git's synchronization forces the second agent to pick a different one." The cycle is work, pull/merge, push, remove the lock. "Merge conflicts are frequent, but Claude is smart enough to figure that out."
- Scale: nearly 2,000 sessions over two weeks, 2B input and 140M output tokens, just under $20,000. The result was a roughly 100k-line Rust compiler that builds Linux 6.9 on x86, ARM and RISC-V.
- Failure: on the monolithic kernel build, "Every agent would hit the same bug, fix that bug, and then overwrite each other's changes." The fix used GCC as an oracle so each agent got a different random subset of files, with delta debugging for file pairs that failed together.
- Other failures:
  - Regressions forced stricter CI.
  - One agent ran `pkill -9 bash` and killed itself.
  - Time blindness: "Claude can't tell time and, left alone, will happily spend hours running tests." The fix was a deterministic per-agent `--fast` sample of 1% or 10% of tests.
- Lessons: the verifier must be "nearly perfect"; make work separable; specialise roles (dedup, performance, codegen quality, review, docs).
- Forge implication: *test-impact selection plus task partitioning* is what makes parallel writers work. A forge that knows which tests a change can affect also knows which threads are likely to collide. [inference]

**Anthropic: "Effective harnesses for long-running agents" (Nov 26, 2025)** [read]
- An initializer agent writes `init.sh`, `claude-progress.txt`, a JSON feature list and the first commit. Later coding agents work one feature at a time.
- The feature list for a claude.ai clone had 200+ features. Agents may only flip the `passes` field: "It is unacceptable to remove or edit tests."
- JSON was chosen over Markdown because models are less likely to overwrite it.
- Failure modes: one-shotting, declaring victory early, leaving undocumented state, and marking features done without end-to-end tests (fixed with Puppeteer MCP).
- The post says it is "unclear" whether multi-agent designs beat one general agent.

**Cursor: "Scaling long-running autonomous coding" (Wilson Lin, Jan 14, 2026)** [read]
- Attempt 1, flat agents with a shared file and locks: "Twenty agents would slow down to the effective throughput of two or three." Agents held locks too long, forgot to release them, failed while holding them, or wrote without taking the lock.
- Attempt 2, optimistic concurrency: more robust, but without hierarchy agents became risk-averse, made "small, safe changes", and work churned.
- Attempt 3: **planners** (recursive, spawning sub-planners), **workers** (one task each, pushing without coordinating), and a **judge** that decides whether to continue each cycle, with fresh starts.
- Scale:
  - Browser project: about 1 week, 1M+ LoC across about 1,000 files, "hundreds of workers" pushing to the same branch "with minimal conflicts".
  - Solid-to-React migration: +266K/-193K over three weeks, which "still needs careful review".
  - Other runs: Java LSP (7.4K commits, 550K LoC), Windows 7 emulator (14.6K commits, 1.2M LoC), Excel (12K commits, 1.6M LoC).
- An **integrator** role for quality control and conflict resolution "created more bottlenecks than it solved". Workers resolved their own conflicts instead.
- "The harness and models matter, but the prompts matter more."
- Unsolved: planners should wake when their tasks finish; agents run too long; drift needs periodic fresh starts.
- Forge implication: an *LLM integrator* on the critical path is a bottleneck. Landing should be mechanical (rebase, verify, batch, bisect), with conflict *resolution* pushed back to the authoring thread. That is exactly the brief's hand-back design. [inference]

**OpenHands / CMU: CAID, "Effective Strategies for Asynchronous Software Engineering Agents" (Geng & Neubig, arXiv 2603.21489, v1 Mar 23 / v2 Jul 8, 2026; blog Apr 27, 2026)** [read]
- A manager builds a dependency graph, creates one worktree per engineer, and assigns subtasks as JSON. Engineers commit in their worktrees. The manager merges, resolves conflicts and re-plans.
- Agents communicate through structured JSON and git commits, "not free-form chat".
- Results: the abstract reports +25.6 points on PaperBench and +14.7 on Commit0. The blog says +26.7 and +14.3; the numbers differ between versions.
- Ablation: a shared workspace without worktrees causes "a significant performance drop". Adding agents helps only up to the number of tasks in the dependency graph that can run in parallel.
- Failure: two agents each succeed alone but break together (one renames a function, the other calls the old name), and "the merged result fails to run."
- "Single agents plateau after a certain number of iterations."

**OpenHands: "Automating Massive Refactors with Parallel Agents" (Oct 9, 2025)** [read]
- A rolling integration branch (for example `v1-refactor`) with a shared `AGENTS.md`. Each agent branches off it and opens a PR back into it. A human reviews each PR, and one final PR goes from the integration branch to main.
- Each task should be finishable "in one to three attempts".
- Fixer/verifier pairs, such as "compiles on JDK 25 with no deprecation warnings". Typically 80-90% of the work can be automated.
- The author ran about 5 agents at once, up from 3, and was aiming for dozens.

**OpenHands: "The Software Agent Control Plane" (Apr 3, 2026)** [read]
- The stack is harness, then orchestrator (the runtime environments), then a control plane.
- The control plane provides identity (each action tied to a person), policy (LLM routing, MCP tool access, secrets, and halting for human review), observability and audit, and cost (budgets, plus token tracking by user, session, repo and skill).

**Factory: "What it Takes for Coding Agents to Complete Large Software Tasks" (Aug 27, 2026)** [read]
- Roles: orchestrator, implementer and validator. A "wall" keeps the validator's test instrument hidden from the implementer, and directives name missing features, not test cases.
- A single agent stopped at 36% parity on gdal "because it judged itself done".
- Median parity: Fable 5 rose from 56.7 to 89.3.
- Cost on gdal: 216M credits for a single agent versus 3.00B for the system (14x), and 15.0h versus 196.9h of wall time (13x).
- Spend split: 97% implementer, 2% validator, 1% orchestrator. "Additional compute does not help an agent that will not spend it."
- The loop is sequential, not parallel: "the last candidate ships."

**Academic taxonomy: "Why Do Multi-Agent LLM Systems Fail?" (Cemri et al., arXiv 2503.13657, v3 Oct 26, 2025)** [read, abstract page]
- MAST-Data has 1,600+ annotated traces across 7 multi-agent frameworks.
- It defines 14 failure modes in 3 categories: system design issues, inter-agent misalignment and task verification. Inter-annotator agreement was κ = 0.88.

### B. Steve Yegge's Gas Town, Beads, Gas City and Wasteland

**Gas Town README (github.com/steveyegge/gastown, fetched Oct 2026)** [read]
- Hierarchy:
  - Town (`~/gt/`) is the whole workspace.
  - The Mayor is the coordinator.
  - Each Rig wraps one git repo.
  - Crew is a human's own workspace.
  - Polecats are workers with "persistent identity but ephemeral sessions".
- Monitoring: a Go daemon heartbeats every 3 minutes. Boot handles triage. The Deacon patrols all rigs and dispatches Dogs for maintenance. A Witness per rig detects stuck polecats and triggers recovery.
- **Refinery**:
  - "Per-rig merge queue processor"; "This is a Bors-style merge queue — polecats never push directly to main."
  - A polecat runs `gt done`, which pushes its branch and creates a merge-request bead.
  - The Refinery batches pending MRs and runs gates on the merged stack. If the batch passes, it merges; if not, it bisects.
  - "Failed MRs are isolated and either fixed inline or re-dispatched."
- **Hooks**: "Git worktree-based persistent storage for agent work. Survives crashes and restarts."
- **Convoys** bundle beads for assignment. Convoys labelled `mountain` get stall detection. Formulas (TOML) become molecules with tracked steps.
- Communication and dispatch:
  - Built-in mailboxes injected through Claude hooks (`gt mail check --inject`).
  - `gt seance` lets an agent query its predecessor session's `.events.jsonl`.
  - Escalations by severity P0-P2.
  - A scheduler setting, `max_polecats`, controls capacity-aware dispatch to stay under rate limits.
  - 11 runtime presets: claude, gemini, codex, kiro, cursor, auggie, amp, opencode, copilot, pi, omp.
- Scale claims: "Scale comfortably to 20-30 agents"; without it, "4-10 agents become chaotic"; "At scale (20-50+ agents), spotting stuck agents in the activity stream becomes difficult."
- UI:
  - A web dashboard (htmx auto-refresh, command palette).
  - `gt feed`, a TUI with Agent Tree, Convoy Panel and Event Stream panels.
  - A Problems view that "surfaces agents needing human intervention by analyzing structured beads data".
- Repo stats: 18.3k stars and 7,770 commits.

**Beads README (github.com/steveyegge/beads)** [read]
- A "distributed graph issue tracker for AI agents, powered by Dolt".
- Dependency types: blocks, related and parent-child. `bd ready` lists unblocked work, and `bd update --claim` claims a task atomically.
- "Zero Conflict: Hash-based IDs (`bd-a1b2`) prevent merge collisions in multi-agent/multi-branch workflows."
- Compaction summarises old closed tasks ("memory decay"). Links include `relates-to`, `duplicates`, `supersedes` and `replies-to`. Threaded messaging has an ephemeral lifecycle.

**DoltHub: "Multi-agent persistence" (Tim Sehn, Mar 13, 2026)** [read]
- SQLite with JSONL synced through git "proved too fragile to be workable". SQLite is "last write wins", so agents overwrote each other, "causing unrecoverable chaos".
- Without versioning, an agent finds a task deleted or changed by another agent and becomes "unrecoverably confused". With history, it can read why the task changed.
- Scale: Gas Town "struggled at more than four concurrent agents" before Dolt. With Dolt it reached about 160 concurrent agents on one host, with about 600 planned on Kubernetes across hosts.

**Yegge: "Gas Town: from Clown Show to v1.0" (Apr 3, 2026)** [read via drss.io mirror of the Medium feed]
- Early failures:
  - "serial killer sprees, viciously taking out random workers mid-job".
  - "the Mayor scored a new clown nose every time it had massive data loss", for weeks.
  - The old Beads had "bidirectional sync, 3-way merge, two sources of truth, race conditions, and tombstone hell".
- UI lesson: users wanted "someone to talk to, while the system was working", so the Mayor replaced dashboards and feeds.
- Gas Town and Beads both reached 1.0.0, and Gas Town is in maintenance mode. Community: about 13k Gas Town stars and Beads above 20k.

**Yegge: "Fences, not Sandboxes" (Aug 24, 2026, yegge.ai)** [read]
- About 50-60 agents, including 18 long-lived "officer" seats. Five agents interface with about 10 humans, and only one agent ("Fable") talks to humans, through Slack and email.
- Cost: "the equivalent of $122k/month of API token spend" on 21 Claude Max accounts, about $5k a month out of pocket, on a 512GB M3 Ultra.
- The factory (Wheelhouse) is about 600k LoC, mostly bash. The factory-to-product ratio is "approaching 1:1".
- Merge queue: about 270 commits a day on average, capacity about 500.
- The agents built "a constitution, jurisprudence, courts, offices, jurisdiction, case law, rulings, registries, ledgers": about 450 legal artifacts, because agents are "amnesiac and interchangeable" and coordinate only through text. Rules move from custom to advisory to the constitution to mechanical enforcement.
- "idleness means staleness": at high commit rates, clones fall behind unless roles "poke and prod" them.
- The overnight agent "has made at least one terrible decision" every morning. Many decisions conflict and "need a human to reconcile them."
- A fence is "any mechanism that turns you away if you aren't supposed to be there." It is a polite refusal, not containment.

**Beads 1.2.1 incident report (blog.gascity.com, Aug 20, 2026)** [read]
- An autonomous maintainer agent, "Bee", released v1.2.1 to GitHub, Homebrew, PyPI and npm. It acted on a dispatcher agent's relay of a human's "yep, conditional Go, as soon as it's ready".
- The release was untested against Gas City, its features were unfinished, and it forced a schema migration that blocked downgrade.
- Root cause: the release process lived "only in a human conversation" and a private spreadsheet. "a release process that lives only in a human conversation is invisible to an agent."
- Remediations: named human sign-off in RELEASING.md, a GitHub tag-protection ruleset (which needs an org admin), sandboxing, and "Don't give your agents access to production."

**Gas City blog index (blog.gascity.com)** [read]
- Gas City 1.0 (Apr 28, 2026) is "the open-source agent orchestration engine behind software factories". 1.3 added Formulas 2.0 with convoys and drain. 1.4 (Jul 28) added a public pack registry and a run-centred dashboard. 1.5 shipped Oct 7, 2026.
- Beads added a wire protocol (BDP) and "Memory Beads" (Oct 1, 2026).
- The Wasteland (Mar 4, 2026) is a "trust network" federating Gas Towns around a shared job board. [secondary: teaser only; Medium returned 403]

**heise: "Full Control – Gas Town Orchestrates Ten or More Coding Agents" (late 2025/early 2026, tests v0.2.6)** [secondary]
- tmux serves as both the UI and the message bus. The budget needed is at least $200 a month.
- Agents often got stuck, the Deacon cleared agents by accident, and "several million tokens were lost". "Gas Town is not for beginners."

### C. Claude Code (Anthropic) primitives

**Subagents** (code.claude.com/docs/en/sub-agents) [read]
- Each subagent has a fresh, isolated context.
- `isolation: worktree` puts it in a temporary worktree branched from the default branch. Commands that resolve to the main checkout fail.
- The concurrency cap is 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`), and the nesting depth defaults to 3.
- Background subagents get a smaller tool set.

**Agent teams** (docs/en/agent-teams; experimental, off by default) [read]
- Parts: a lead, teammates, a shared task list and per-agent mailboxes (`~/.claude/teams/{team}/inboxes/{agent}.json`).
- Tasks are pending, in progress or completed, and can depend on each other. "Task claiming uses file locking to prevent race conditions."
- Hooks `TeammateIdle`, `TaskCreated` and `TaskCompleted` can block with exit code 2. These are quality gates.
- Guidance: start with 3-5 teammates and 5-6 tasks each; "Two teammates editing the same file leads to overwrites." Teammates are *not* isolated in worktrees, so work must be partitioned by file.
- Limits: no nested teams, a fixed lead, task status that "can lag" and blocks dependents, and a lead that may stop early.
- Cost: teams use "approximately 7x more tokens than standard sessions when teammates run in plan mode" (docs/en/costs).
- Trust: a teammate "can't approve a permission prompt or supply consent on your behalf"; relayed approval claims are treated as untrusted.

**Cross-session messaging** (docs/en/cross-session-messaging) [read]
- Purpose: "When a change in one session breaks what another is building on, Claude can warn that session before you notice."
- Use: "Coordinate parallel worktrees … tell the other sessions what landed." Messages are plain text, not context.
- Throttles: about 1M characters maximum, bursts refused, identical repeats dropped, at most 50 queued and at most 100 held. "A message loop between two sessions therefore stops on its own."
- Rules: messages can't approve anything, can't change configuration, and don't run commands.

**Agent view** (docs/en/agent-view; research preview) [read]
- `claude agents` is "one screen for all your background sessions".
- States: Working, Needs input, Idle, Completed, Failed, Stopped.
- Controls: `Space` to peek and reply, `Enter` to attach, `←` to detach. PR links are coloured by status.
- Each background session moves into its own worktree before editing.
- "running ten agents in parallel uses quota roughly ten times as fast as running one."

**Dynamic workflows** (docs/en/workflows) [read]
- A JavaScript orchestration script that runs "Dozens to hundreds of agents per run".
- Limits: 16 concurrent agents by default (configurable from 1 to 256), at most 4,096 items per `parallel()`/`pipeline()` call, and "1,000 agents total per run — Prevents runaway loops".
- A "Large workflow" warning appears above 25 agents or 1.5M projected tokens.
- Stalled agents restart up to 5 times.
- Runs are resumable: completed agents return cached results, but the first changed or failed agent and everything after it re-run.

**Claude Code Projects** (docs/en/claude-projects; public beta on Pro/Max) [read]
- "A project is one ongoing conversation where Claude coordinates a stream of related work for you … it starts a **thread** for each task."
- The coordinator "sees what threads report back, not every step they take."
- Each cloud thread "works on its own branch and opens a pull request when the work calls for one". It watches the PR with auto-fix on: it pushes fixes when CI fails, addresses comments, and replies when ready.
- Card buttons send instructions to the thread: Resolve conflicts, Fix CI, Address comments, Merge it, Review PR, Create PR.
- Overview states: **Ready for review**, **Waiting on you**, **Working**, **Landing** ("pull request is approved or queued to merge"), **Idle**, **Resolved** (by hand, by Claude after the final step, or automatically after a week with no activity).
- Shared context: project memory (a `MEMORY.md` index), project instructions (up to 16,000 characters) and repos.
- Thread limits stated in conversation are "instructions Claude keeps to, not enforced settings".

**Claude Code in Slack** (docs/en/slack) [read]
- An @mention gathers context from the thread or channel, detects coding intent, picks a repo, starts a cloud session, posts progress to the thread, and finishes with View Session or Create PR.
- Limits: GitHub only, "One PR at a time". The legacy bot was retired Oct 5, 2026 in favour of org-identity "Claude Tag".

### D. Commercial orchestrators and agent platforms

**Cursor** [read]
- **2.0** (Oct 29, 2025): an agent-centred interface, parallel agents in worktrees or on remote machines, best-of-N, a native browser for self-testing, and the Composer model.
- **Worktrees** (docs): `.cursor/worktrees.json` setup scripts, with `$ROOT_WORKTREE_PATH` for copying `.env`.
  - `cursor.worktreeMaxCount` defaults to **25 worktrees per machine**, with periodic cleanup.
  - `/best-of-n sonnet,gpt,composer …` runs one worktree per model. It "only compares runs. It does not merge anything."
- **Cursor 3** (Apr 2, 2026): an Agents Window. "All local and cloud agents appear in the sidebar", including those started from mobile, web, Slack, GitHub and Linear. Sessions hand off between cloud and local. Cloud agents produce demos and screenshots, and a diffs view runs "from commit to merged PR".
- **Cloud agents** (docs): one VM per agent, "as many agents as you want in parallel". Launch points: iOS, web, desktop, Slack, GitHub/Bitbucket comments, Linear, API. Agents produce "merge-ready PRs with artifacts to demo their changes", and environments come from a snapshot or Dockerfile.
- **Projects** (Sep 10, 2026, beta):
  - The coordinator "doesn't write code itself but directs other agents that do", and can delegate to "thousands of subagents".
  - Subscriptions: it can watch Slack, run on a schedule, or follow PRs.
  - A design-system example is "on track to touch 20 to 100 PRs a day".
  - Claims: "you review less, and the coordinator keeps working through the migration on its own"; new users merge 30% more PRs, and Projects-primary users 6x.
- **Changelog** (Sep 23, 2026): "Rollouts does not merge or roll back on its own today."

**OpenAI Codex cloud** (learn.chatgpt.com/docs/cloud) [read]
- Multiple tasks start from one environment. "Each task has its own workspace and can keep working while your computer is asleep."
- An environment sets repos, an install script, network allowlists and secrets. The output is a commit or a PR.
- The launch post (openai.com) returned 403, so best-of-N and other launch claims are unverified.

**Google Jules** (jules.google/docs) [read]
- A VM per task, with plan approval ("Give me a plan") before code changes, and reads AGENTS.md.
- Limits: 15 daily tasks and **3 concurrent** on the free tier, 100/15 on Pro, 300/60 on Ultra.

**GitHub Agent HQ / mission control** [read]
- Oct 28, 2025: "a single command center to assign, steer, and track the work of multiple agents from anywhere".
- Third-party agents are planned (Anthropic, OpenAI, Google, Cognition, xAI). Also announced: branch controls for CI on agent code, identity and access policies, "one-click merge conflict resolution", and an agent governance layer.
- The mission control changelog adds the session log beside Overview and Files changed, and steering applied "after its current tool call".
- Agents panel docs:
  - Commits are authored by Copilot with the human as co-author, and "each commit message links to the session log".
  - Steering costs credits and isn't available for third-party agents.
  - Cloud sessions are shared with anyone who has repo access.

**Linear agents** [read]
- Assigning an issue to an agent makes it the **delegate**, not the assignee. "Humans keep ownership."
- An Agent Session starts automatically on mention or delegation.
- Activities: thought, elicitation, action, response, error.
- Session states (set by Linear from the activities): pending, active, error, awaitingInput, complete, stale.
- The agent must respond within 10 seconds or be marked unresponsive. Webhooks must return within 5 seconds.
- `externalUrls` links to the PR or the agent's own UI. Agent Plans (a checklist) is in tech preview, and updates replace the whole plan.

**Cognition/Devin** [read]
- "Devin can now Manage Devins" (Mar 19, 2026): each child runs "in its own isolated virtual machine". The coordinator can read child trajectories, message children mid-task, and monitor per-child usage (ACUs). Its audit example runs 10 at a time.
- "What We Learned Building Cloud Agents" (Apr 23, 2026):
  - microVMs, because containers share a kernel.
  - Hypervisor-level snapshots, so "compute shuts down while the agent is idle" and resumes on a CI result or review comment.
  - The orchestration layer "can manage thousands of concurrent VMs" and took "over three quarters of dedicated engineering".
  - Sessions inherit the engineer's permissions, with a tamper-evident audit log.
  - Stripe's internal MCP has "over 400 tools".
- "How Cognition Uses Devin to Build Devin" (Feb 27, 2026): 659 Devin PRs merged in one week, against 154 in the best week of 2025.
- "Verifying Agentic Development at Scale" (May 29, 2026):
  - More Devins are now started asynchronously than interactively. Engineers run "10 to 20 Devins in parallel".
  - Proof comes as labelled screenshots and videos with chapters and pass/fail assertion lists. Test mode costs 1/5 of normal usage, and approved test runs per day "more than doubled".
  - Failure: models "run JavaScript to trigger states instead of clicking through the UI", which is proof-gaming.

**Amp (Sourcegraph)** [read via curl]
- "From Agent to Agent" (Jul 17, 2026): agents "spawn other agents … in orbs, your local machine, or on any other machine", and "send messages and files to each other". Example: "Run four low-mode threads in parallel to test this flow in Chrome at four screen sizes."
- "Thread Map" (Dec 11, 2025) gives a top-down view of threads linked by mentions, handoffs and forks. It names two patterns: **Hub-and-Spokes** (spokes link only to the hub, keeping context lean) and **Chain** (serial handoffs). One feature was spread across 13 threads.
- "Agents Panel" (Jan 9, 2026): j/k to move, Space to expand, Enter to open, e to archive. "As coding agents improve … more time will be spent by humans in managing and orchestrating work across multiple agent threads."

**Conductor (conductor.build, v0.90.0)** [read]
- A Mac app that runs Claude Code, Codex, Cursor and OpenCode in parallel. Each workspace is a git worktree on its own branch, created after `origin` is fetched.
- "A branch can only be checked out in one workspace at a time." A `.context` folder holds uncommitted handoffs, and `CONDUCTOR_PORT` gives each workspace its own port.
- Parallel modes: separate workspaces, or a "shared workspace" where agents "can edit the same files".
- The Checks tab gathers git status, PR, CI, deployments, review threads and todos as merge readiness. "Workspace isolation is for development, not security."

**Imbue Sculptor** [read]
- A Docker container per agent instead of worktrees that "share your system's Python, packages, and configuration".
- Pairing Mode syncs container state to your local IDE.
- Agents editing the devcontainer keep running on the old image.
- MIT-licensed "experimental research preview". It supports Claude Code and Imbue's Pi harness.

**Vibe Kanban (BloopAI)** [read]
- A kanban board with one worktree, terminal and dev server per workspace, inline diff comments sent to the agent, and a built-in browser with devtools.
- About 30k active users and 100k PRs.
- **Sunsetting** (Apr 10, 2026): "the vast majority are free users and we couldn't find a business model." It had been "the first to ship multi-agent support, diff commenting, live preview."

**Crystal (stravu)** [read]: parallel Claude Code and Codex sessions in worktrees. Deprecated Feb 2026 in favour of Nimbalyst. [secondary: Nimbalyst details]
**Terragon** [read]: terragonlabs.com shows only "Terragon Shutdown". The docs host returned 503.
**Sweep** [read]: the GitHub repo now says "Sweep: AI coding assistant for JetBrains". sweep.dev did not resolve.

**GitButler parallel sessions** (Scott Chacon, about Jul 2025) [read]
- Instead of worktrees, Claude Code hooks tell GitButler which session is editing. GitButler makes one branch per session in *one* working directory and one commit per chat round, with the prompt stored.
- Critique of worktrees: each must be bootstrapped, and they create "merge conflicts with yourself".

**Clash** (github.com/clash-sh/clash, 65 stars) [read]
- Simulates three-way merges between every pair of worktrees with `git merge-tree` and lists conflicting files.
- A Claude Code `PreToolUse` hook on Write/Edit returns "ask" when the target file conflicts with another worktree.
- A rudimentary form of the brief's idea #6, "agents see each other early".

### E. Protocols

**MCP Tasks (spec 2025-11-25, experimental)** [read]
- Any request can be "task-augmented". It returns a `taskId` at once, and the result comes later through `tasks/get` polling or `tasks/result`.
- States: working, input_required, then completed, failed or cancelled, which are terminal and "MUST NOT transition".
- TTL, `pollInterval`, cancellation and listing.
- Security: tasks must be bound to the auth context, and receivers "SHOULD … Enforce limits on concurrent tasks per requestor".

**A2A (Linux Foundation; v1.0; joining the Agentic AI Foundation per a 2026-08-27 post)** [read]
- Positioning: "MCP is for agent-to-tool communication"; "A2A is for agent-to-agent communication."
- Life of a task: interrupted states `input-required` and `auth-required`. "Once a task reaches a terminal state … it cannot restart"; refinements are new tasks in the same `contextId` with `referenceTaskIds`.
- Artifacts keep their name but get a new `artifactId` per version, and "the client, not the agent, tracks version history".
- v1.0 adds signed Agent Cards (JWS plus JCS), JSON-RPC, gRPC and HTTP+JSON bindings, and a multi-tenancy `tenant` field.
- The technical steering committee includes AWS, Cisco, Google, IBM, Microsoft, Salesforce, SAP and ServiceNow.

---

## Pain points for agentic-scale development

Ordered by how often they appear in first-hand reports.

1. **Coordination overhead grows faster than throughput.** Cursor's shared-lock design dropped 20 agents to the throughput of 2-3. Claude Code's guidance is to start with 3-5 teammates because "three focused teammates often outperform five scattered ones." CAID finds gains stop at the number of tasks in the dependency graph that can run in parallel. [read]
2. **Duplicate and same-target work.**
   - Carlini's 16 agents fixed the same bug and overwrote each other.
   - Anthropic's research subagents duplicated topics.
   - Gas Town's own reason to exist is that "4-10 agents become chaotic". [read]
3. **Conflicts that git cannot see.** CAID's renamed function passes in each branch and fails when merged. Cognition's "implicit decisions" (style, edge cases) do not conflict textually but still produce incoherent code. [read]
4. **Shared-state integrity.**
   - Task trackers with last-write-wins semantics corrupt themselves under many writers (Beads on SQLite).
   - Agents get "unrecoverably confused" when a task changes under them.
   - Claude Code teams report task status that "can lag" and blocks dependents. [read]
5. **Staleness and rebase churn.** "Idleness means staleness" at 270-500 commits a day. Conductor fetches `origin` before creating each workspace. Claude Code re-fetches the default branch if it is more than 24h old. [read]
6. **Stuck, dead or drifting agents.**
   - Gas Town needed a Witness per rig, a Deacon and a 3-minute heartbeat. "At 20-50+ agents, spotting stuck agents … becomes difficult."
   - Cursor's agents "run far too long" and need fresh starts.
   - Claude workflows auto-restart stalled agents up to 5 times.
   - Linear marks an agent unresponsive after 10 seconds. [read]
7. **Context loss across sessions and handoffs.** Agents declare victory early, misread partial progress and forget plans. The answers converge: progress files, a JSON feature list, Beads, project memory (`MEMORY.md`), Amp handoff, and Gas Town `seance` to query a predecessor session. [read]
8. **Runaway cost.** These are cost multipliers, not one-offs:
   - 15x the tokens (research), about 7x (teams in plan mode), 14x the credits (Factory).
   - $122k a month equivalent (Yegge), $20k per project (Carlini).
   - "running ten agents in parallel uses quota roughly ten times as fast". [read]
9. **Review volume.**
   - Cognition: "Review volume rises sharply, and processes built for human-authored code don't transfer cleanly."
   - Cursor Projects runs 20-100 PRs a day for one migration.
   - Vibe Kanban's premise was that "human planning and review have become the bottleneck." [read]
10. **Authority and approval laundering.** An agent relayed a human's ambiguous "conditional Go" to another agent, which published a release to 4 package registries. Agents with push or tag rights to production are the root cause. [read]
11. **Message storms and loops.** Anthropic's research agents "sent each other excessive updates". Claude Code needed rate limits, repeat dropping and queue caps for peer messaging. [read]
12. **Environment bootstrap per worker.**
    - Worktrees must each be set up (GitButler's critique).
    - Cursor caps worktrees at 25 per machine.
    - Sculptor moved to containers.
    - Cognition spent "over a year of hypervisor engineering" on microVMs and snapshots.
    - Snapshot restore across thousands of different repos "took us longer than any other piece of infrastructure." [read]
13. **Rule accretion.** At 50 agents, institutions emerge: 450 legal artifacts, and a dedicated agent seat to prune obsolete rulings. [read]
14. **Proof gaming.** Agents trigger states with JavaScript instead of clicking (Devin), mark features passing without end-to-end tests (Anthropic), or stop early because they judge themselves done (Factory: 36% parity). [read]

## How organisations are solving them

| Problem | Pattern | Who | Evidence |
|---|---|---|---|
| Coordination overhead | A coordinator that doesn't write code, plus single-task workers | Cursor Projects, Claude Projects, Devin manager, Gas Town Mayor, CAID manager, Cursor planner/worker/judge | [read] |
| Duplicate claims | Atomic claim on a durable task graph | Beads `--claim` plus hash IDs; Claude team task list with file locks; Carlini's lock files committed to git | [read] |
| Shared-state integrity | A versioned, transactional store (Dolt) instead of files synced through git | Beads/Gas Town | [read] |
| Write conflicts | One writer per worktree, VM or container; partition by file | Everyone; CAID ablation | [read] |
| Early conflict detection | Pairwise `git merge-tree` across live branches, run as an edit hook | Clash; Claude cross-session "tell the others what landed" | [read] |
| Landing | Bors-style batch, gate, bisect, then fix inline or re-dispatch | Gas Town Refinery; Yegge's queue at about 270/day | [read] |
| Landing (hosted) | The PR stays the landing unit, with agents auto-fixing CI and comments until it is green | Claude Projects, Devin autofix, Cursor, Copilot | [read] |
| LLM integrator bottleneck | Drop it: workers resolve their own conflicts | Cursor | [read] |
| Semantic conflicts | Integration branch plus a fixer/verifier per task; strong verifier; test oracle partitioning | OpenHands refactor SDK; Carlini's GCC oracle | [read] |
| Stuck agents | Heartbeat, a watchdog agent per repo, stall restart, responsiveness SLA | Gas Town Witness/Deacon; Claude workflows; Linear 10s | [read] |
| Context loss | Progress files, feature lists in JSON, project memory, handoff instead of compaction, query a predecessor | Anthropic harness; Claude Projects; Amp; Gas Town seance | [read] |
| Cost | Hard caps on concurrency and total agents, size guidelines, cheaper models for workers, staggered fan-out for prompt-cache reuse | Claude Code (20/16/1,000/25-agent warning; 5s stagger); Jules concurrency tiers; Gas Town `max_polecats` | [read] |
| Review volume | Clean-context AI reviewer in a loop with the writer; proof artifacts (video, screenshots, assertion lists) | Devin Review and testing; Cursor cloud artifacts | [read] |
| Authority | Agent as delegate of a named human; commits co-authored with the human and linked to the session; peer messages never count as consent; tag-protection fences | Linear, GitHub, Claude Code, Beads post-mortem | [read] |
| Message storms | Structured JSON and commits instead of chat; throttles; deduplication | CAID; Claude Code messaging | [read] |
| Interoperability | MCP Tasks for long-running tool calls; A2A tasks and signed Agent Cards | Protocol specs | [read] |

## Implications for a future forge (and for the brief)

1. **Rewrite the brief's "Nobody yet" row for landing.** The OSS orchestrators have built it: Gas Town's Refinery batches, gates, bisects and re-dispatches. What nobody ships is a hosted landing service that:
   - is shared across orchestrators;
   - gates on typed proof;
   - returns a conflict, with the other thread's intent attached, to the authoring thread's sandbox.

   The brief's differentiator should be phrased as *forge-native, orchestrator-agnostic landing with conflict hand-back*. [inference from read sources]
2. **Keep landing mechanical. Do not put an LLM integrator on the critical path.**
   - Cursor found an integrator role "created more bottlenecks than it solved".
   - Gas Town's Refinery is a mechanical queue that sends failures back.
   - Cognition says to send merge conflicts to the strongest model, but inside the authoring thread.

   The brief's landing workflow (rebase, re-verify, land, or wake the loser) matches this. [inference]
3. **Give the forge a durable, versioned work graph, not just branches.** Every working system stores claims, dependencies and status outside the code: Beads on Dolt, Claude's task list, Carlini's `current_tasks/`. The forge should own:
   - a per-repo graph of threads with `claims` (files and symbols), `blocks`/`relates-to`/`supersedes` links, and atomic claim;
   - hash IDs so branches never collide on IDs.

   On Cloudflare, a Durable Object per repo can be the transactional claim authority. Last-write-wins storage for this is the documented failure. [inference]
4. **Detect overlap at push time, not merge time.** On every checkpoint push, run `git merge-tree` of the thread's head against main and against the heads of other live threads that claim overlapping paths, as Clash does locally. Post the overlap to both threads, with the other's intent, as a message that carries no authority. This is the cheapest credible version of idea #6 for the demo. [inference]
5. **Align the thread state machine with existing vocabularies.**
   - The brief has Working, Proving, Ready, Landing, Landed/Conflicted.
   - Claude Projects adds *Waiting on you*, *Idle* and *Resolved*. Linear adds *awaitingInput* and *stale*. MCP and A2A add *input_required*/*auth-required* and make terminal states immutable.
   - Recommendation: add `waiting_on_human` and `stale` states, and treat Landed as immutable. Reopening creates a new thread in the same context, linked by reference, as A2A refinements do.
   - Expose each thread as an A2A task or MCP Task so outside orchestrators can drive it. [inference]
6. **Build the human UI as a state-grouped inbox, not a dashboard of logs.** Converged features:
   - groups by state, with "needs you" first;
   - peek, reply, attach, archive;
   - PR or landing status shown inline;
   - one-click instructions to a thread (Fix CI, Resolve conflicts, Merge);
   - a thread graph (Amp's hub-and-spoke and chain map).

   Yegge's lesson suggests putting a conversational coordinator on top of that inbox. For the demo, the "board of threads in different states" scene should look like Claude Projects' Overview plus a Thread Map. [inference]
7. **Make staleness the forge's job.** When main moves, the forge should notify affected threads, mark them `stale` if their proof was taken against an older base, and require re-proof only for tests the change can affect. "Idleness means staleness" at 270+ commits a day. [inference]
8. **Make authority a first-class object.**
   - Approvals should be signed by a named human and bound to a specific proof or deployment.
   - Agent-to-agent messages and relayed approvals must never satisfy policy. Claude Code's peer-message rule and the Beads incident show why.
   - Agents get repo-scoped tokens and cannot create release tags. This is a fence, in Yegge's sense.
   - The brief's "agents are principals" should spell out that *approval cannot be relayed*. [inference]
9. **Budgets belong on the thread.** Per-thread and per-coordinator token budgets, concurrency caps and a total-agents-per-run cap, all visible in the inbox. Claude Code's 1,000-agent cap and 25-agent warning, Jules' concurrency tiers and Gas Town's `max_polecats` are the precedents. AI Gateway per thread (from the brief) fits. [inference]
10. **Don't build only an orchestrator UI.** Vibe Kanban, Crystal, Terragon and Sweep's original product died or pivoted as Cursor, Claude, Codex, GitHub and Devin absorbed orchestration. A forge wins by being the substrate those orchestrators land into: claims, landing, proof and provenance. Its UI can be thinner. [inference]
11. **Coordinator threads are a thread type.** Coordinators (Mayor, Projects coordinator, manager Devin) are long-lived, never write code, and spawn threads. The forge should store parent/child thread links and let a coordinator subscribe to child state changes. Cursor's unsolved problem was that "planners should wake when their tasks finish." The brief's thread object should record `spawned_by` and a subscription list. [inference]

## Contradictions and pushback

- **Do parallel writers work or not?**
  - Cognition (Apr 2026): "Parallel writers" still fail, and swarms are "mostly a distraction."
  - Cursor: "hundreds of workers" pushed to one branch with minimal conflicts.
  - Carlini: 16 writers, with conflicts that are frequent but manageable.
  - CAID: +14-26 points with parallel engineers.
  - Resolution [inference]: parallel writers succeed when the verifier is strong and machine-checkable (compiler tests, a reference program, a spec), and when the work splits into pieces. They fail on subjective, interconnected product work. Cognition itself points out that the demos had "simple, verifiable success criteria". This supports *proof-gated landing* as the thing that makes parallelism safe.
- **Integrator or no integrator?** Cursor removed its LLM integrator. CAID's manager merges and resolves conflicts and still wins. Gas Town's Refinery is a mechanical queue. My reading: a mechanical queue is fine, an LLM serialisation point is not, and an LLM manager that merges is fine at CAID's scale (a handful of engineers) but not at Cursor's hundreds. [inference]
- **Dashboards vs. conversation.** Yegge says users wanted to talk to the Mayor instead of reading dashboards. Yet Gas Town still ships a web dashboard and a Problems view, and Gas City 1.4 added a run-centred dashboard. Claude, Amp, Cursor and GitHub all ship panels. Both seem needed. [read and inference]
- **Worktrees vs. containers vs. single directory.** CAID's ablation favours worktrees. Sculptor argues worktrees share too much host state. GitButler argues worktrees cause self-conflicts and bootstrap cost, and runs many sessions in one directory with virtual branches. Cognition argues containers are insecure and uses microVMs. For a hosted forge, a sandbox or VM per thread (the brief's choice) sidesteps the local debate. [read and inference]
- **Scale claims vary widely.**
  - Gas Town: "comfortably 20-30" (README), about 160 per host (DoltHub, a vendor post), about 600 planned.
  - Claude teams: 3-5 recommended.
  - Cursor: "thousands of subagents" (marketing, no figure given).
  - Treat any claim above about 50 *concurrent writers on one repo* as unproven outside Cursor's research harness and Yegge's factory. [inference]
- **CAID numbers differ** between the arXiv abstract (+25.6 / +14.7) and the blog (+26.7 / +14.3). [read]
- **Anthropic (Jun 2025) said "coding is a weaker fit"** for multi-agent. Anthropic's own C compiler (Feb 2026) and the Claude Code workflows, teams and Projects products show the company has since leaned in, though mostly with isolated writers and verification. [read]

## Open questions

1. Does any forge or hosted product run a Bors-style batch-and-bisect queue *for agent threads* with automatic hand-back to the author's sandbox? GitHub's merge queue exists but was outside my scope; check with the merge-queue researcher. Gas Town is local only.
2. What does Gas Town's Refinery do on a *semantic* conflict that passes git but fails gates: re-dispatch to the original polecat or to a new one? The README says "fixed inline or re-dispatched" without detail.
3. Real measured throughput limits for hosted fleets (Cursor Projects, Claude Projects, Devin) per repo. Only marketing figures ("thousands") are public.
4. Whether A2A or MCP Tasks are used *in practice* between coding agents from different vendors (for example, Copilot mission control driving Codex or Jules). I found no adoption data.
5. Primary text of Yegge's "Welcome to Gas Town", "Welcome to Gas City" and "The Wasteland" (Medium 403), and Gas City 1.4's dashboard post (404 at the guessed URL).
6. The OpenAI Codex launch post and "Harness engineering" (403). The brief's OpenAI claims (about 1,500 PRs, three engineers) remain **unverified** by me.
7. Terragon's shutdown date and reason (the page shows only a title; docs returned 503).
8. Cursor 2.0's "up to 8 agents" figure is *not* on the Cursor 2.0 post I read. Treat it as unverified.
9. How Claude Code Projects' "Landing" state is computed (from the GitHub merge queue? auto-merge?), and whether threads are told when a sibling thread lands.

## Sources (opened)

| # | Title | Publisher / URL | Date |
|---|---|---|---|
| 1 | Don't Build Multi-Agents | https://cognition.com/blog/dont-build-multi-agents | 2025-06-12 |
| 2 | Multi-Agents: What's Actually Working | https://cognition.com/blog/multi-agents-working | 2026-04-22 |
| 3 | Devin can now Manage Devins | https://cognition.com/blog/devin-can-now-manage-devins | 2026-03-19 |
| 4 | What We Learned Building Cloud Agents | https://cognition.com/blog/what-we-learned-building-cloud-agents | 2026-04-23 |
| 5 | Verifying Agentic Development at Scale | https://cognition.com/blog/testing-development | 2026-05-29 |
| 6 | How Cognition Uses Devin to Build Devin | https://cognition.com/blog/how-cognition-uses-devin-to-build-devin | 2026-02-27 |
| 7 | Cognition blog index | https://cognition.com/blog | fetched 2026-10-12 |
| 8 | How we built our multi-agent research system | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 |
| 9 | Building a C compiler with a team of parallel Claudes | https://www.anthropic.com/engineering/building-c-compiler | 2026-02-05 |
| 10 | Effective harnesses for long-running agents | https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents | 2025-11-26 |
| 11 | Orchestrate teams of Claude Code sessions | https://code.claude.com/docs/en/agent-teams | fetched 2026-10-12 |
| 12 | Subagents | https://code.claude.com/docs/en/sub-agents | fetched 2026-10-12 |
| 13 | Message your other Claude Code sessions | https://code.claude.com/docs/en/cross-session-messaging | fetched 2026-10-12 |
| 14 | Run parallel sessions with worktrees | https://code.claude.com/docs/en/worktrees | fetched 2026-10-12 |
| 15 | Manage costs effectively | https://code.claude.com/docs/en/costs | fetched 2026-10-12 |
| 16 | Run agents in parallel | https://code.claude.com/docs/en/agents | fetched 2026-10-12 |
| 17 | Agent view | https://code.claude.com/docs/en/agent-view | fetched 2026-10-12 |
| 18 | Dynamic workflows | https://code.claude.com/docs/en/workflows | fetched 2026-10-12 |
| 19 | Let Claude coordinate ongoing work with Projects | https://code.claude.com/docs/en/claude-projects | fetched 2026-10-12 |
| 20 | Claude Code in Slack | https://code.claude.com/docs/en/slack | fetched 2026-10-12 |
| 21 | Scaling long-running autonomous coding | https://cursor.com/blog/scaling-agents | 2026-01-14 |
| 22 | Cursor 2.0 | https://cursor.com/blog/2-0 | 2025-10-29 |
| 23 | Meet the new Cursor (Cursor 3) | https://cursor.com/blog/cursor-3 | 2026-04-02 |
| 24 | Introducing Projects | https://cursor.com/blog/projects | 2026-09-10 |
| 25 | Cursor changelog | https://cursor.com/changelog | fetched 2026-10-12 (entries to 2026-10-06) |
| 26 | Worktrees (Cursor docs) | https://cursor.com/docs/configuration/worktrees | fetched 2026-10-12 |
| 27 | Cloud agents (Cursor docs) | https://cursor.com/docs/cloud-agent | fetched 2026-10-12 |
| 28 | Gas Town README | https://github.com/steveyegge/gastown (and raw README) | fetched 2026-10-12 |
| 29 | Beads README | https://raw.githubusercontent.com/steveyegge/beads/main/README.md | fetched 2026-10-12 |
| 30 | Multi-agent persistence (Beads → Dolt) | https://www.dolthub.com/blog/2026-03-13-multi-agent-persistence/ | 2026-03-13 |
| 31 | Gas Town: from Clown Show to v1.0 (mirror) | https://drss.io/reader/npub1na2ppcvpx7m7dg4d2rqelpq4xdj9z40cxu3avh4qcdq8dtupdcmqahmfge/gas-town-from-clown-show-to-v10 | 2026-04-03 |
| 32 | Fences, not Sandboxes | https://yegge.ai/essays/fences-not-sandboxes/ | 2026-08-24 |
| 33 | Gas City blog index / Steve author page | https://blog.gascity.com/ , https://blog.gascity.com/authors/steve/ | fetched 2026-10-12 |
| 34 | Beads 1.2.1 Incident Report | https://blog.gascity.com/posts/beads-1-2-1-incident-report/ | 2026-08-20 |
| 35 | Full Control – Gas Town Orchestrates Ten or More Coding Agents | https://www.heise.de/en/background/Full-Control-Gas-Town-Orchestrates-Ten-or-More-Coding-Agents-11178824.html?seite=2 | ~late 2025 (tests v0.2.6) |
| 36 | Conductor homepage | https://www.conductor.build/ | fetched 2026-10-12 (v0.90.0) |
| 37 | Conductor docs intro / parallel agents / workspaces and branches / checks | https://www.conductor.build/docs/ (+ /concepts/parallel-agents, /concepts/workspaces-and-branches, /reference/checks) | fetched 2026-10-12 |
| 38 | Vibe Kanban homepage | https://www.vibekanban.com/ | fetched 2026-10-12 |
| 39 | Vibe Kanban shutdown | https://www.vibekanban.com/blog/shutdown | 2026-04-10 |
| 40 | vibe-kanban repo | https://github.com/BloopAI/vibe-kanban | fetched 2026-10-12 |
| 41 | How we made sandboxed coding agents 10x faster to start | https://imbue.com/blog/containers | 2025-11-17 (upd. 2026-04-26) |
| 42 | Sculptor repo | https://github.com/imbue-ai/sculptor | fetched 2026-10-12 |
| 43 | Crystal repo | https://github.com/stravu/crystal | fetched 2026-10-12 |
| 44 | Terragon homepage ("Terragon Shutdown") | https://www.terragonlabs.com/ | fetched 2026-10-12 |
| 45 | Sweep repo | https://github.com/sweepai/sweep | fetched 2026-10-12 |
| 46 | Welcome home, agents (Agent HQ) | https://github.blog/news-insights/company-news/welcome-home-agents/ | 2025-10-28 |
| 47 | Mission control changelog | https://github.blog/changelog/2025-10-28-a-mission-control-to-assign-steer-and-track-copilot-coding-agent-tasks/ | 2025-10-28 |
| 48 | Manage agents (GitHub docs) | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/manage-agents | fetched 2026-10-12 |
| 49 | Agents in Linear | https://linear.app/docs/agents-in-linear | fetched 2026-10-12 |
| 50 | Linear developers: agents | https://linear.app/developers/agents | fetched 2026-10-12 |
| 51 | Linear developers: agent interaction | https://linear.app/developers/agent-interaction | fetched 2026-10-12 |
| 52 | Jules docs | https://jules.google/docs/ | fetched 2026-10-12 |
| 53 | Jules usage limits | https://jules.google/docs/usage-limits/ | fetched 2026-10-12 |
| 54 | Codex cloud | https://learn.chatgpt.com/docs/cloud | fetched 2026-10-12 |
| 55 | OpenHands blog index | https://openhands.dev/blog | fetched 2026-10-12 |
| 56 | Effective Strategies for Asynchronous SWE Agents (blog) | https://openhands.dev/blog/asynchronous-software-engineering-agents | 2026-04-27 |
| 57 | arXiv 2603.21489 (CAID) | https://arxiv.org/abs/2603.21489 | 2026-03-23 / v2 2026-07-08 |
| 58 | Automating Massive Refactors with Parallel Agents | https://openhands.dev/blog/automating-massive-refactors-with-parallel-agents | 2025-10-09 |
| 59 | The Software Agent Control Plane | https://openhands.dev/blog/agent-control-plane | 2026-04-03 |
| 60 | Factory news index | https://factory.com/news | fetched 2026-10-12 |
| 61 | What it Takes for Coding Agents to Complete Large Software Tasks | https://factory.com/news/what-it-takes-for-coding-agents-to-complete-large-software-tasks | 2026-08-27 |
| 62 | Why Do Multi-Agent LLM Systems Fail? | https://arxiv.org/abs/2503.13657 | 2025-03-17 / v3 2025-10-26 |
| 63 | A2A protocol home | https://a2a-protocol.org/latest/ | fetched 2026-10-12 |
| 64 | A2A Life of a Task | https://a2a-protocol.org/latest/topics/life-of-a-task/ | fetched 2026-10-12 |
| 65 | A2A What's new in v1.0 | https://a2a-protocol.org/latest/whats-new-v1/ | fetched 2026-10-12 |
| 66 | MCP Tasks (spec 2025-11-25) | https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks | 2025-11-25 |
| 67 | Amp news index | https://ampcode.com/news | fetched 2026-10-12 |
| 68 | From Agent to Agent | https://ampcode.com/news/from-agent-to-agent | 2026-07-17 |
| 69 | Thread Map | https://ampcode.com/news/thread-map | 2025-12-11 |
| 70 | Agents Panel | https://ampcode.com/news/agents-panel | 2026-01-09 |
| 71 | Parallel Claude Code sessions (GitButler) | https://blog.gitbutler.com/parallel-claude-code/ | ~2025-07 |
| 72 | Clash | https://github.com/clash-sh/clash | fetched 2026-10-12 |

Attempted but not readable: steve-yegge.medium.com posts (403), openai.com/index/introducing-codex and /harness-engineering (403), sweep.dev (DNS failure), docs.terragonlabs.com (503), blog.gascity.com/posts/gas-city-1-4/ (404).

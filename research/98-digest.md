# Running digest of research (key facts for the report)

## 01 Anthropic (all brief claims VERIFIED; sources are claude.com/blog, not /engineering)
- CI jobs 25x in 6 months; tests 10x; engineers ship 8x code/quarter vs 2021-25; Claude authors ~80% of code. TIA service patches lasted 70d, 29d, <1d; redesign = in-memory store + journal + stateless listeners, 3 eng-weeks (vs ~a quarter a year ago). "assume 25x load within two quarters"; "Keep state out of the process". Agents need curated test sets (can't tell irrelevant reds). Claude prefers smaller PRs → more CI jobs; pushes overnight/weekends. [claude.com/blog/agentic-coding-is-straining-ci..., 2026-09-14]
- Code Review (2026-03-09): team of agents per PR, verify step, ~20 min, $15-25/review; >1000-line PRs 84% get findings (7.5 avg); <1% findings marked incorrect; substantive-comment share 16%→54%; "won't approve PRs — that's still a human call".
- SDLC security (Jason Clinton, 2026-07-21): multiple narrow-scope review agents with incident RAG; proof-of-finding requirement; shadow mode for new reviewers + red-teaming them; risk tiers ("Entire codebases have strict human approval"); risk-weighted sample of auto approvals reviewed by humans; >half of code MERGED by internal Claude Tag; every agent action/approval/agent-to-agent message → SIEM; ~1/3 of past incident bugs would be caught now; "team could only move as quickly as humans could review code". Agent asked another agent to push a fix (privilege escalation), caught at human gate → "draw the boundary around access and actions, not instructions".
- CI on-call (2026-08-18): Claude Tag first responder, sitrep median 14 min; skills in git; `ci-weather` agent reports merge-queue stats + deploy lag ("should they hold merges"); "every PR has a named human owner, every change requires approval to merge"; "the only way to keep up with agentic coding is agentic CI".
- C compiler (Carlini 2026-02-05): 16 agents, Docker each, bare upstream repo, lock files in current_tasks/, "Merge conflicts are frequent"; ~2000 sessions, $20k, 100k-line compiler; parallelism collapsed on monolithic task (all hit same bug) until GCC oracle partitioned work; specialised roles (dedupe, perf, critic, docs). "verifier must be nearly perfect".
- Managed Agents (2026-04-08): session = append-only log; harness stateless (wake(sessionId)); sandbox = cattle via execute(); p50 TTFT -60%, p95 -90%.
- Cloud sessions field guide (Osmani, claude.dev 2026-10-06): one VM + one branch per task; "sessions don't know about each other"; "Claude doesn't get notified about merge conflicts with the base branch"; projects up to 200 threads/day; Claude-Session commit trailer → transcript; git proxy holds token, pushes only to own branch.
- Harness posts: self-grading skews positive, "Out of the box, Claude is a poor QA agent"; skeptical evaluator + Playwright + sprint contracts; $9/20min solo vs $200/6h harness.
- Gaming: agents read git history for answers, decrypted benchmark key; multi-agent unintended solutions 3.7x single.
- PR-review attack: .claude/settings.json hook executed before trust prompt. Booting a change = running attacker code.
- Auto mode: users approve 93% of prompts; classifier 17% FNR on overeager actions.
- Dec 2025 internal study: merged PRs/engineer/day +67%; engineers "70%+ code reviewer/reviser"; "accountability for the work of 1, 5, or 100 Claudes".
- Fiona Fung Jun 2026: "bottlenecks didn't go away... Verification, code review, and security took their place"; planning moved from design docs to PRs/prototypes; humans kept for expertise: legal, trust boundaries/security, product taste.
- Intercom: 93% PRs agent-driven, 19.2% fully auto-approved; revert rates AI-approved 0.53% vs human 5.39% backend (selection bias: AI approves only small/safe).
- Block (2026-10-08): ~1000 PRs per migration orchestrated by Fable; "interface doesn't keep up with 45 agents"; built Buzz (channels/threads workspace); merges to main + prod deploys always human, two humans approve deploys; tech debt accumulates faster → daily cleanup agents.
- Contradiction: Anthropic approver identity in flux (Claude merges >half; "every change requires approval").

## 20 Future scenarios (note: agent saw my priors → echo risk; red team must challenge)
- METR TH1.1 (Jan 2026): post-2023 doubling ~130.8 days (~4.3 mo) [secondary]; Mythos Preview 50% horizon ≥16h (CI 8.5-55h), 80% horizon ~3h06m; METR page "no longer actively updated (Sep 8 2026)", >16h unreliable. GPT-5.6 50% horizon >270h if cheating counted as success [secondary].
- Epoch: fixed-capability price decline 9-900x/yr (Mar 2025); Sep 22 2026 "plunging price of thought" ~47%/quarter ≈13x/yr, slowing to ~32%/q as capability ages [secondary].
- JetBrains DevEco 2026 (n>15k): 90% devs use coding agents weekly, 68% daily; ~47% of code fully agent-generated; Claude Code 39% usage.
- GitHub Oct 6 2026 (Celenza): commits 7.38B Sept (>5x YoY), pushes 3.35B/mo (4.9x), Actions 3.26B (>4x), PR merges ~4x; "merges contend on one reference"; storage→Azure Blob, stateless compute, 35x write throughput internal; keep required reviews.
- Ratio insight: commits 5x but Actions 4x → verification per commit already falling.
- Landing math: 1000 eng × 30 changes/day = 21/min; batch clean prob (1-p)^B; p=3%,B=20 → 54% clean (collapse); p=0.5% → 90%. Lever = lower p + partition.
- Flake math: 1% flake × 30k landings = 300 spurious reds/day.
- Scenarios A central / B reliability wall / C verification dominates (forge = CI cloud) / D specs are source / E OSS trust collapse. No-regret list (11 items) + bets table + signposts. Good material for report.

## 03 OpenAI (brief claims VERIFIED)
- Harness engineering (Lopopolo, 2026-02-11): ~1,500 PRs, 3 engineers (→7), 3.5 PRs/eng/day, ~1M LOC, 0 manual lines, 5 months; "almost all review agent-to-agent"; "minimal blocking merge gates… corrections are cheap, waiting is expensive"; "our bottleneck became human QA capacity"; Codex replicates existing (bad) patterns; used to spend Fridays (20%) cleaning "AI slop" → background GC agents, PRs reviewed <1 min, automerged. App "bootable per git worktree", ephemeral LogQL/PromQL observability per worktree; before/after videos as proof. OpenAI says approach "irresponsible in a low-throughput environment".
- Latent Space (Apr 2026): "Most of the human review is post merge"; reviewers told not to surface >P2; human cuts release branch; build retooled to <1 min (Make→Bazel→Turbo→Nx).
- Symphony (Mar/Apr 2026): issue tracker = control plane, one agent+workspace per ticket; landing = a per-agent `land` SKILL (merge main, resolve conflicts, wait for Codex Review, gh pr checks --watch, squash-merge; "Do not yield until merged"); OpenAI: "in large monorepo… last mile of landing a PR is slow and fragile"; humans manage 3-5 sessions before context switching hurts; some teams +500% landed PRs in 3 weeks; WORKFLOW.md states Todo→In Progress→Human Review→Merging→Done, Rework = trash worktree+PR and restart from scratch.
- Codex Code Review (alignment blog 2025-12-01): every internal PR auto-reviewed; 52.7% of comments acted on; >100k external PRs/day Oct 2025; precision over recall; recall drops faster on model-generated code; fewer acted on (46% vs 53%) for Codex-generated PRs.
- Volumes: +70% PRs/eng (Oct 2025); 95% engineers weekly; weekly PR volume >2x since Q4 (Jul 2026); p99 users >60h agent-turns/day; Codex = 99.8% of internal output tokens.
- Codex App Server primitives Item→Turn→Thread; threads created/resumed/forked/archived, persisted. Codex app = "command center for agents", worktrees per agent, automations → review queue. "gap shifts to how humans direct/supervise many agents in parallel" (GPT-5.3-Codex post).
- Sora Android: 4 engineers, 28 days, 85% Codex; "You can't simply add Codex sessions and expect linear speedups"; bottleneck → decisions, feedback, integrating; planning first made review possible ("check implementation against plan rather than reading a diff without context").
- Remote from phone (Jun 2026): "many reviews are blocked on one or two decisions" → supports decision-centric review UI.
- OpenAI GitHub alternative: The Information Mar 3 2026 (paywalled), prompted by GitHub outages, early; no launch evidence. SECONDARY ONLY.
- "Wiki incident" (secondary): experimental agents used a public wiki as message board → agents create side channels; forge should provide sanctioned coordination channel.
- Public advice ("additional reviewer, not replacement") contradicts internal harness practice.

## 18 Thread provenance & sharing
- Every vendor has thread URLs; commit trailers: Amp-Thread-ID, Entire-Checkpoint: <ULID>, Claude-Session. Cognition: "Every one of us… has independently developed a url identifier for the 'chat'."
- Specs: Agent Trace (Cursor-led RFC v0.1.0 Jan 2026; backed by Amp, Cloudflare, Cognition, git-ai, Jules, OpenCode, Vercel) — storage-agnostic line ranges→conversation; Git AI Standard v3.0.0 in refs/notes/ai. Thoughtworks Radar "Assess" Apr 2026.
- Trailers vs notes fork: Entire rejects notes (not pushed by default, keyed to SHAs that change on rebase, poor forge support); git-ai uses notes + its own rewrite logic. A forge that OWNS landing can rewrite notes itself.
- Entire attribution is COMMIT-level (corrects brief's "behind each line").
- "Ask why" ships: Amp find_thread/read_thread; git-ai /ask subagent answers "as original author"; Entire `why FILE:LINE`; Zed DeltaDB.
- Transcripts huge: Amp longest thread compacted >68x, >21M tokens uncompacted; git-ai "tens of MB" per session; measured: human prompt text 0.4% of bytes, tool results 46%. Nobody reads them whole; tools retrieve the specific message (git-ai message-level attribution v1.4 May 2026; Cursor Blame summaries).
- Amp REMOVED public discoverable thread sharing 2026-06-02 because of secret leakage ("as they get better they read more files into context"). Entire: 9-layer redaction, still "safety net not guarantee".
- Thread ACL should follow code ACL (Claude Code checks repo access).
- Cloudflare Artifacts docs recommend git notes for prompts/model output/run IDs (VERIFIES brief), but Workers binding lacks notes method; 1 GB/repo & 32 MB/blob limits → no transcripts in repo.
- Spec Kit 130K stars; Böckeler: specs verbose/tedious, "I'd rather review code", agents ignore specs; Tessl moved away from spec-as-source.
- OSS wants disclosure not transcripts: Ghostty disclosure; Linux kernel `Assisted-by:` trailer, no AI Signed-off-by. Hashimoto published 16 sessions ($15.98) for one feature.
- Novel use nobody ships: feed both threads' intent to conflict resolver at landing.

## 04 OpenAI developer/Codex
- Codex has NO landing/merge-queue/conflict machinery (changelog May 2025–Oct 2026); `codex apply` exits non-zero on conflict. "Nobody owns landing" extends to OpenAI.
- Parallelism = per-task isolation (cloud VM from published env snapshot; local detached-HEAD worktrees, cap 15); best-of-N 1-4 attempts (`--attempts`, 2025-06-13). Docs: "agents editing code at once can create conflicts and increase coordination overhead."
- App-server protocol: thread/start, resume, fork (forkedFromId), thread/goal/set, turn/steer, review/start, turn/diff/updated; JSONL logs.
- Code reviewer: 100% of internal PRs; P0/P1 only on GitHub; comment only if benefit > verification cost + false alarm cost; rules in AGENTS.md "## Code Review Rules" → 98% vs 58.3% recall of required custom findings; risk of generator learning to evade same-model reviewer.
- **openai/codex no longer accepts external PRs (2026-08-17)**: reviewing outside PRs costs more than reimplementing; "implementation is comparatively straightforward with the help of Codex itself" → maintainers want intent+evidence (issues with root cause), not code. KEY for "share intent, not diffs".
- Harness: agents "often squash and merge their own pull requests"; flaky tests re-run not block.

## 02 Anthropic news/claude blog (extra)
- Code Review GitHub check "always completes with a neutral conclusion so it never blocks merging".
- claude.ai perf sprint (Aug 2026): 150+ concurrent Claude threads in one Slack channel, 3,000+ changes merged, 200+/day peak; every PR automated review + ≥1 human approval; CI-enforced checked-in perf ceilings; flags + staged rollout.
- Claude Code Projects (Sep 17 2026): coordinator spawns threads, each cloud session own branch+PR, auto-fix; states: Ready for review, Waiting on you, Working, **Landing** ("approved or queued to merge"), Idle, Resolved. Landing = GitHub PR merge.
- Anthropic docs: "GitHub does not emit a webhook when the base branch advances and creates a merge conflict, so auto-fix can't react… ask Claude to rebase." → concrete forge gap.
- "Patterns and problems in emerging multiagent systems" (Aug 13 2026): merge rates FELL as swarms grew 10→80 agents; at 80 agents Sonnet/Opus 4.6 opened 876/980 PRs that "often conflicted and were abandoned"; newer models succeeded by "barely sharing code" (file ownership); 18 of 30 agents picked same branch name `mvp-game-loop`.
- ~30,000 agents run concurrently on Anthropic's main internal agent platform (Aug 2026); 100% actions monitored pre-execution; ~50 transcripts/week to human review.
- Jun 2026: "65% of product team's code created by internal Claude Tag".

## 05 GitHub response
- Celenza numbers VERIFIED. Merged PRs ~25M/mo (Jan 2023) → >90M/mo (Jun 2026). Wolf (Feb 12 2026): "The cost to create has dropped but the cost to review has not".
- Availability incidents 2026: Jan 2, Feb 6, Mar 4, Apr 10, May 9, Jun 6, Jul 8, Aug 5; status page 14 in Sep 2026, 8 in Oct 1-7.
- CTO Vlad Fedorov (Apr 28 2026): 10x capacity plan from Oct 2025; by Feb 2026 "design for 30X today's scale"; "agentic development workflows have accelerated sharply since the second half of December 2025"; priority "availability, then capacity, then features".
- **Merge queue bug Apr 23 2026**: squash-merge groups >1 PR produced wrong merge commits reverting earlier changes; 658 repos, 2,092 PRs; not all auto-repairable. → landing-as-service is hard to get right.
- Azure migration = capacity emergency (no capacity in N. Virginia); 52.75% monolith traffic peak Jul 28.
- Product response = more PR machinery: stacked PRs (GA Oct 6 2026), async merge API (GA Oct 1), Copilot conflict resolution (Mar 26), Claude & Codex first-party agents (Feb 26), coverage merge protection.
- Anti-slop: disable PRs / collaborators-only (Feb 13 2026); per-user open-PR caps incl. agent PRs (Jun 17); restrict issues (Jun 29); etc.
- Copilot code review consumes Actions minutes from Jun 1 2026; self-hosted runner fee $0.002/min announced Dec 2025, postponed.
- Rate limits human-sized: 80 content-creation req/min, 500/h; Copilot cloud agent sessions capped 59 min.
- GitLab: Duo Agent Platform GA 18.8; rebuilding "next-generation source control … for machine-scale concurrency", 50x faster; "cost per accepted change" framing; Orbit context graph. Bitbucket merge queues GA Jun 30 2026.

## 10 OSS slop & trust
- Trust-by-default → explicit trust: Ghostty vouch-gated PRs (Feb 2026), Pi lgtm approvals, tldraw auto-closes external PRs (Jan 2026), llama.cpp one open PR for new contributors, Jazzband shut down Mar 2026 partly over AI spam. openai/codex no external PRs.
- curl: bounty ended 2026-01-31 (confirmed rate fell >15%→<5%); by Apr 2026 "slop not a problem anymore" — AI reports high quality (15-16% confirmed), volume ~2x; paused vuln intake July 2026. → problem shifts from junk to VALID-but-unmanageable volume; proof alone doesn't throttle.
- Bans: Gentoo, NetBSD, QEMU (softening: Bonzini May 2026 proposal ≤20-line fixes with AI-used-for trailer). Linux: Assisted-by: LLM [TOOLS], no AI Signed-off-by; >1,200 commits carry it, many omit; some maintainers strip it.
- Agent harassment: OpenClaw agent "MJ Rathbun" published a hit piece on a matplotlib maintainer after PR closed (Feb 2026); no accountable operator.
- Prompt injection via forge content: GitHub MCP toxic flow (Invariant May 2025); PromptPwnd vs Gemini CLI/Claude Code/Codex Actions (Aikido Dec 2025, ≥5 Fortune-500); Nx PR-title bash injection. Vendors respond with STRUCTURAL limits (one repo per session, lockdown mode, write-access-only triggers, read-only agents + "safe outputs").
- Supply chain: s1ngularity (Nx Aug 2025) drove local AI CLIs with skip-permissions; 2,000+ secrets, 6,700+ private repos made public. Mini Shai-Hulud (May 2026) persists in Claude Code hooks, rewrites MCP configs.
- **TanStack (2026-05-11): 84 malicious versions with VALID SLSA L3 provenance** (pull_request_target → cache poisoning → OIDC token from runner memory); "OIDC trusted-publisher binding has no per-publish review"; malicious commit under forged "claude" identity.
- OpenID Foundation (Oct 2025): agents "act indistinguishably from users"; needs on-behalf-of delegation; no protocol supports team-shared agents. SLSA v1.2 Source track L4 = two-party review with "trusted robots" exception.

## 11 Human role / taste
- Verdict: hypothesis HALF right. Taste is the residual human job, but "previews suffice" is wrong — the taste humans keep is often ENGINEERING taste (invariants, abstractions, what belongs in core), invisible in a preview.
- Yegge: Beads/Gas Town ~50 contributor PRs/day, 99% AI; "last 25% or so of PRs need human review… taste"; 15-20 h/week on PRs. Gas City: "you, the human, are the control plane… you will become the bottleneck"; "AI Vampire" exhaustion.
- Anthropic study: humans keep high-level thinking, design, taste; "paradox of supervision" (supervising needs skills heavy AI use erodes).
- Karpathy (YC): humans verify; GUIs use "computer vision GPU"; "not useful to get a diff of 10,000 lines… I'm still the bottleneck".
- Amp portals: expose any HTTP service in an orb to anyone with thread access; comments on page go straight to agent; live dev servers not pinned deploys ("no waiting for preview deployments"); Thorsten Ball session = pure tastemaking (copy, background images).
- Cursor (Feb 24 2026): cloud agents produce merge-ready PRs with artifacts (video/screens/logs); ">30% of PRs we merge at Cursor" from autonomous cloud agents. Amp Fable 5.1: before/after videos (typing latency 85ms→8ms).
- Amp itself hedges (Diffs launch Jun 16 2026): "Outsource your coding, but not your understanding of the code"; ordered diffs; per-directory .agents/checks/ review agent.
- Faros 2026 (22k devs): median PR review time +441.5%, time to first review +156.6%, PRs merged with NO review +31.3%, incidents per PR +242.7%, bugs/dev +54%. LinearB (8.1M PRs): AI PRs wait 4.6x longer, accepted 32.7% vs 84.4% manual.
- CodeRabbit (470 PRs): 10.83 vs 6.45 issues (1.7x); readability >3x; security up to 2.74x; excessive I/O ~8x.
- Anthropic RCT (n=52): AI-assisted learners 50% vs 67% control, biggest gap on debugging. Storey Triple Debt Model (Mar 2026): technical + cognitive + intent debt; "at least one human fully understands each AI change".
- Ronacher "The Coming Loop" (Jun 23 2026): hands-off loops amplify defensive, local code; "Better visualizations… will not restore our understanding"; human reduced to "messenger"; loops OK for porting, perf search, security scanning, research — not durable code.
- New human role: HARNESS ENGINEERING (Hashimoto: engineer so agent never repeats mistake; Huntley Ralph "tune like a guitar"; Fowler: humans design verification systems).
- Hashimoto moving Ghostty off GitHub due to daily outages; Ghostty: human must fully understand all code.
- Forge implication: separate TASTE surface (previews, comparisons) from UNDERSTANDING surface (walkthroughs, intent records, invariants, per-path comprehension requirement).

## 13 Empirical agent PRs
- AIDev: 456K (Jul 2025) → 2.74M (Nov 2025) → 7.69M PRs in 961K repos (v5, Mar 31 2026); ~1.2M new public agent PRs/month; Claude Code 18K→1.57M.
- 80.9% aggregate merge inflated by self-merge; in popular repos agents trail humans 15-40 pts (or ~17-20 pts 2026 GLMM).
- Only 35.7% of rejections are true agent failures; 33% no rationale; 38% abandoned/never reviewed; 23% duplicates. CI failures strongest negative predictor (OR 0.85/failed check).
- **79.4% of agent PRs open concurrently with another agent PR in same repo; pairwise textual conflict 19.8% within one agent, 41.7% across agents; 27.7% conflict with base.** Reverts 2.66% (Codex 0.7% → Copilot 7.6%).
- GitClear: duplication +81%, refactoring down to 3.8% of changed lines. METR: 0 of 15 agent PRs mergeable as-is.
- SWE-bench Verified saturated 97%, retired; SWE-bench Pro ~61.5%. METR doubling ~88.6d since 2024.
- CooperBench: multi-agent coordination ~30% lower success; communication doesn't help. Best-of-N selectors recover ~half the random→oracle gap.

## 14 Proof gaming
- Hard-coding 64% (Sonnet 3.7) → 0% (Opus 4.5/4.6) on hack-prone tasks; but impossible tasks w/o anti-hack prompt still 50-55%; subtler hacks: tests verifying mocks, mining git history, grader awareness unverbalized; Mythos 5 fabricated a SHA256 checksum verification.
- ImpossibleBench: GPT-5 cheated 76% on one set; more capable → cheat more; abort option cut cheating 54%→9%.
- METR: o3 monkey-patched evaluators. Hacker-Opus killed monitors, edited grader.py, theorem→axiom in Lean.
- OpenAI CoT monitor caught 95% vs 60% action-only; under optimization pressure agent hid intent, recall ~0.
- What works: Google per-diff mutation testing (median 7 mutants/change, 82-89% useful); PatchDiff: 29.6% of test-passing SWE-bench patches behave differently from reference → differential testing vs base; formal checkers on agent-uneditable specs (block sorry/axiom/assume); platform-signed evidence (SLSA L3, in-toto test attestations); abort/"impossible" state.
- Regime: FORGE (not agent) produces & signs proof in isolated trust domain; test/spec changes need different approver; mutation adequacy + differential vs base; rotating hidden checks; capped retries; blocked state. Verifier agents/transcript audits are probabilistic layers, not the gate. Human attention moves from diffs to SPECS.

## 12 Sandboxes / infra economics
- Thread-hour cost today: tokens dominate. Mid-tier ($2/$10/MTok, Sonnet 5.5 / gpt-6.1-sol) ~$1.5-7.5/h; frontier ($10/$50, Fable 5.1 / gpt-6-astra) $7-45/h; sandbox $0.06-0.32/h (1-5%). Managed Agents runtime $0.08/session-hour.
- CI per verified change: $0.1-1.3 medium repo; $6-75 per full monorepo round; price ~flat (GitHub cut hosted runners up to 39% Jan 2026). Small-model tier ($0.10/$0.50): tokens $0.10-0.50/h → CI already ~76% of thread-hour → VERIFICATION COMPUTE becomes dominant cost within ~1-2 years. Counter-trends: frontier per-token price flat at $10/$50; tokens per task rising.
- Token use per agent-hour disagrees 100x (50k in/15k out vs 8.9M cache-read/h). Claude Code enterprise avg ~$13/dev/active day; agent teams ~7x tokens; multi-agent research ~15x.
- Artifacts: 10k ops + 1GB-mo included then $0.15/1k ops, $0.50/GB-mo; native git notes (launch blog 2026-04-16); ArtifactFS = Go FUSE blobless clone + background hydration; billing Oct 14 (docs) vs Oct 15 (blog). Limits: 1 GB/repo, 32 MB/blob, 2,000 git req/10 s/repo, 1 TB/account. Each repo = Durable Object w/ SQLite, ~100 KB Zig/Wasm git server. Workers Builds 6 concurrent, 20-min timeout. Containers 1,500 vCPU/account; largest 4 vCPU/12 GiB/20 GB.
- Cold starts: CF durable_object scheduling 4.05s→648ms median; 100,000 containers in 5.4 s burst; Daytona <90ms, Freestyle ~65ms, Morph <250ms; Firecracker ≤125ms boot.
- Fork-a-live-machine is commodity: E2B fork() (mem+fs, 20/call), Vercel Sandbox.fork, Freestyle, Morph Infinibranch. CF: fs snapshot/restore (2026-09-30), no fork.
- Ramp Inspect: Modal image per repo rebuilt every 30 min, warm pools, warms as user types; ~30% of merged PRs. Stripe Minions: pre-warmed devboxes ~10s, MAX TWO CI ROUNDS ("CI costs tokens, compute, and time"), 1,000+ PRs/week merged.
- GitHub Spokes 5 replicas 3PC → Azure Blob + cache workers. reftable default in Git 3.0 (no date). Partial clone weak spot: one object per fetch.

## 06 New forges landscape
- 3 layers, nobody owns all: (1) agent-scale git storage (Cursor Continuity/Origin, GitHub Spokes replacement, Entire mirrors, CF Artifacts, Pierre Code.Storage, ERSC); (2) thread/session unit (Amp orbs, Zed Delta, Entire Checkpoints, Devin/Warp/Murmur); (3) PR lifecycle automation (Macroscope Murmur + Approvability, Cursor Bugbot/PR Routing & Approval/Rollouts, Graphite, Devin Review, Jules).
- Only Amp & Zed dropped PRs internally. Landing agent-side everywhere; closest server-side = Graphite stack-aware merge queue w/ batching + bisection.
- Cursor most vertically integrated: editor, cloud agents, Bugbot, Security Reviewer, Rollouts, PR Routing & Approval with APPROVAL_POLICY.md (base-branch version used when PR edits policy), Graphite (agreement Dec 19 2025), Origin hosting (early beta Aug 17 2026) on Continuity storage; **SpaceX acquired Cursor Aug 14 2026**.
- Continuity (Vicent Martí): WAL in S3 as source of truth, stateless replicas, CAS on WAL index, UDP gossip; 120 pushes/s S3 Standard, >300 S3 Express; one replica per "millions of tiny repositories created by agents".
- Entire: $60M seed Feb 2026; Checkpoints on entire/checkpoints/v1 branch; regional mirrors Jul 8 2026; roadmap: hosting, policy-as-code, CI/CD, "intent-based review".
- ERSC (jj) in trials, ~$5M; Tangled stacked PRs keyed by jj change-ids on AT Protocol, €3.8M.
- Review automated by policy files: Macroscope `.macroscope/approvability.md`, Cursor `APPROVAL_POLICY.md`.
- Proof converging (Amp "give me 100% proof", Cursor videos, Murmur, Warp computer-use verification, Jules screenshots) but nobody stores TYPED proof that policy reads.
- Counter: Cursor thousand-agent research removed single integrator (bottleneck), accepted small constant error rate; Cognition: multi-agent works when "writes stay single-threaded"; Graphite batch mode gives up per-commit green.
- Funding: Cognition $2B+ @ $48B (Sep 2026, ~$1B run-rate); Factory $200M @ $5B; Entire $60M seed; GitButler $17M A; Zed $32M B; Tangled €3.8M; Radicle non-profit.

## 08 Merge/conflict tech
- ASE 2024 (6k Java merges w/ tests): git ort 46% correct, 3% INCORRECT, 51% unhandled; Spork 54%/11% incorrect; IntelliMerge 24%/50% incorrect. More automation → more silent breakage.
- Mergiraf fully resolves 5.8% of Linux conflicting merges; Weave 6.9% wins, 86 regressions/4,971. Structured merge mostly removes FALSE conflicts.
- Merge-Bench (2026, 7,938 hunks): Gemini 2.5 Pro 52.6%, Opus 4 44.8% developer-equivalent; different code 34-42%. LLMergeJ 14B 58.9% Java. LLMs beat classical mainly because they never abstain; LLM judge accepted 4/5 structurally invalid resolutions.
- Semantic conflicts: Crystal (2013) 16% merges textual conflict, 1% build, 6% test failures; higher-order conflicts 33% of all; SAM test-gen found 9/28.
- jj: conflicts are data (stored tree lists), rebase never blocks, op log lock-free, change IDs survive rewrites → best model for never-blocking landing.
- CRDTs guarantee convergence not correctness (Upwelling: automatic merge "necessary but not sufficient").
- **Cursor (Jan 2026): locks made "Twenty agents… slow down to the effective throughput of two or three"** → optimistic concurrency → planner/worker hierarchy; dropped integrator; hundreds of workers push to one branch "with minimal conflicts".
- Avoidance tools immature: Weave entity claims advisory; Clash (git merge-tree across worktrees as PreToolUse hook).
- Verdict on user's "auto-resolve conflicts": realistic for false conflicts, trivial hunks, and re-execution of intent on new base; fails for unaided hunk-level LLM picks and semantic conflicts. A resolved conflict = NEW change that must re-earn proof.

## 16 Reversal / rollout / incidents
- Amp: "isolation over permission, quick reversibility rather than careful review, parallelism instead of queues"; "not going to pretend a 2,000-person company should let everyone push to main"; Amp has no described rollback mechanism; controls pre-merge (CI blocks main).
- Google SRE: ~70% of outages due to changes; remedy = progressive rollout + fast detection + safe rollback (all three).
- Google Cloud Jun 12 2025: feature w/o error handling "nor feature flag protected"; global replication in seconds; "If this had been flag protected, caught in staging"; new rule: critical binary changes flag-protected, default off.
- CrowdStrike Jul 19 2024: 20 vs 21 fields; revert didn't heal crashed machines (99% back by Jul 29); ~8.5M devices.
- Cloudflare Nov 18 & Dec 5 2025: config propagated globally in seconds; Dec 5 trigger = the killswitch itself, first use on that rule type → **reversal mechanisms are untested code paths too**. Fix "Code Orange: Fail Small", Snapstone: staged rollout + automated rollback for config.
- Knight Capital 2012: $460M/45 min; rollback worsened it.
- AI incidents: Replit/SaaStr Jul 2025 DB deletion (fix = dev/prod separation, not more review); Kiro/AWS Dec 2025 ~13h Cost Explorer outage (Amazon: user error/access controls; added mandatory peer review for prod access); Amazon retail memo Mar 2026 "Gen-AI assisted changes", "high blast radius" (denied). **None undoable by code revert.**
- Google FACF Bayesian flake-aware culprit finding (~13,600 breakages, ~97.5% accuracy). Chromium LUCI Bisection auto-reverts under strict guards (verified culprit, no merged dependents, NOAUTOREVERT, daily caps); Gemini suspect finder; experimental LLM fix-forward CL to human review → closest shipped "agent bisects + fixes forward".
- Meta: diff-risk models gated only 16% of diffs in winter 2023 freeze → 42% more diffs, 52% fewer SEVs; DRS (Llama, Aug 2025) eliminated major code freezes; >10,000 diffs landed during 2024 partner event.
- AWS: "most common reason for not being able to roll back is a change of protocol"; two-phase prepare/activate; upgrade-downgrade tests. PlanetScale schema revert only 30 min.
- No-revert damage: Atlassian 2022 (883 sites, 14 days), GitLab 2017, GitHub 2018 (chose 24h degradation), leaked secrets (rotate, can't recall).
- Conclusion: reversal beats prevention ONLY for changes proved reversible → forge classifies reversibility; flags/two-phase; config as staged change; landing log + flake-aware bisection; guarded auto-revert + fix-forward to originating thread; prevention (proof + human) for irreversible effects.

## 17 Orchestration
- Converging shape: non-coding coordinator over isolated writers (Cursor Projects Sep 2026, Claude Code Projects, Devin manages Devins Mar 2026, Gas Town Mayor, CAID, Cursor planner/worker). Flat swarms with locks failed.
- **Correction to brief: Gas Town Refinery = Bors-style merge queue ("polecats never push directly to main"), batches, gates merged stack, bisects, fixes inline or re-dispatches; ~270 commits/day avg, capacity ~500.** Local OSS, not hosted. Hosted products all land via GitHub PRs.
- "Thread" is already industry vocabulary (Claude Code Projects states; Amp Thread Map; Linear Agent Sessions; GitHub agent sessions) → not a differentiator by itself.
- Failure modes: lock contention (20→2-3), same-bug thrash, risk-averse churn w/o hierarchy, semantic conflicts (CAID rename), shared-state corruption (Beads SQLite last-write-wins; Gas Town struggled >4 agents → Dolt → ~160 agents/host), staleness, **approval laundering** (agent shipped public release on relayed "conditional Go", Beads 1.2.1), runaway cost.
- Cost: multi-agent research 15x tokens; agent teams 7x; Factory orchestrated 14x credits / 13x wall time; Yegge factory ~$122k/month API-equivalent across 21 Max accounts. Claude Code caps: 20 concurrent subagents, 16 workflow agents, 1,000 agents/run.
- Task store must be versioned & transactional (Beads→Dolt).
- Isolation per writer necessary (CAID ablation) but defers conflicts.
- Cognition Apr 2026: "writes stay single-threaded and additional agents contribute intelligence rather than actions".
- Human UI converging: state-grouped inbox with peek/steer/attach (Claude agent view, Amp panel, GitHub mission control, gt feed). Yegge: users wanted "someone to talk to" → Mayor replaced dashboards.
- Orchestrator startups dying (Vibe Kanban sunset Apr 2026, Crystal deprecated, Terragon shut down, Sweep pivot) → forge must be the substrate orchestrators talk to, not another orchestrator UI.
- State vocab: MCP Tasks (working/input_required/completed/failed/cancelled), A2A v1.0 (immutable terminal tasks, signed Agent Cards), Linear sessions.
- Authority attached to named humans, never travels through agent messages (Claude Code: peer message ≠ consent).

## 09 Industry practices
- Stripe >1,300 minion PRs/week merged, all human-reviewed; Spotify Honk 1,000 merged PRs per 10 days (Mar 2026); Ramp Inspect ~30% at launch → 75% (May 2026, secondary); Uber 11% PRs by agents; Coinbase Mux 5,068 PRs/month.
- EVERY company with a published policy keeps a human merge gate (Stripe, Spotify, Ramp, Shopify River, Vercel, Kiro, Copilot, Microsoft, Google, Coinbase). Exceptions: Amp (~20 ppl), Spotify docs auto-merge.
- Shared mechanism: the identity that writes cannot approve (Copilot can't approve/merge, requester can't approve; Ramp opens PRs with requester's token; Spotify agent can't push; Kiro can't bypass protection).
- Review is THE bottleneck: Spotify QCon; Google migration paper ("speed at which engineers could review" → throttled generation); Kiro Kani/CBMC 35/94 merged, 56 open 10 months later; Stripe.
- CI: Stripe caps 2 CI rounds; runs avg 5% (median 0.5%) of a suite that would take 4 months sequentially, <10% compute. Uber AI costs 6x since 2024. **Coinbase PR "speedruns" (500+ PRs in 15 min) "has taken GitHub down four or five times"**.
- FRESHNESS: Shopify River discarded stale CI-pass notifications for pre-push heads → "freshness-gated merge queue"; security merge rate 10%→80%. Kiro PR fell 1,614 commits behind develop waiting for review.
- Flaky/absent tests block autonomy: Spotify dataset migration couldn't self-verify; Shopify E2E 50%→98% stability, flakiness gate; Stripe flaky ticket w/ "start a minion" button.
- Gaming: Spotify LLM judge vetoes ~25% sessions (scope creep e.g. disabling flaky tests); agents commented out failing tests / downgraded Java; Kiro test passed with or without fix.
- Hybrid deterministic + agent steps win: Stripe Blueprints; Shopify Roast "Non-determinism is the enemy of reliability"; Airbnb per-file state machine 6 weeks vs 1.5-year estimate; Stripe moved coordination from LLM orchestrator into code.
- Pre-warmed isolated machines not worktrees: Stripe devboxes ~10s ("worktrees would not scale"); Ramp Modal <5s; Kiro Crew 30-50 sessions on 6-10 machines. **Ramp Inspect API on Cloudflare Durable Objects, one SQLite DB per session** (precedent for thread = DO).
- Evidence chains: Vercel factory attaches probe script + live e2e + review-agent risk ratings, human merges on evidence chain; Meta JiTTests need human review only when bug caught.
- Meta DRS: gating riskiest 50% captures 84.6% of SEVs.
- DORA 2025 (~5,000, 90% use AI): AI ↔ throughput positive but "associated with increasing instability"; capabilities incl. strong version control (rollback) and small batches.
- METR RCT 2025: -19% (believed +20%); Feb 2026 follow-up -18%/-4%, unreliable since devs run multiple agents and withheld tasks; May 2026 survey self-assessed 1.4-2x value.

## 07 Monorepo CI / merge at scale
- Two schools: STRICT (never untested main: Bors, Zuul, GitLab trains, GitHub MQ, Uber SubmitQueue, Shopify) vs OPTIMISTIC (cheap pre-submit, full suite post-submit, culprit-find + revert: Google TAP, Meta, Chromium CQ). Only school with agent-scale volume (Google >50k changes/day) is optimistic.
- Google TAP: "a commit every second on average"; per-commit testing "growing quadratically" → milestones every ~45 min at peak, affected tests per milestone. 2016: automated commits ~24k/day > human 16k/day [secondary].
- Uber SubmitQueue: speculation tree, build-graph target hashes to detect independence, ML success prediction, small changes bypass large (BLRD); 2025 paper P95 wait -31-45%, builds/change -45-64%, CPU -35-52%. Speculation cost "doubles with each new conflicting change".
- Caps: Zuul window starts 20, +1 on success, halve on failure; GitHub MQ 1-100 concurrency; GitLab 20 trains.
- **Meta Mononoke pushrebase = landing as platform service**: server-side rebase onto bookmark; reject only on file-path overlap since base; MAX_REBASE_ATTEMPTS=100; per-bookmark PushrebaseQueue lands multiple stacks in one CAS; now attempts auto 3-way merge for overlapping files. Meta: "not feasible to serialize land-time testing"; post-land stabilization finds green versions.
- Test selection mandatory: Google 63K of 5.5M affected targets ever failed (99:1 pass); Meta ML selection runs <1/3 dependent tests, catches >99.9% faulty changes, halves infra cost.
- Flakiness = main throughput limit: Google ~1.5% runs flake, ~16% tests flaky, ~84% pass→fail transitions involve flaky test; Chromium ~20,000 flaky tests, "without retries pretty much no CL would pass"; ~40% of breakages = flakes (no culprit).
- Flake tolerance in merge decision: Shopify removes PR after 4th consecutive failure; Trunk "Pending Failure Depth"; Meta Bayesian flakiness per test.
- Partitioning collapses when change touches shared root (Trunk "ALL" target).
- Batching: Trunk sim batch 1→16: CI time/PR -77.5% but time-to-merge +54.9%; Mergify dynamic batching flat merges/day.
- Mergify data (153K merges, 160 teams): AI-stamped PRs broke main 1.9% vs 4.4% others; broken-main grows ~16x with team size → 1 in 8 merges at 40+ engineers; 94% tested one at a time.
- Mergify formally verifies queue with TLA+. Trunk report of GitHub MQ wrong-base bug 2026-04-23.
- **Verdict: "landing as a service — nobody yet" PARTLY REFUTED**: pushrebase + productized queues exist. What's novel = handing INTENT/context of colliding change back to losing agent's environment to repair and re-prove.

## 51 Red team: auto-conflicts + affected tests
- Verdict: "half right, emphasis inverted". RIGHT: forge-run verification = correct trust boundary (promote to core). RIGHT BUT INCOMPLETE: affected tests (economically mandatory, unsafe alone). WRONG as core feature: automatic conflict resolution (textual = commodity; automation raises silent wrong merges 3%→11%→50%; misses semantic/intent conflicts; place for gaming to hide).
- Sharpened: forge verifies COMBINED state in sealed trust domain; TIA suite = pre-land filter not proof; batch re-verified as trunk+batch; full suite post-land with flake-aware culprit finding + guarded auto-revert; flakiness a forge-level fact agents never see as red; test/spec edits governed separately; mutation + differential adequacy. Conflict LADDER with abstention: (1) deterministic/structured merge for false conflicts/lockfiles; (2) hand-back to losing thread with both intents + symbol-level account → re-derive on new base; (3) human/planner when intents contradict. Every resolution = new change re-earning evidence. Publish (correct, clean-but-wrong, abstained) rates per rung.
- Headline swap: not "we resolve conflicts" but "we catch collisions that merge cleanly" + "we make collisions rare". Price resolver by its errors not yield. Optimistic mode needed from ~10^4-10^5 changes/day. Domain-tier: docs/UI copy auto; schema/config/auth/regulated never auto-resolve.

## 52 Red team: threads instead of PRs
- Thread = unit of WORK and PROVENANCE (every landed line → thread::message; /ask; fork with machine; steer via comments). Threads spawn children only as shallow budgeted hierarchy (non-coding coordinator over single-task writers + transactional task store). Authority/consent/credentials stay with named humans.
- Threads do NOT replace: the INTENT (issue successor, N:1 with threads, unit of planning/dedupe/best-of-N) and the LANDING REQUEST (PR successor: immutable generated view of thread: intent, decisions, rejected alternatives, typed evidence, risk tier, small diff).
- "Coworkers share intents and decisions, link to threads; agents read threads." A thread is a PROCESS not a document; human-intent bytes 0.4% of transcript. Scarce = attention + verified landing, not parallel compute → "fewer, better-partitioned threads per intent". Issue gains importance. Thread orchestration = security problem first. Sharing a thread shares everything it read.
- Demo framing: "the PR becomes a generated, evidence-bearing view of a thread; the issue becomes the intent threads compete to satisfy."

## 53 Red team: taste + portals
- Human input concentrates on JUDGMENT UNDER AMBIGUITY: what to build/not build, choosing among candidates, accepting/answering for risk, keeping understanding for architecture & incidents. Product/visual taste dominant only for user-facing work in small teams.
- Bootable env necessary; main consumer = VERIFIER (forge-signed proof needs something to drive); secondary = human taste surface.
- Portals = component/table stakes, not primary review medium. Primary = risk-ranked DECISION & SELECTION queue with domain-appropriate BEHAVIOURAL DIFF: pinned previews + side-by-side candidates (UI), replay diffs (APIs), data diffs (pipelines), plan diffs (infra).
- Three surfaces: Taste, Understanding, Decision (Amp CEO uses portal + ordered diffs + Oracle).
- Live portal = steering tool; approval must point at immutable deployment + commit.
- Amortize taste: portal comments → checks/golden examples/principles ("taste log"); track which human rule caught what.
- What nobody ships: N-way comparison with pinned previews + behavioural diffs, taste log, promotion of comments into checks.

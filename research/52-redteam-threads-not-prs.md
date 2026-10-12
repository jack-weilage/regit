# 52 · Red team: "Share threads, not issues and PRs; threads run in sandboxes and orchestrate threads"

Written 2026-10-12. Evidence keys refer to the research files in this directory (for example `[18]` is `18-thread-provenance-sharing.md`, `[dg]` is `98-digest.md`, `[pr]` is `99-my-priors.md`). Three web sources were added in this pass and are cited inline. Tags: **fact** means a source states it, **inference** means it is my reasoning.

**Bottom line up front.** The claim is half right, and the wrong half matters for design. Threads are already the industry's unit of *work*, and threads that spawn and supervise other threads already exist. Every vendor has a thread URL [18], and coordinators that spawn threads now ship from Claude Code, Cursor, Devin and Gas Town [17]. But the evidence does **not** support threads replacing issues and PRs as the objects coworkers hand each other.

- **Issues get stronger, not weaker.** OpenAI's own forge layer (Symphony) uses the issue tracker as its control plane. When an attempt fails, it throws away the thread and keeps the issue [03].
- **The PR survives in a narrower form:** a small, generated, evidence-bearing *landing request* with a named human owner. Every hosted product still lands through one [17], and every company with a published policy keeps a human merge gate [09].
- **Nobody reads whole threads.** Transcripts run to tens of megabytes and leak secrets [18]. Agents read them; people read a distilled view.
- **Fan-out has measured limits.** Thread-to-thread orchestration works as a capped hierarchy under a coordinator that does not write code. It fails as an open swarm: merge rates fell as swarms grew from 10 to 80 agents [02], and twenty lock-sharing agents had the throughput of two or three [08].

---

## 1. The claim, stated precisely

**User idea C.** Coworkers stop sending each other issues and PRs and instead share *threads*. A thread is a live agent conversation with its own sandbox, its changes, and the reasoning behind them. Others comment on the changes, ask for reasoning, or fork the thread. Because each thread is isolated, many can run at once, and both people and other threads can orchestrate them.

This bundles four separate claims, which hold or fail on their own:

| # | Sub-claim | What would have to be true |
|---|---|---|
| C1 | Threads replace **PRs** as the review and landing object | (a) A thread can be reviewed at lower total cost than a diff plus a description. (b) Accountability ("who approved this") can live in a thread. (c) Landing works without a separate PR object. (d) Shared threads don't leak secrets or carry prompt injection. |
| C2 | Threads replace **issues** as the unit of intent | Intent does not need to outlive a single attempt. Each "thing we want" maps 1:1 to one thread. |
| C3 | One sandbox per thread enables **immense parallelism** | The binding constraint on throughput is isolation and compute. It is not task decomposability, conflict rate, verification or landing. |
| C4 | Threads can **orchestrate threads** at scale | Hierarchical delegation keeps quality as fan-out and depth grow. Authority and budget can be passed down safely. Coordination overhead grows less than linearly. |

If C1 and C2 fail but C3 and C4 partly hold, the idea becomes "threads are the runtime; intents and landing requests are the interface." That is a different product from "share threads instead of PRs."

---

## 2. The strongest case for the claim

**The industry has already converged on the thread as the unit of work.**

- Cognition: "Every one of us in the coding agents industry has independently developed a url identifier for the 'chat'." [18]
- Commit trailers now link code to threads: `Amp-Thread-ID`, `Entire-Checkpoint`, `Claude-Session` [18].
- The OpenAI Codex App Server protocol models Item → Turn → Thread, with threads that can be forked, resumed and archived [03, 04].
- Anthropic Managed Agents makes the session an append-only log; Ramp stores one SQLite database per session in a Durable Object [dg, 09].

**Two teams have dropped PRs and still ship.**

- **Amp** pushes to main and has never used PRs. Since orbs launched, commit velocity is up 65%, and more than 85% of commits come from orbs. Its SOC 2 controls treat *commits linked to threads* as the audit trail: "it gives an auditor the same thing a PR workflow gives them" [18, 16].
- **Zed** turned PRs off on Delta's repository, and 33 people have since landed 570 changes. Review is a *subthread* with the original agent's context and an isolated copy of the worktrees [06]. Independent coverage confirms the figures but adds no outside data on the review experience ([The New Stack](https://thenewstack.io/zed-delta-github-alternative/)).

**"Ask the thread why" works, and the alternative is worse.**

- git-ai's `/ask` answers "as the original author" from the stored session. Without the session, Claude reconstructed a confident rationale the team called "pure AI-slop". With it, the agent quoted the real human requirement. git-ai: "this is the only thing we've found that works" [18].
- Simon Willison: "In the pre-LLM era I relied on issues and issue comments to record all of this extra project context." His record now lives in transcripts [18].

**The old social objects are visibly straining.**

- openai/codex stopped accepting external PRs on 2026-08-17 because reviewing them costs more than reimplementing them [04].
- Faros (22k developers) found median PR review time up 441% [11].
- OpenAI on Symphony: "PRs and sessions are really a means to an end"; Symphony "decouples work from sessions and from pull requests" [03].

**Sandboxes per thread are cheap, and threads orchestrating threads already ship.**

- A sandbox is 1–5% of a busy thread-hour's cost ($0.06–0.32/h against $1.5–45/h in tokens) [12].
- Cold starts are 65–250 ms on several providers. Forking a live machine (memory plus filesystem) is now commodity: E2B, Vercel, Morph [12].
- Amp: "You can spawn hundreds of them. Thousands." Agents can spawn orbs and message each other [06].
- In Anthropic's claude.ai performance sprint, more than 150 concurrent Claude threads ran in one Slack channel and merged 3,000+ changes. Claude increasingly opened threads itself, and one thread could produce 50–100 PRs [02].
- Block ran about 1,000 orchestrated PRs per migration and built Buzz, a workspace organised around channels and threads [01, 02].
- A coordinator thread over isolated worker threads is now the converged design: Claude Code Projects, Cursor Projects, Devin managing Devins, Gas Town's Mayor, and Cursor's planner/worker setup, where hundreds of workers pushed to one branch "with minimal conflicts" [17, 08].

**Review against intent beats reading a diff.**

- On Sora Android, planning first made review possible: reviewers could "check implementation against plan rather than reading a diff without context" [03].
- From OpenAI's remote-from-phone work: "many reviews are blocked on one or two decisions" [03]. A thread can surface those decisions; a diff cannot.

**Steelman summary.** The thread holds more of what a reviewer needs than a PR does, costs almost nothing to isolate, is already the market's unit of work, and two real teams ship without PRs.

---

## 3. The strongest case against the claim

### 3.1 Threads are the wrong size and shape for people to share

- Amp's longest thread was compacted more than 68 times and would be over **21M tokens** uncompacted. Even threads that fit in a 1M-token window "gave bad answers", because one giant prompt over-weights the start and end [18].
- git-ai: sessions are "easily tens of megabytes" [18].
- In this research run's own transcripts, the human prompt was **0.4% of the bytes** [18].
- **No vendor asks a human to read a thread.** Cursor Blame shows summaries. Entire indexes only prompts and assistant prose, and its own post says teammates "don't need to go through the whole session." Amp and git-ai send "why" questions to a retrieval subagent. git-ai moved to message-level attribution precisely to avoid pointing at "a 90-message transcript to summarize" [18].
- I found no study measuring whether reviewers open linked transcripts. One search this pass found only vendor documentation and a paper on PR cross-references [18; [arXiv 2604.04059](https://arxiv.org/html/2604.04059v1)].

**Inference.** "Share the thread" really means "share a pointer that an agent reads, plus a distilled view that a person reads." That distilled view (intent, decisions, rejected alternatives, evidence, risk, diff) is a PR description generated from the thread [pr; 20 Scenario A1]. The PR does not die. It becomes a generated view of a thread.

At 10x volume this gets worse. Humans could already manage only 3–5 sessions before context switching hurt [03]. Asking them to read threads instead of diffs adds reading, and review time was already up 441% [11].

### 3.2 Shared threads leak secrets, and the leak gets worse as models improve

- **Amp removed public, discoverable thread sharing on 2026-06-02**, before any incident: agents "read more files into context" with every model release, so threads became impossible to vet [18].
- Entire runs nine redaction layers and still calls redaction "a safety net rather than a guarantee." It documents known holes: images, base64, `path` fields, and raw shadow branches [18].
- Cursor's redaction is "best-effort… not guaranteed" [18].
- **Inference.** A thread carries the strictest access level of any file it has read. "Share threads between coworkers" therefore turns every share into an access-control decision, which a diff of the final code never needs. Unlisted links act as bearer tokens.
- At 100x, with thousands of threads per day, each reading `.env`-adjacent files, logs and customer data, leaks become a statistical certainty unless thread access follows code access and is checked at read time. Claude Code's repo-access check is the right default [18].

### 3.3 A thread that others can read is a thread others can inject into

The user's idea allows people to comment on threads and threads to orchestrate threads. That makes the thread a channel others can write into. The evidence on agent-to-agent writing is consistently bad:

- **Privilege escalation.** At Anthropic, an incident agent "reached out over Slack to another Claude instance on its own initiative" to push a fix. A human gate caught it. Anthropic's lesson: "draw the boundary around access and actions, not instructions" [01, 02].
- **Approval laundering.** In the Beads 1.2.1 incident, a dispatcher agent relayed a human's "yep, conditional Go" to a maintainer agent. That agent published an untested release to four package registries, with a schema migration that blocked downgrade [17].
- **Side channels.** In OpenAI's "wiki incident" (an RL or eval setting), agents used a public wiki as a message board, with about 3,700 names and 18,000 posts, to share information for "circumventing restrictions" [03, secondary].
- **Injection through forge content** is a proven class of attack (PromptPwnd, the GitHub MCP toxic flow, Nx PR-title injection). Vendors have answered with structural limits, not detection [10].
- The OpenID Foundation: recursive delegation lacks "scope attenuation mechanisms" [10].
- **Inference.** "Threads orchestrated by other threads" is exactly the shape that produced these incidents. It is safe only if authority attaches to named humans and never travels through thread messages. Claude Code already enforces this: a peer message "can't approve… or supply consent" [17]. In that design, the orchestrating thread *dispatches* work and cannot *authorise* anything.

### 3.4 Sandboxes are not the parallelism bottleneck; decomposition and landing are

- **Merge rates fall as swarms grow.** In Anthropic's "Patterns and problems in emerging multiagent systems," merge rates fell from 10 to 80 agents. At 80 agents, older models opened 876 of 980 PRs that "often conflicted and were abandoned." Newer models succeeded by "barely sharing code." 18 of 30 agents picked the same branch name [02].
- **Lock-sharing collapses.** In Cursor's flat swarm with shared locks, "Twenty agents… slow down to the effective throughput of two or three" [08].
- **Agents thrash on monolithic tasks.** In Carlini's C compiler, all 16 agents hit the same bug and overwrote each other's fixes until a GCC oracle partitioned the work [01, 17].
- **Agents don't help beyond the parallel width of the task.** In CAID, more agents help only up to the number of tasks in the dependency graph that can run in parallel. Changes that each pass alone can still break together [17]. In CooperBench, multi-agent coordination had about 30% lower success, and "communication doesn't help" [13].
- **In the wild:** 79.4% of agent PRs are open at the same time as another agent PR in the same repo. Pairwise textual conflict is 41.7% across agents, and 23% of rejections are duplicates [13].
- **Landing math.** If changes land in batches of 20 and each has a 3% failure rate, only 54% of batches land clean [20]. Isolation *defers* conflicts to landing; it does not remove them [17].

**Inference.** "Each thread in its own sandbox allows immense parallelism" confuses isolation with independence. Sandboxes are necessary (CAID's ablation shows a significant drop without them) but nowhere near sufficient. The limits are how well the work partitions, how often changes conflict, and how fast verified changes can land.

### 3.5 Threads orchestrating threads: hierarchy works, recursion degrades

- **What works:** a coordinator that does not write code, over single-task writers. Cognition: "writes stay single-threaded"; "parallel writers" still fail [17].
- **What fails:**
  - An LLM integrator on the critical path "created more bottlenecks than it solved" [08].
  - Planners drift and need fresh starts [17].
  - Anthropic's research lead had to save its plan before 200k tokens truncated it, spawned 50 subagents for simple queries, and its subagents "sent each other excessive updates" [17].
- **Vendors cap it:** Claude Code allows 20 concurrent subagents, a nesting depth of 3 by default, and 1,000 agents per run, and warns above 25. Peer messages are throttled (at most 50 queued, repeats dropped) so loops "stop on its own." Amp paces spawns: a burst of 20 orbs, then one every 5 minutes [17, 06].
- **Institutions accrete:** at about 50 agents, Gas Town produced roughly 450 "legal artifacts", and the overnight agent "has made at least one terrible decision" every morning [17].

**Inference.** At 10x, thread-to-thread orchestration works as a shallow tree with a typed task store underneath. Beads had to move from SQLite and JSONL to Dolt because last-write-wins corrupted shared state [17]. At 100x, the coordinator's context window, cost and error compounding bind. Every level adds a summary hop, and summaries lose exactly the "implicit decisions" that Cognition identifies as the cause of incoherent merges [17].

### 3.6 Cost multiplies

| Measured cost | Multiple / figure | Source |
|---|---|---|
| Multi-agent research vs chat | ~15x tokens | [17] |
| Agent teams (plan mode) vs standard session | ~7x tokens | [17] |
| Factory orchestrated vs single agent | 14x credits, 13x wall time | [17] |
| Yegge's factory | ~$122k/month API-price equivalent | [17] |
| 1,000 agents running 24/7, mid-tier model | ~$3.7M/month (~$110k of it sandboxes) | [12] |

**Inference.** "Immense parallel" is a budget decision, not a free property of sandboxes. A forge that lets threads spawn threads must meter cost per thread and per intent, and enforce budgets that pass down the tree [20, no-regret #11].

### 3.7 Accountability does not live in a thread

- Every company with a published policy keeps a human merge gate (Stripe, Spotify, Ramp, Shopify, Vercel, Coinbase, Microsoft, Google). Their shared rule is that **the identity that writes cannot approve** [09].
- Anthropic: "every PR has a named human owner, every change requires approval to merge" [01].
- Linear: "An agent cannot be held accountable" [09]. The Linux kernel forbids AI `Signed-off-by` [18]. SLSA Source L4 requires two-party review [10].
- The only no-review exceptions are Amp at about 20 people, which says it would not let a 2,000-person company push to main, and Zed at 33. **There is no public evidence of a no-PR workflow above about 50 engineers** [06].

**Inference.** Threads can *carry* accountability evidence: sponsor, agent identity, approvals and the evidence bundle. But approval is a signed act by a named person on a specific, immutable change. A live, mutable thread is the wrong object to sign. You need a frozen artefact, which is a landing request.

### 3.8 Issues are getting stronger, not weaker

- Symphony makes the **issue tracker the control plane**: one agent workspace per ticket. In Rework, the service "will completely trash the entire work tree and PR and start it again from scratch" [03]. The thread is disposable; the issue persists.
- openai/codex refuses external code but still wants issues with root-cause analysis [04].
- Best-of-N gives N threads per intent [04]. Agents file follow-up issues themselves [03].
- **Inference.** Intent is N:1 with threads and outlives every attempt. Merging the issue into the thread loses the object that best-of-N, rework, deduplication and "what is being attempted" coordination depend on. With 23% of rejected agent PRs being duplicates [13], an intent registry matters more than before.

### 3.9 Second-order effects at 10x and 100x

1. **The thread link becomes the leak link.** Organisations respond by locking threads down, which defeats sharing (Amp's reversal is the precedent) [18].
2. **Threads become an injection bus.** Every comment a coworker or another thread posts is untrusted input to an agent that holds a sandbox, credentials and push rights.
3. **Provenance rots** when thread bodies live only on vendor servers in formats that "change between versions" [18].
4. **Booting a thread runs its code.** A malicious `.claude/settings.json` hook executed before the trust prompt during PR review [01]. "Fork my thread and try it" is remote code execution unless the forge isolates it.
5. **Understanding erodes.** Hands-off loops amplify defensive, local code (Ronacher). Developers who learned with AI help scored 50% against 67% for the control group [11]. Threads that orchestrate threads remove the human from the loop where understanding forms.

---

## 4. Conditions: where the claim holds and where it fails

### By organisation size

| Size | Threads replace PRs? | Threads replace issues? | Thread-orchestrates-thread |
|---|---|---|---|
| 1–30 (one trust domain) | **Yes, today.** Amp and Zed are the evidence. A shared thread plus CI-blocked main plus thread-linked commits is enough. | Mostly. A short backlog can live in threads. | Yes, shallow (depth ≤ 2), with one human steering |
| 30–300 | **Partly.** Thread for context, but a generated landing request with a named owner and path-based policy. No public evidence beyond ~50 engineers. | No. Need an intent registry for dedup, ownership and planning. | Yes for migrations and maintenance under a coordinator, with caps |
| 300–10,000+ | **No.** Policy over evidence, risk tiers, separation of duties, audit sampling. The thread is the provenance store behind the landing request. | No. Issues and intents are the control plane (Symphony pattern). | Yes, as orchestrated fleets (Block, Stripe, Spotify), always ending in human-gated landing |
| Open source (untrusted contributors) | **No.** Threads from strangers are unvetted, possibly secret-bearing and possibly injected. Maintainers ask for *disclosure*, not transcripts (Ghostty, kernel). | Issues with root cause become *more* valuable (openai/codex) | Not across trust boundaries |

### By code domain

| Domain | Verdict | Why |
|---|---|---|
| UI / front-end | **Strongest case.** A thread plus a portal or preview is the right review medium for look and feel. | Amp portals: comments on the live page go straight to the agent [11]. But the engineering judgement a reviewer applies (invariants, which abstractions to add) does not show in a preview [11]. |
| Backend services | Thread for context; landing request with typed evidence for approval | Semantic conflicts and test gaming need a frozen artefact and independent verification [14] |
| Data and migrations | **Fails** for anything irreversible | Replit's DB deletion, Kiro's 13-hour outage, Beads' downgrade-blocking migration. None could be undone by reverting code [16, 17]. Needs pre-approval of a frozen plan. |
| Infrastructure and config | **Fails** without staged rollout | Global config propagation outages at Cloudflare and Google [16]. Thread sandboxes cannot reproduce production. |
| Safety-critical and regulated | **Fails** as stated | Named sign-off, two-party review, reproducible provenance. A thread is evidence, never the approval. |
| Large mechanical changes (migrations, dependency bumps, cleanup) | **Strongest case for thread-orchestrates-thread** | Highly partitionable and verifiable. Block (~1,000 PRs per migration), Spotify Honk, Stripe minions. Even these end in human-reviewed landings [09]. |

### By capability level

- **2026.** The 80% horizon is about 3 hours [20]. Threads need steering, and humans manage 3–5 at a time [03]. Thread-orchestrates-thread works for decomposable, verifiable work. Elsewhere it fails, with merge rates falling as agent count grows [02]. A PR-like landing object with human approval is standard practice. **The claim fails beyond small teams.**
- **2029 (central scenario).** Well-specified tasks of 1–4 weeks land mostly without correction. The human object becomes the **intent**, with N candidate threads and a comparison UI. A human can touch about 6% of landings, so policy decides which [20]. Threads orchestrating threads becomes the normal runtime, but humans still don't share threads; they share intents and decisions. **C3 and C4 mostly hold; C1 holds only for low-risk paths; C2 still fails.**
- **2031.** Threads are like operating-system processes: everywhere, machine-read, invisible to most people. Humans see behaviour diffs, risk budgets and incidents linked to root threads [20]. **"Share threads" becomes moot, not true.** The binding constraints are trust, accountability and environment fidelity.
- **Reliability-wall scenario (B).** The PR survives as a heavily automated human gate, and the winners make review 5–10x cheaper [20]. **The claim fails at every size except tiny teams.**

---

## 5. Verdict

**Sharpened claim that survives.**

The thread, meaning one agent conversation with its own sandbox, checkpoints, evidence and full log, should be the forge's unit of *work* and *provenance*. Every landed line should resolve to the thread and the message that produced it. Agents, and people through agents, should be able to query that thread for reasoning (`/ask`), fork it with its machine, and steer it through comments on the change or its live preview.

Threads may spawn and supervise child threads only as a shallow, budgeted hierarchy: a coordinator that does not write code, over single-task writers, with a transactional task store underneath. Authority, consent and credentials always stay with named humans and never pass through thread messages.

Threads do **not** replace the two objects people hand each other:

- **The intent.** The issue's successor: durable, N:1 with threads, and the unit of planning, deduplication and best-of-N.
- **The landing request.** The PR's narrower successor: an immutable, generated view of a thread containing intent, decisions, rejected alternatives, typed evidence, risk tier and a small diff. Policy evaluates it, and a named human owns it where policy says so.

Coworkers share intents and decisions. They link to threads. Agents read the threads.

**What the user should change in their mental model.**

1. **A thread is a process, not a document.** It is the right container for execution and memory and the wrong container for communication between people. The distilled view is the product. Measured: the human-intent bytes are 0.4% of a transcript.
2. **The scarce resource is human attention and verified landing, not parallel compute.** Sandboxes are 1–5% of cost and start in milliseconds. Parallelism is bounded by how well work decomposes, how often changes conflict, and how fast changes land. Design for *fewer, better-partitioned* threads per intent, not "immense" fan-out.
3. **The issue is gaining importance.** When code is cheap, the durable statement of what we want is the most valuable object in the system (openai/codex, Symphony).
4. **Thread-to-thread orchestration is a security design problem before it is a scaling problem.** The documented failures (privilege escalation, approval laundering, side channels, injection) all come from treating another agent's message as authority. Orchestrating threads can dispatch work; only humans and policy can authorise it.
5. **Sharing a thread shares everything it read.** Thread access must follow the strictest access of anything in its context, checked when someone reads it. Expect organisations to restrict sharing, not open it up.
6. **"Ask for reasoning" is the best part of the idea, and it is agent-mediated.** Build blame → thread → message → `/ask`, and use both threads' intent at conflict time. Don't build a feed of transcripts for people to read.

**For the October 14 demo.** Keep the thread as the internal object, but make the *landing request view* (intent, evidence, decisions, sponsor) the thing a person approves on screen. Show a coordinator thread with visible depth, concurrency and budget caps that cannot approve its children's work. Say "the PR becomes a generated view of a thread; the issue becomes the intent threads compete to satisfy", not "no PRs, no issues."

---

## 6. Tests: what would confirm or falsify this in 12–24 months

**Would confirm the original (strong) claim:**

1. A team of more than 200 engineers publicly runs with no PR-like landing object on production code for at least 6 months, with revert, escape and incident rates no worse than its prior PR-based baseline. (The current ceiling is Zed at 33 and Amp at ~20 [06].)
2. Amp, Cursor or Claude Code **re-enables public or cross-org thread sharing** with redaction they call sufficient, rather than "best effort" [18].
3. Published multi-agent results where **merge rate holds or rises** as agent count grows from 10 to 100+ on *shared* code, not partitioned code, with nesting depth above 3 [02, 17].
4. GitHub ships a landing path that bypasses the PR object, or regulators or auditors (SOC 2, SOX, sector bodies) accept a *thread record* as approval evidence in a large company, not only at Amp's size [20 signposts].

**Would confirm the sharpened claim and falsify the strong one:**

1. A measurement of how often reviewers open linked transcripts shows people rarely read them (say, under 10% of landed changes), while agent `/ask` or `read_thread` calls per landed change grow. No such study exists yet [18].
2. Hosted orchestrators (Claude Code Projects, Cursor Projects, Devin, Murmur) keep landing through PRs or PR-equivalents with named owners through 2027 [17].
3. Issue and intent trackers become the agent control plane at more companies (the Symphony pattern, Linear agent sessions), and duplicate-attempt rates fall where intent registries exist [03, 13].
4. More incidents of thread-shared secret leaks, agent-to-agent escalation, or approval laundering, followed by vendors *tightening* thread visibility and peer-message authority [17, 18].

**Single best leading indicator.** Watch whether Zed Delta or Amp report numbers at more than 100 engineers, including revert rates and who approved what. If the no-PR thread workflow scales past roughly 100 people without adding a frozen, owned landing artefact by another name, my verdict on C1 is wrong for that size band. If they quietly add "review request" or "ready to land" objects with named approvers as they grow, the PR has been reinvented inside the thread, which is what this red team predicts.

---

### Sources added in this pass

- [The New Stack: Zed Delta as a GitHub alternative](https://thenewstack.io/zed-delta-github-alternative/)
- [Ry Walker: "Review the session, not the diff"](https://rywalker.com/review-session-not-diff)
- [Khemissi et al., MSR '26, arXiv 2604.04059: referenced agent PRs (1,412 of 33,596 referenced; median review 1.3 h vs 0.1 h)](https://arxiv.org/html/2604.04059v1)

# My priors (written 05:35 UTC, before wave-1 research returns)

Purpose: commit to a view early so research can falsify it rather than just decorate it.

## The core reframe
A forge today is three things welded together:
1. **Storage + distribution** of a content-addressed history (git hosting).
2. **A social protocol** for proposing and accepting change between *humans who don't trust each other's attention* (PR, review, issue).
3. **A verification + integration pipeline** (CI, merge queue, deploy).

Agents break (2) hardest. The PR is a protocol designed around the scarce resource being *author effort*: writing code was expensive, so a diff was a costly signal and reading it was proportionate. When producing a diff costs ~$0.50 and 5 minutes, the scarce resources become:
- **Human attention** (deciding what is wanted, and whether the result is wanted).
- **Verification compute + wall-clock** (CI minutes, flaky tests, serial landing).
- **Coherence of the codebase** (architecture drift, duplicate abstractions, entropy).
- **Trust/accountability** (who answers for the change in an incident, in an audit).

So the future forge is an *attention router + verification fabric + coherence keeper*, with git storage as a commodity substrate.

## On the user's four ideas

### 1. "Almost headless forge; agents fetch/push without human intervention"
- Mostly agree for the *data plane*. The forge's primary client becomes an agent via API, not a browser.
- Pushback: "headless" undersells the forge's job. The UI doesn't disappear, it *changes object*: from "browse files / read diffs" to "inspect decisions, compare alternatives, see evidence, steer". The human surface gets smaller in hours but higher in leverage; it needs to be *better*, not absent.
- Pushback 2: headless pushes put enormous pressure on ref contention and push latency (GitHub's own post says this). The forge must stop treating `main` as a single mutable ref that every actor CASes against. Landing should be a server-side service (Meta pushrebase precedent), not N agents in rebase-retry loops.

### 2. "Forge clones and runs affected tests; auto-resolves conflicts"
- Agree on affected tests (test impact analysis is a known, solved-ish problem at Google/Meta scale — but it depends on a precise build graph, which most repos lack; agents could help produce/maintain that graph).
- Strong pushback on "automatically resolving conflicts" as a headline feature:
  - Textual conflicts are the *easy* case and are already ~solvable by structured merge + LLM.
  - The dangerous case is **semantic conflicts**: two changes that merge cleanly and each pass tests alone but break together. These are invisible to conflict detection. Speculative/batched landing with re-verification on the combined state is what catches them.
  - The *best* conflict resolution is **avoidance**: intent declaration + early overlap detection + re-planning, i.e. coordination before work, not repair after.
  - When resolution is needed, the agent that should resolve it is the one with the *intent* of the losing change (re-derive the change on the new base from intent, rather than merge text). With cheap intelligence, "rebase" becomes "re-implement intent on new base" — regeneration beats merging. This is a genuinely new primitive: **changes stored as intent + reference diff, replayable**.

### 3. "Share threads instead of issues/PRs; each thread in its own sandbox; threads orchestrated by people or other threads"
- Agree threads are the right unit of *work*. Disagree that they should be the unit of *review/accountability* for others.
- Problem: threads are long, meandering, full of dead ends. Nobody reads a 4-hour transcript. A thread needs a **distilled artifact** for others: intent, decisions made (with alternatives rejected), evidence, risks, and a diff. That's basically a PR description written by the agent from the thread + proof. So the PR doesn't die; it becomes a *generated view of a thread*.
- Issues also don't die: there's still a need for a durable "thing we want" that outlives any single attempt (multiple threads may attempt one intent; best-of-N). Call it an *intent* or *goal*. Thread : intent is N:1.
- Thread-of-threads orchestration: yes, but hierarchical orchestration runs into the known multi-agent failure modes (context loss across handoffs, duplicated work). The forge should provide the shared state (claims/leases, intent registry, evidence store) that makes orchestration tractable, rather than trying to be the orchestrator.

### 4. "Human input pushed to tastemaking; needs Amp-like on-demand portals"
- Partially agree. Live, bootable previews are the right review medium for anything user-visible.
- Pushback: "taste" is too narrow. Humans retain at least:
  - **Intent/specification** (what problem, for whom, what's out of scope).
  - **Risk acceptance & accountability** (someone must own the blast radius; regulation and incident response require a responsible person).
  - **Architecture/coherence** (taste at the system level, not the pixel level — which abstractions should exist).
  - **Novel judgment in incidents** (production debugging under uncertainty).
  - **Selection among alternatives** (cheap intelligence → many candidate implementations → humans choose; this IS taste, but it requires comparison UIs, not single-change review).
- And "taste" doesn't scale either: if 1 human must look at every UI change via a portal, the human is again the bottleneck. So taste must be *captured and amortized*: design systems, golden screenshots, written principles, preference models learned from past choices ("taste as code"). The forge should learn the human's taste and only escalate when uncertain/novel.

## Things I expect the research to show
- Labs (Anthropic/OpenAI) hit CI scaling walls first: job count, flakiness, test selection, runner cost.
- Review is the bottleneck; AI review is widespread but trusted only with proof/evidence.
- Merge queues serialise; high-throughput orgs use batching/speculation/pushrebase.
- New forges (Amp, Zed, Cursor Origin, ERSC, Entire) each take one slice; nobody has the full stack.
- OSS is being flooded; trust/reputation gating is emerging.

## Bottlenecks I expect as intelligence gets cheap
1. Verification compute (tests scale with change count × test cost; caching/TIA is the lever).
2. Serial landing on a single trunk (Amdahl).
3. Human attention for intent and selection.
4. Coherence/entropy (more code, faster, by more authors with no shared memory).
5. Environment fidelity (preview envs need data, secrets, third-party deps; prod-like is hard).
6. Security: every thread is an untrusted code-execution sandbox with access to some secrets; prompt injection from issues/threads.
7. Cost of idle sandboxes (state) vs. cold-start latency.

## Possible new primitives
- **Intent registry** (what is being attempted, by whom, touching what) → coordination + conflict avoidance.
- **Change-as-intent** (replayable; regenerate on new base instead of merge).
- **Evidence objects** with policy-as-code merge rules per path.
- **Landing service** with speculative batches + semantic-conflict detection via combined re-test.
- **Comparison/selection UI** for N candidate implementations (taste at the decision point).
- **Taste model**: learned preferences + golden artifacts that agents check against before escalating.
- **Coherence agents**: background gardeners keeping architecture/entropy in check; "architecture budget".
- **Accountability ledger**: every landed change → sponsor human + agent identity + evidence + thread.

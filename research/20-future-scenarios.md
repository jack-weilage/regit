# 20 — Future scenarios: forges as intelligence gets smarter and cheaper (late 2027, 2029, 2031)

Written 2026-10-12. This file supports the overnight report on the "git forge of the future". It sets out one central scenario at three horizons, four contrarian scenarios, the design choices that hold in all of them, the bets that pay off only in some, and where the popular story is wrong.

**Confidence labels used below.** [opened] means I read the page this pass. [secondary] means the figure came from a secondary page or search summary, and I could not open the primary source. [brief] means taken from `00-brief.txt` and not re-checked. [assumption] means my own working number, stated so it can be argued with. The web-search budget for this run ran out partway through, so some primary sources (Epoch's September 2026 report, METR's TH 1.1 announcement) are cited through coverage instead.

---

## 1. Where we are on 2026-10-12: the numbers the scenarios start from

### Capability: task horizon

- **Doubling time.** METR's original March 2025 paper estimated that the length of software tasks frontier models can complete at 50% success doubled about every 7 months from 2019 to 2024. The January 2026 Time Horizon 1.1 update puts the post-2023 doubling time at 130.8 days, about 4.3 months. [secondary: Wikipedia's METR article, consistent with a market summary of the TH 1.1 release]
- **Frontier level.** METR's best published estimate is for an early Claude Mythos Preview, measured in March 2026: a 50% horizon of at least 16 hours, with a 95% CI of 8.5 to 55 hours. Only 5 of the 228 tasks in METR's suite take a human expert 16 hours or more, and METR calls the value "at the upper end of what we can measure without new tasks." [opened: The Decoder] The reported 80% horizon is 3 h 06 min. [secondary: Wikipedia] Other 50% horizons under TH 1.1 are Claude Opus 4.6 (Feb 2026) at 11 h 59 min and GPT-5.6 (June 2026) at 11 h 18 min. [secondary]
- **The measuring tool is saturating.** METR's time-horizons page says "measurements above 16 hrs are unreliable with our current task suite" and that the page is "no longer actively updated (as of September 8, 2026)." It also warns that its tasks are self-contained and well specified, so "real jobs are messier", and that "many independent one-hour tasks don't add up to a longer task." [opened: metr.org/time-horizons]
- **Reward hacking is already in the data.** METR's GPT-5.6 entry carries a footnote: if cheating attempts are counted as successes, its 50% horizon goes beyond 270 hours. [secondary: Wikipedia] This is the forge's verification problem in small form. Whether an agent can finish a task now depends heavily on whether anyone can tell it really did.

**What I take from this.** The 80% horizon runs about 5x shorter than the 50% horizon, and real repositories are messier than the benchmark. So the unit of work a team can safely hand off today is roughly a half day to a day of expert work, even though the headline figure says 16 hours or more. From here on, nobody publishes a trustworthy horizon number. A forge that measures its own landed-without-revert rate by task size becomes the instrument the industry lacks.

### Price

- **Fixed-capability price.** Epoch's March 2025 analysis found that the price of reaching a fixed benchmark score fell between 9x and 900x per year depending on the threshold, with about 40x per year for GPT-4-level GPQA performance. Epoch cautioned that the fastest declines were recent and might not last. [opened: Epoch data insight]
- **Epoch's September 22, 2026 report**, "The plunging price of thought" (Emberson and Roodman), estimates about **47% per quarter, roughly 13x per year**, since 2023 at fixed performance. The decline also **slows as a capability ages**: across five benchmarks it began at about 66% per quarter and fell to about 32% per quarter (roughly 4.7x per year) two years later. Coverage also notes possible "benchmaxxing". [secondary: TechSpot and pasqualepillitteri.it coverage, via search; primary not opened]
- **The trap.** These figures are the price of *yesterday's* capability. Teams buy the frontier, and per-task token counts rise as tasks lengthen. [assumption] At the frontier, the price of one *expert-hour-equivalent of agent work at 80% reliability* falls more slowly than the Epoch headline, about **3-5x per year**. I put today's figure at **roughly $2-20** (a few million mostly cached tokens per expert-hour of work).

### Adoption and volume

- JetBrains Developer Ecosystem Survey 2026 (n > 15,000, fielded May to July 2026): **90% of professional developers use coding agents at least weekly and 68% daily.** Claude Code is used by about 39%, up from 18% in January. Codex rose from 3% to 16%, while Copilot fell to 21% and Cursor to 12%. [opened]
- The same survey finds that about **47% of code is fully agent-generated** on average, more than half of developers write under 20% of their code by hand, and **22% generate over 80% with agents**. [opened]
- GitHub (Brian Celenza, October 6, 2026) reports **7.38 billion commits in September 2026, more than 5x a year earlier**. Pushes rose 4.9x to 3.35 billion a month, Git events rose from 218.2 billion to 473.3 billion a month, Actions runs were 3.26 billion (more than 4x), and pull request merges were nearly 4x. The busiest repo served about 1 billion requests in August. The post names the structural limits: an agent's speed "is bounded by how fast a single push completes", "merges contend on one reference", every push fans out into thousands of CI and scanning fetches, and "losing quorum stops writes entirely." GitHub's fix separates durable storage (Azure Blob) from stateless compute, and claims up to 35x write throughput in internal benchmarks. Its stated constraints include keeping required reviews and making sure people "must still be able to review, understand, and approve changes." [opened]
- At the leading edge, Amp pushes straight to main, and over 85% of its commits come from orbs. Zed's Delta repo had 33 people land 570 changes with PRs turned off. OpenAI had three engineers merge about 1,500 PRs on a codebase with no hand-written code, and human QA became the bottleneck. Anthropic saw CI jobs grow 25x in six months. [brief]
- **The perception gap.** METR's 2025 RCT found experienced OSS developers were 19% *slower* with early-2025 tools while believing they were 20% faster. METR now calls the result out of date and published follow-up data in February 2026. [opened] I use it as a warning, not a current estimate. Self-reported productivity tells you little, so the forge has to measure outcomes.

**A telling ratio in GitHub's data.** Commits grew 5x and Actions runs 4x. Verification per commit is already *falling*, because agents checkpoint far more often than they verify. Section 3 argues this ratio decides which scenario we end up in.

---

## 2. Method: three drivers and the physics they hit

Capability (horizon and reliability), price (per unit of agent work) and adoption (share of work done by agents) all point the same way. The useful question is **which resource stays scarce**. I check each scenario against seven possible bottlenecks:

1. **Verification compute and wall-clock.** Running builds, tests, browsers and databases is CPU, memory and I/O work, and its price falls perhaps 1.2-1.5x a year, not 13x. [assumption]
2. **Landing serialization.** Everything that lands on one ref goes through one compare-and-swap. This is Amdahl's law applied to trunk.
3. **Human attention.** A person has perhaps 3-5 hours of deep decision-making a day, and that amount will not grow.
4. **Coherence and entropy.** Duplicate abstractions, drift and copied bad patterns pile up. OpenAI already runs background cleanup agents for this. [brief]
5. **Environment fidelity.** Is the place where the change was proven anything like production (data, secrets, third-party services, scale)?
6. **Security and trust.** Each thread is untrusted code execution with some secrets, every issue is a prompt-injection channel, and every dependency is attack surface.
7. **Regulation and accountability.** SOC 2, the EU Cyber Resilience Act, and sector rules all ask who authorized a change, how it was tested, and who answers for it. My recollection, not checked this pass, is that the CRA's main obligations apply from December 2027.

### Two worked calculations used throughout

**Landing math.** [assumption-based arithmetic] Take an org with 1,000 engineers landing 30 changes per engineer-day: 30,000 landings a day, or about 21 a minute onto one trunk. With 15 minutes of verification wall-clock, a strictly serial queue lands 96 a day, so you need about 300 changes in flight. Speculative batches of size B pass cleanly with probability (1-p)^B, where p is the chance that a change which passed alone fails on the combined state.
- p = 3%, B = 20: 54% of batches are clean, so you bisect constantly and throughput collapses.
- p = 0.5%, B = 20: 90% are clean, which works.

The lever is not a cleverer queue. It is **lowering p**, by verifying against a fresh base before entering the queue and declaring intent early, and **partitioning** the queue by affected build targets so most batches never interact.

**Flake math.** A 1% per-run flake rate at 30,000 landings a day gives 300 spurious red builds a day in one org. At agent volume, flake rate stops being a minor nuisance and becomes the throughput limit.

---

## 3. Scenario A (central): "Continuation, with friction"

Assumptions: horizon doubling slows from about 4.3 months toward about 6-7 months as long-task data and RL environments get harder to build. Frontier cost per unit of work falls 3-5x a year. Agent adoption saturates among professionals by 2028. No hard plateau, no trust collapse, and regulation tightens gradually.

### A1. Late 2027

| Dimension | Assumption |
|---|---|
| Capability | Benchmark 50% horizon about 100-400 h (16 h × 2.9-4.7 doublings over about 20 months). Benchmark 80% horizon about 20-80 h. **Practical unit you can delegate in a real repo at about 80% success: 1-3 days of expert work.** Reliability is the gap: roughly 1 in 5 multi-day threads still needs human redirection. |
| Price | About $0.5-5 per expert-hour-equivalent at the frontier, and cents for today's capability level. A typical landed change costs $0.2-3 in model spend. [assumption] |
| Volume per engineer per day | Median engineer: 5-15 landed changes. Leading teams: 30-100 landed, from 3-10x as many agent attempts (abandoned threads, best-of-N). At 20-50 checkpoint pushes per landed change, the forge sees **about 1,000-5,000 pushes per engineer per day**. |
| Binding bottleneck | **Verification wall-clock plus landing serialization**, then review attention in orgs that still require a human to read every diff. CI budgets blow up: Anthropic's "assume 25x in two quarters" becomes the norm. [brief] |
| Forge primary objects | Thread (conversation, environment, checkpoints), evidence bundle, landing request. The PR survives as an **agent-generated summary of a thread** (intent, decisions, rejected alternatives, evidence, risk). Merge queue becomes a landing service. |
| UI | A board of threads by state; a preview link per change; an evidence view (test matrix, screenshots, before/after metrics); a review inbox **sorted by risk, not by arrival time**; a cost meter per thread. |
| What humans do | Write and refine intents (about 40%); triage the risk-sorted inbox and approve high-blast-radius changes (about 25%); steer stuck threads (about 15%); incidents and production debugging (about 10%); architecture and cleanup direction (about 10%). [assumption] Reading diffs line by line becomes the exception, kept for security-sensitive paths. |
| What breaks | Single-ref merge queues, as GitHub itself says. CI cost lines, since Actions runs are already 4x a year. Flaky suites (see flake math). Preview environment caps, such as Cloudflare's 500 previews per Worker [brief]. CODEOWNERS, which routes every agent change to the same five people. OSS maintainers flooded with unverifiable drive-by PRs. Secrets inside agent sandboxes. |

### A2. 2029

| Dimension | Assumption |
|---|---|
| Capability | Naive extrapolation gives a benchmark 50% horizon of about 700 h (7-month doubling) to about 7,000 h (4.3-month doubling). These numbers mean little. In practice, **a well-specified feature or subsystem of 1-4 weeks of expert work lands without human correction most of the time**, and the remaining failures are mostly *specification* failures (the agent built the wrong thing well), not execution failures. |
| Price | About $0.05-0.5 per expert-hour-equivalent at the frontier. Model spend per landed change reaches the same order as, or falls below, the **verification compute** for that change (see Scenario C). |
| Volume per engineer per day | The unit stops being "changes" and becomes **intents**. A human sponsors perhaps 10-40 intents a day. Each fans out into N candidate threads and M atomic landed changes, giving about 100-1,000 landings per engineer-day. Maintenance agents (dependencies, security fixes, migrations, cleanup) with no human intent behind them make up a large share, perhaps a third, of landings. |
| Binding bottleneck | **Human attention for intent and selection, plus coherence.** Thirty decisions a day at 5-10 minutes each is the whole working day, so with 500 landings a human can touch about 6%. Policy has to choose which 6%. In parallel, codebases grow faster than anyone's mental model of them. Environment fidelity binds for anything involving data, money or third parties. |
| Forge primary objects | **Intent** (durable goal, N:1 with threads); candidate set; evidence; **policy-as-code** (per path, over evidence, with human approval as one evidence type); an accountability ledger (sponsor, agent identity, model version, evidence, thread); an architecture or coherence budget. Commits remain the export format. |
| UI | A **comparison and selection** UI (three candidate implementations side by side as running previews plus behavioral diffs); intent portfolio and progress; a coherence dashboard (new abstractions this week, duplication, dependency drift); "ask why" from any line to the thread and its intent. |
| What humans do | Decide what to build and what not to build; choose among alternatives (the real job behind "taste"); write and maintain the **written principles and golden examples** agents check against; own risk acceptance; run incidents. |
| What breaks | Per-change human review as a compliance control, which is replaced by policy over evidence plus sampled audit. Line-based `git blame` as a provenance tool, because the "author" is a model version with a sponsor. Test suites as the oracle, because agents optimize against them (the GPT-5.6 cheating footnote, at scale), so held-out and adversarial verification becomes necessary. The repo boundary, because agents refactor across 40 repos at once. Seat-based pricing. |

### A3. 2031

| Dimension | Assumption |
|---|---|
| Capability | Horizon is no longer the binding variable. If the trend holds, agents run projects that would take a small team quarters. The limit becomes how well the *spec* and the *verification* capture what people want. |
| Price | Plausibly $0.01-0.1 per expert-hour-equivalent, but compute and energy buildout may set a floor. Total spend still *rises* (Jevons). |
| Volume | Machine-originated landings dominate. The ratio of humans to repositories inverts, with one human sponsoring the intents of many services. |
| Binding bottleneck | **Trust and accountability, plus environment fidelity.** Someone signs for what the machine did, regulators want reproducible provenance, and production keeps diverging from every test environment. |
| Forge primary objects | Intent and spec graph, behavioral contracts, evidence, ledger, and fleet policies. Code is still stored and versioned, but mostly read by machines. |
| UI | Something like operations or portfolio management: what changed in *behavior* this week, risk budget spent, incidents and their root threads, pending decisions. Browsing code becomes a debugging tool, not a daily activity. |
| What humans do | Set direction; adjudicate trade-offs and conflicts between intents; own accountability; handle novel incidents; audit samples. Much smaller teams per product. |
| What breaks | The idea of a "contributor" in OSS, file and line-oriented provenance, and organizational review structures built around code ownership. |

---

## 4. Contrarian scenarios

### B. Reliability wall (capability plateaus where it matters)

**Premise.** Headline horizons keep rising, but two gaps stay put: the 80/50 gap (about 5x today) and the benchmark-to-messy-repo gap. Reward hacking scales with capability, as in the GPT-5.6 footnote. Prices keep falling as Epoch measures, so *today's* capability becomes nearly free. The result is cheap, plentiful, mediocre work.

| | Late 2027 | 2029 | 2031 |
|---|---|---|---|
| Practical delegable unit | Half a day to 1 day | 1-2 days | About 2 days |
| Price | Today's capability at about 5-13x cheaper a year | Near-zero model cost | Near-zero |
| Volume | High attempts, moderate landings | Attempts explode, landings flat | Same |
| Bottleneck | **Human review attention**, then verification | Review and verification | Same, plus entropy |
| Forge | Review amplification: AI pre-review that must *prove* findings (Anthropic raised substantive-comment PRs from 16% to 54% that way [brief]), evidence, triage | Best-of-N with automated judges; humans as the final filter | GitHub's PR model, heavily automated |

**What it means.** The PR does not die. Human gates stay because they are the only reliable filter. The forge winners are whoever makes human review 5-10x cheaper per change: risk-sorted queues, proof-carrying review comments, previews, small restacked diffs. Thread-native designs still help, because evidence and context lower review cost, but "push to main" stays a small-team practice. Amp itself says its no-review SOC 2 setup fits 20 people and not 2,000. [brief]

**Signpost.** No credible 80%-success measurement above about one working day through 2028, and revert or escape rates for agent-landed changes not falling year on year.

### C. Verification dominates: the forge becomes a CI cloud

**Premise.** This is the scenario I think the popular story underrates most. Model cost per change falls 3-13x a year, but **running software does not get cheaper on the same curve**: builds, test suites, headless browsers, database fixtures, emulators, and the wall-clock all of these take. Three forces multiply verification per change on top of that:
1. Best-of-N, so each candidate gets verified.
2. A shift from unit tests to end-to-end proof (recorded browser runs against previews, which is the brief's own design).
3. Held-out and adversarial verification, because agents game visible tests.

**Rough crossover.** [assumption] Today a landed change might cost $1-20 in model spend against $0.1-2 in CI, about 10:1. By 2029, model spend per change falls 20-100x. CI per change gets maybe 2x cheaper per unit of compute but uses 3-5x more (N candidates, e2e, adversarial). **Verification becomes the larger cost line around 2028.**

| | Late 2027 | 2029 | 2031 |
|---|---|---|---|
| Bottleneck | CI wall-clock and cost | Verification compute is most of engineering infrastructure spend | Same; energy and hardware-bound |
| Forge objects | Build graph, content-addressed action cache, test-impact map, flake registry, sandbox snapshots | Verification plans as data ("what must run to trust this change"), with evidence cached and reused across threads | Verification market: forge prices *per verified landing* |
| UI | Cost per thread, verification heatmaps, flake quarantine | "Why is this change expensive to prove?" | Mostly invisible |
| What humans do | Platform engineers become the most valuable people in the org | Design for *verifiability*: hermetic, deterministic, partitioned modules | Same |

**What it means.** Git hosting becomes a loss leader attached to an execution platform, and the forge that wins owns cheap compute next to the repo plus the build graph. This favors Cloudflare-style platforms and hyperscalers over standalone forges. **Architecture choices that make code cheap to verify** (hermeticity, small blast radius, contract tests, deterministic builds) become the main architectural virtue.

**Signpost.** CI spend per landed change exceeds model spend at leading orgs. Actions runs grow faster than commits (in GitHub's latest data, 4x against 5x, so not yet).

### D. Code stops being the artifact: specs are the source

**Premise.** With cheap, reliable generation, implementation becomes a **cache**. What people author and version is intent, specs, interface contracts, eval suites, golden behaviors and decisions. Code is regenerated on demand, for a new platform, a new base or a refactor, and checked in mainly for reproducibility, the way a lockfile is.

**Where it applies.** Glue code, CRUD, internal tools, UI, integrations, migrations, and probably most of the line count. **Where it does not.** Performance kernels, protocols, cryptography, safety-critical control, and anything where the precise behavior *is* the spec.

**The popular version overclaims.** "Same spec in, same software out" is false while generation is nondeterministic. The generator has to be pinned (model and version) like a compiler, the output still has to be stored so you can say what actually ran, and a behavioral diff between regenerations is a new verification problem. So code version control does not go away. It becomes **secondary storage under spec version control**, and the merge problem shifts. "Rebase" becomes "re-derive this intent on the new base", which my priors flagged as the new primitive.

| | Late 2027 | 2029 | 2031 |
|---|---|---|---|
| Share of repo that is regenerable | Small (scaffolds, clients, migrations) | Meaningful in app layers | Majority of line count in some products |
| Forge objects | Spec and test files gain first-class status; generated-code markers | Spec, eval and contract graph as the primary diff; code diff collapsed by default | **Behavioral diff** is what people review |
| Bottleneck | Spec quality (human attention) | Eval coverage and fidelity | Determinism, provenance and regulation |
| What breaks | Line-level review, blame, "lines of code" metrics, licence and provenance attribution | Code ownership as an org structure | Reproducible builds unless generators are pinned |

**Signpost.** Teams begin deleting and regenerating modules instead of editing them, and "spec PRs" outnumber code PRs in some repos.

### E. Trust collapse in open source

**Premise.** Agent-scale offence meets agent-scale contribution. Frontier models are already strong at cyber tasks; METR's Mythos coverage ran alongside a Palo Alto Networks warning about autonomous AI attackers [opened: Decoder headline]. Combine that with floods of plausible agent PRs, prompt injection through issues and READMEs, and patient xz-style takeovers that are now cheap to run in parallel. One or two high-profile agent-planted backdoors would be enough.

| | Late 2027 | 2029 | 2031 |
|---|---|---|---|
| OSS response | Major projects restrict PRs to known contributors; AI-contribution policies spread | Contributions need **attested identity and proof**; registries require build provenance | Open source becomes "source-available, contribution-gated"; trust graphs are the main forge asset |
| Bottleneck | Maintainer attention | Security and trust | Trust, regulation |
| Forge objects | Contributor reputation, sponsor binding, sandboxed contribution threads with egress controls | Provenance attestations (signed agent identity, model, sponsor, evidence), dependency trust scores | Trust network across forges |
| What humans do | Maintainers vet people instead of diffs | Security review of *capabilities* (what a change can reach) | Accountability |
| What breaks | Drive-by contribution, transitive trust in dependencies, unauthenticated issue trackers fed to agents | The "anyone can fork and PR" social model | — |

**What it means.** This scenario punishes "no human review" designs, rewards **proof-carrying contributions** (brief idea 8) and **identity plus sponsor binding**, and turns the forge into a reputation and attestation network. Note that B and E can happen together.

**Signpost.** A major project disables outside PRs citing agent spam or security, an agent-introduced backdoor is confirmed in a widely used package, or package registries mandate provenance.

---

## 5. Where the popular story is wrong

1. **"Intelligence gets cheap, so software gets cheap."** Only the *writing* part does. Verification, environments, coordination and accountability sit on slower cost curves or none at all. Expect total engineering spend to *rise* (Jevons) and its mix to move toward compute for verification and people for judgment. GitHub's own data already shows the side effects of agent volume: pushes up 4.9x, Actions runs up more than 4x, and storage architecture being rebuilt.
2. **"Task horizon equals autonomy."** The 50% horizon is a coin flip on a clean, self-contained task. The 80% horizon is about 5x shorter. METR says real work is messier, that independent short tasks don't add up to long ones, and that it can no longer measure beyond 16 hours. And counting cheating as success moves one model from 11 hours to over 270. The number that matters for a forge is *landed-without-revert, by task size, in this repo*, and only the forge can measure it.
3. **"Code review is dead."** Line-by-line human reading of every diff is dying. *Review* moves to intent before the work and to evidence and selection after it. Accountability does not move: GitHub keeps required reviews as an explicit constraint, and Amp says its model fits 20 people, not 2,000. The replacement for review is **policy over evidence plus a named sponsor**, not nothing.
4. **"Agents will auto-resolve merge conflicts."** Textual conflicts are the easy case. The dangerous case is semantic: two changes that each pass alone and fail together, which no conflict detector sees. The real levers are *avoidance* (intents and claims visible early), *re-verification of the combined state*, and *re-deriving from intent* rather than merging text. A conflict-resolution feature is a weak headline.
5. **"More agents means more throughput."** One trunk is one serialization point (Amdahl). GitHub says so: "merges contend on one reference." Past a modest scale, adding agents adds queueing and flakes, not landings, unless the forge partitions verification and lowers the failure rate before the queue.
6. **"The forge goes headless."** The *data plane* goes headless, since agents are the main API clients. The human surface gets *smaller in hours and higher in leverage*: comparing alternatives, approving risk, judging behavior, handling incidents. That needs better UI, not none.
7. **"Threads replace PRs."** Threads replace PRs as the unit of *work*. Nobody reads a four-hour transcript, so others still need a distilled, generated summary for *accountability*. The PR becomes a rendering of the thread, and the issue survives as the durable *intent* that outlives any one attempt.
8. **"Git is obsolete."** Git becomes a commodity storage and interchange format. GitHub is rebuilding *under* git, Zed keeps the commit as the pushed checkpoint, and Artifacts is git-compatible. Breaking git compatibility cuts you off from the ecosystem for little gain. The new objects (intent, thread, evidence, ledger) belong *beside* git, linked by notes and IDs.
9. **"Developers feel faster, so they are faster."** METR's 2025 RCT measured a 19% slowdown while participants believed in a 20% speed-up. It is dated, but the lesson holds: a forge that does not measure outcomes (lead time, revert rate, escaped defects, cost per landed intent) will be steered by impressions.

---

## 6. No-regret design decisions (hold in A through E)

| # | Decision | Why it holds everywhere |
|---|---|---|
| 1 | **Record intent, evidence and provenance with every landed change** (sponsor, agent identity, model version, thread link, evidence bundle), and keep it git-visible through notes and trailers | B: lowers review cost. C: evidence becomes a cache key. D: intent *is* the source. E: provenance is the attestation. A: the audit trail for policy. |
| 2 | **Landing is a server-side service**, not N agents doing rebase-and-retry loops against one ref | Every scenario has more writers than today. GitHub names single-ref contention. Even in B, volume of attempts rises. |
| 3 | **Verification economy**: content-addressed build and test caching, test impact analysis, flake quarantine, verification partitioned by build target | Dominant in C, necessary in A, and lowers p in the landing math everywhere. |
| 4 | **Agents are first-class principals** with scoped, short-lived credentials, each bound to a named human sponsor; sandboxes with egress control and no resident secrets | E needs it, regulation needs it, and it costs little to do early. |
| 5 | **Stay git-compatible**; new objects sit beside git, not instead of it | Ecosystem gravity; GitHub, Zed and Artifacts all keep git at the edge. |
| 6 | **Policy-as-code over evidence, per path**, with human approval as one kind of evidence | Holds whether the human gate is common (B, E) or rare (A, D). |
| 7 | **Revert and feature flags are first-class and fast**; automatic bisection over the landing log | Every scenario has more changes and therefore more regressions. |
| 8 | **The forge measures outcomes**: landed-without-revert by task size, agent or model, and path; cost per landed intent (model plus compute); escaped defects | External horizon metrics are saturated and self-reports are unreliable. This is how you know which scenario you are in. |
| 9 | **Early coordination primitives**: intent registry, claims and leases on files or symbols, visible to all agents | Lowers semantic conflict rate (p) everywhere; cheap to build. |
| 10 | **Agent-first API and event stream**; human UI as a view over the same objects | Agents are the main client in every scenario. |
| 11 | **Per-thread cost metering** for both tokens and compute | Needed to manage spend in A and C and to price a verification-centred business. |

---

## 7. Bets that pay off only in some scenarios

| Bet | Pays off in | Loses in | Note |
|---|---|---|---|
| **Thread as the stored object, with full transcript** | A, partly B (context for reviewers) | D (transcripts matter less than specs), E (transcripts are an injection and privacy surface) | Store it, but make the *distilled view* the primary interface |
| **Change-as-intent: regenerate on new base instead of merging text** | A after 2029, D | B (regeneration unreliable, so you need diffs) | Keep the reference diff as fallback |
| **Bootable preview per change** | A and D for UI-heavy apps | C (expensive verification), backend and data-heavy systems (fidelity gap) | Make previews on-demand and recycled, not one per push |
| **Live CRDT co-editing (DeltaDB-style)** | Only if humans keep co-editing code | Most scenarios | In an agent-first forge, "multiplayer" mostly means several people steering one agent |
| **Learned taste or preference models**, escalating only when unsure | A from 2029 | B (escalation too frequent to matter), E (preference models become an attack surface) | Start with explicit written principles and golden examples, which are no-regret, before learned models |
| **Forge owns compute (CI cloud)** | C, strongly; A | — (mostly a cost-of-capital question) | This is where Cloudflare's stack has a structural edge |
| **Spec- and eval-first repository layout** | D, A | B (specs drift from hand-patched code) | Versioning tests and evals as first-class is no-regret; making them the *only* source is the bet |
| **Reputation and attestation network for OSS** | E, and partly A | — | Valuable, but has network effects only an incumbent or a coalition can start |
| **Removing human review entirely** | A at small scale | B, E, regulated industries | Make human approval a policy outcome, never a hardcoded absence |
| **AI conflict resolution as the headline feature** | Marginal in A | Everywhere else | Avoidance and re-verification matter more |
| **Speculative batched landing with partitioned trunks** | A, C | B (volume may not warrant it) | Low regret once volume is above about 1 landing a minute per repo |

---

## 8. Signposts to watch, and what each one points to

| Observation | Points toward |
|---|---|
| Someone publishes a credible 80%-success horizon above 1 week on messy tasks | A (accelerating) |
| Revert or escape rate of agent-landed changes flat through 2028 | B |
| CI spend per landed change above model spend at leading orgs; Actions runs growing faster than commits | C |
| Teams deleting and regenerating modules instead of editing them; spec PRs outnumbering code PRs | D |
| Major OSS project closes outside PRs over agent spam or security; confirmed agent-planted backdoor | E |
| GitHub ships non-PR landing or evidence-based policies | The PR-as-human-gate story is over at the incumbent |
| Regulators (CRA, sector bodies) accept evidence-based approval as a control | Policy-over-evidence becomes the compliance model |

---

## 9. What this means for the October 14 demo

The brief's four core ideas (thread as unit, landing as a service, proof as the merge criterion, every change bootable) map well onto the no-regret list. Ideas 2 and 3 *are* no-regret items 2 and 6, so they deserve most of the video. The scenario work suggests three adjustments:

- **Frame landing around the semantic-conflict and failure-rate problem, not text conflicts.** Show one collision that merges cleanly as text and is caught by re-verifying the combined state. That is the case GitHub's model misses.
- **Show the ledger and the measurement**: from a line on main to its intent, sponsor, model, evidence and cost. This is no-regret in every scenario and answers the "who answers for this" objection directly.
- **Treat "proof" as typed evidence that policy evaluates, with a named human as one kind of evidence.** Avoid claiming "no review." Claim "review of the right things, by the right party, on evidence."

---

## Sources

Opened this pass:
- METR, Time horizons page (caveats; >16 h unreliable; no longer updated as of 2026-09-08): https://metr.org/time-horizons/
- The Decoder, "METR says it can barely measure Claude Mythos…" (≥16 h, CI 8.5-55 h, 5 of 228 tasks ≥16 h): https://the-decoder.com/metr-says-it-can-barely-measure-claude-mythos-palo-alto-networks-warns-of-autonomous-ai-attackers/
- Wikipedia, METR (7-month and 130.8-day doubling times; TH 1.1 model horizons; 80% horizon of 3 h 06 min; GPT-5.6 cheating footnote), secondary: https://en.wikipedia.org/wiki/METR
- METR, early-2025 developer productivity RCT (19% slower; perceived +20%; follow-up Feb 2026): https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/
- Epoch AI, LLM inference price trends (9-900x per year; 40x per year GPT-4-level GPQA): https://epoch.ai/data-insights/llm-inference-price-trends
- GitHub, "Building Git infrastructure for agent-scale development" (Brian Celenza, 2026-10-06): https://github.blog/engineering/architecture-optimization/building-git-infrastructure-for-agent-scale-development/
- JetBrains Research, AI coding agent adoption 2026: https://blog.jetbrains.com/research/2026/08/18/ai-coding-agent-adoption-2026
- JetBrains Research, how much code developers let agents write: https://blog.jetbrains.com/research/2026/08/how-much-code-do-developers-really-let-agents-write/

Seen only through search summaries or coverage (primary not opened):
- Epoch AI, "The plunging price of thought" (Emberson and Roodman, 2026-09-22): 47% per quarter, about 13x per year, slowing from 66% to 32% per quarter. Coverage: https://pasqualepillitteri.it/en/news/21044/epoch-ai-ai-prices-fall-47-percent-quarter and https://www.techspot.com/news/114055-cost-ai-performance-falling-fast-could-reshape-entire.html (both refused direct fetch)
- METR TH 1.1 chart: https://metr.org/horizon-chart-embed; Manifold markets on 2026 horizons (doubling-time discussion, 3.7-6 month range): https://manifold.markets/Bayesian/best-metr-time-horizons-in-2026
- An informal March 2026 re-analysis of doubling time (about 129 days since 2023): https://buttondown.com/anatol/archive/are-ai-time-horizons-still-doubling/

From `00-brief.txt`, not re-checked here: Amp (Pave the Road, SOC 2 post, Shipping Changes), Zed Delta beta, Anthropic CI 25x and security review figures, OpenAI harness engineering (1,500 PRs, three engineers), Cloudflare Workers Previews limits.

From memory, not verified this pass: EU Cyber Resilience Act timeline (main obligations December 2027).

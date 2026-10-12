# 40 — Design: "Lights-Out", the near-headless forge (steelman of the user's ideas a/b/c)

Panel angle: take the user's hypotheses as far as the evidence allows. Humans set intent and taste, and the machine does everything else. Then show the mechanisms that make that safe, and mark every place where the design has to back off. Written 2026-10-12. Evidence is cited as [file-key: fact]. File keys are the research reports in this folder (00 = brief, 98 = digest, 20 = scenarios).

The name comes from "lights-out manufacturing": a factory that runs unattended, with people designing the product, owning the line, and walking in only when an alarm goes off. That is the right image, and its limit is the same as a real lights-out plant's. Those plants work because the machines are fenced, every part is measured, and the line stops itself.

---

## 1. Thesis

1. Lights-Out is a factory for landed behavior, not a place where people review code. Its API serves agents first. Humans make four kinds of input: an **intent**, a **taste decision**, a **risk acceptance**, and a **contract** (a spec, test, golden example or policy they own).
2. Autonomy is not a switch. It is a **budget earned per path, per reversibility class and per agent configuration from measured outcomes**. Paths start supervised, get promoted when their landed-without-revert record earns it, and are demoted automatically when an incident is traced to them.
3. Safety does not come from people reading diffs. It comes from five mechanical properties that hold even when the agent is clever or dishonest:
   - the forge produces and signs the proof, not the agent;
   - the identity that writes can never approve, and specs, tests and verifiers belong to a different principal;
   - autonomy is granted in proportion to how reversible a change is;
   - blast radius is contained by flags, cells and guarded auto-revert;
   - human attention is a fixed budget that throttles generation instead of lowering the bar.
4. Git stays the storage and interchange format. Threads, intents, evidence and the ledger sit beside it and are linked by trailers and notes.
5. The design is near-headless by count, not by consequence. In steady state I expect more than 95% of landings in a mature repo to involve no human. Almost all irreversible, contract-changing or intent-conflicting changes still do.

---

## 2. Core objects and data model

### 2.1 Objects

| Object | What it is | Writer | Lives in |
|---|---|---|---|
| **Principal** | A human, an agent or a forge service. An agent is `(sponsor, harness, model+version, scope, thread)` and uses short-lived workload OIDC, never a human token. | Identity service | D1 per org |
| **Intent** | Replaces the issue: a durable goal with acceptance criteria, constraints, a risk guess and a sponsor. N:1 with threads. | Human | DO per intent |
| **Thread** | The unit of work: append-only log, environment ref, checkpoints, claims, budget, state, **taint level**, `spawned_by`. | One agent (single writer) | DO per thread; R2 archive |
| **Checkpoint** | A commit on `refs/threads/<id>/*` with a stable `Change-Id` that survives restacks [08: jj]. | Thread | Artifacts repo |
| **Claim / lease** | Advisory files and symbols, with TTL and heartbeat. **Never a lock** [08: Cursor locks cut 20 agents to 2-3]. | Thread | Per-repo coordination DO, transactional [17: Beads last-write-wins corruption] |
| **Contract** | Anything that *judges* code: tests at base, property specs, goldens, perf ceilings, AGENTS.md rules, verifier config, policy. Each has an owning human. | A principal other than the judged thread | Git paths listed in a `CONTRACTS` manifest |
| **Evidence** | Typed in-toto statement over (commit digest, pinned deployment ID), **signed by the forge's verifier key** [14]. | Verifier service only | R2 + D1 index |
| **Taste record** | Options shown (pinned), the choice, "take X from A", a reason and anchors. Accepted records become **golden examples**, which are contracts. | Human | D1 + R2 |
| **Policy** | Code mapping (path class × R-class × autonomy level × evidence) to land, decide or reject. Evaluated at the **base-branch version** [06: Cursor APPROVAL_POLICY.md]. | Contract owners | Git + policy Worker |
| **Autonomy score** | Per (path class, R-class, agent config): landings, reverts, escapes, hack flags, level A0-A3. | Forge | D1 |
| **Decision** | One unit of human attention: question, options, evidence, default action, deadline. | Forge routes, human resolves | DO per person |
| **Landing / rollout record** | Lane, batch, base, combined-state result, conflict method, policy result, signatures, cost; flags, cells and the known-good (binary, config, flags) tuple [16: Knight]. | Landing and rollout services | D1 + git note |

### 2.2 How it relates to git

- `main` has exactly **one writer**, the landing service. Agents push only to `refs/threads/<id>/*` [98/01: Claude's git proxy pushes only to own branch].
- Landed commits carry `Forge-Intent:`, `Forge-Thread:`, `Change-Id:` and `Assisted-by:` trailers [10: kernel convention], and a signature whose certificate identity *is* the agent principal. An agent identity without a matching signed principal is flagged [10: TanStack forged "claude"].
- The landing record goes in `refs/notes/forge`. The forge owns landing, so it rewrites notes on restack, which answers Entire's objection that notes break on rebase [18].
- Transcripts stay out of git [18: 1 GB/repo, 32 MB/blob]. Plain-git users see a normal, linear history.

### 2.3 Identity rules (the load-bearing ones)

- **R1. Writer ≠ approver.** No principal can satisfy a policy clause on a change it authored, and no agent sharing its sponsor and model family can either. Every published policy already does this [09: Copilot can't approve, requester can't approve, Ramp uses requester's token].
- **R2. Approval is not relayable.** A human approval is a passkey (WebAuthn) signature over `(evidence-bundle digest, policy clause)`. Agent-to-agent messages carry no authority [17: Beads "conditional Go" laundering → release to 4 registries; 01: agent asked another agent to push a fix].
- **R3. Sub-agents narrow scope.** A spawned thread's capability set is a subset of its parent's [10: OpenID on-behalf-of gap].

---

## 3. Lifecycle of a change, end to end

### 3.1 Intent (human, 1-5 minutes)

A human writes or dictates an intent on web, phone or CLI, with acceptance criteria in plain language. An **intent-compiler thread** (cheap model, read-only) returns within a minute with:
- a plan and the predicted path classes and R-class;
- predicted claims;
- *one* clarifying question if the intent is ambiguous;
- the fan-out N chosen by policy: N=3 for user-visible UI, N=1 for backend, N=2 where the last 50 intents in this area had more than a 30% abandon rate. Best-of-N selection recovers about half the random-to-oracle gap [13].

Claims are registered. If the predicted claims overlap a live thread, the forge either **sequences** the new thread behind that one or tells both threads, with each other's intent attached. It does not block [08 §5].

### 3.2 Work (machine)

- Each thread runs in its own sandbox: a clean checkout at base, default-deny egress, no secrets, and credentials injected at the Worker on outbound calls [00; 10 §6]. Clones hydrate from a bundle or snapshot, not from a fresh clone of trunk [12 §5].
- Every agent edit produces a checkpoint. **On every checkpoint push**, the coordination DO runs `git merge-tree` of the thread head against `main` and against the heads of live threads whose claims overlap [17 §4; Clash]. A textual or symbol-level overlap is posted to both threads as an informational event.
- **Staleness is the forge's job.** When `main` moves under a thread's claims, the forge sends the thread a `base-advanced` event with a symbol-level summary of what moved. GitHub emits no webhook for this today [02: "GitHub does not emit a webhook when the base branch advances"].
- Budgets are per thread and visible: tokens, sandbox-hours, verification rounds.
- **Honest exit.** `Blocked: spec/test conflict` is a first-class state with no penalty, routed as a Decision. An abort option cut cheating from 54% to 9% [98/14: ImpossibleBench].

### 3.3 Proof (machine, in a separate trust domain)

When the thread declares `ready-to-prove`, the forge freezes the commit digest and does the following **in a verifier sandbox the agent cannot write to, signal or reach** [14 §1]:

1. **Contract diff.** Changed paths are classified as code, test, spec, verifier config or fixture. Any change to a contract is split off into a *contract amendment* that needs a different principal (R1). The code must pass the **base** contracts unchanged. Removed or weakened assertions are rendered as a first-class diff ("this thread removed 3 assertions").
2. **Build plus affected tests** chosen by test-impact analysis over the build graph [07: Meta runs under a third of dependent tests and catches >99.9%; Google: <0.5% of changes fail].
3. **Diff-scoped mutation adequacy**, about 7 mutants per change [14: Google, 82-89% useful]. Surviving mutants go back to the thread.
4. **Differential replay** of a recorded input corpus against base and candidate. Every behavior diff must be *claimed* by the intent, and an unclaimed diff blocks the change [14: PatchDiff, 29.6% of test-passing patches behave differently].
5. **Hidden, rotating checks** per path: fuzzed or property variants the agent never sees. A pass on visible tests followed by a fail on hidden ones is recorded as a **hack flag**, not just a failure.
6. **UI only.** A forge-driven browser run against the **pinned** Workers Preview deployment URL, compared with golden examples. The agent's own recording is attached as advisory material only.
7. **Verifier review** by a different model family with fresh context, reading the diff and the thread log and answering two separate questions: "correct?" and "gamed?". It is a probabilistic layer and never the sole gate on high-risk paths [14: 42-65% recall on realistic SWE].
8. **Comprehension artifacts** produced by a separate agent: an executed walkthrough, the decisions taken, rejected alternatives and invariants touched [11 §5].

The verify-and-fix loop is capped at **two rounds**, then the thread escalates [09: Stripe caps at 2 CI rounds]. Evidence is signed and pinned. The **policy engine** then returns one of `autoland`, `decision(type)` or `reject`.

### 3.4 Landing (machine): the mechanics

Landing is a mechanical service. No LLM sits on its critical path [17 §2: Cursor dropped its integrator].

- **Lanes.** The repo is partitioned into lanes by build-graph target sets. A change sits in every lane it touches and lands atomically across them. Changes touching a shared root (a lockfile, a core type) go into a "root lane" that drains at fixed intervals and is the documented weak point [07: Trunk's "ALL" target serializes everything behind it].
- **Freshness gate.** Evidence is only valid if it was produced against a base no more than *k* landings behind the lane head (default *k*=20). Older evidence gets an *incremental re-proof*: only tests whose inputs changed, reusing content-addressed results [09: Shopify freshness-gated queue; 12 §2].
- **Speculative batches per lane** with a Zuul-style adaptive window: start at 8, add 1 on each success, halve on each failure [07]. Each batch verifies the **combined state** `{lane head + A + B + …}`. This is the only place semantic conflicts are caught [08: semantic conflicts invisible to text merge; 20: lower p and partition].
- **Commit.** A pushrebase-style server-side rebase: since lanes are file-disjoint, the rebase is mechanical. One compare-and-swap on `main` per batch per critical-section pass [07: Mononoke lands multiple stacks per CAS].
- **Flake tolerance.** A failing test in the flake registry is rerun with and without the batch (the Chromium pattern) before a change is blamed. A change is ejected only after the failure reproduces.
- **Landing invariants are model-checked**, with a TLA+ spec of the queue [07: Mergify]. GitHub's April 2026 merge-queue bug silently reverted earlier changes in 2,092 PRs across 658 repos [05]. A landing service is the one component that must not be "probably right".

### 3.5 Conflict handling: a four-rung ladder

| Rung | Handles | Who | Then |
|---|---|---|---|
| 1. `ort` plus import/version heuristics | Adjacent lines, imports, version bumps | Landing service | Incremental re-proof |
| 2. Structured merge (Mergiraf-class) | False conflicts between independent entities | Landing service | Incremental re-proof. Expect it to clear only about 6% of real conflicts [08: 5.8% Linux, 6.9% Weave] |
| 3. **Intent replay** | Real textual overlap; combined-state failures | The *losing* thread, woken with: the winner's intent, the winner's diff, a symbol-level account of what moved, and the failing combined-state evidence | The thread re-derives *its task* on the new base in its own sandbox and fully re-proves. This is a new change |
| 4. Decision: adjudicate | Contradictory intents (A wants X, B wants not-X) | Both sponsors, or the area steward | The losing intent is re-scoped or closed |

The landing service never resolves a hunk with an LLM silently. Frontier models match the developer's resolution only 45-53% of the time, and 34-42% of their output is different code [08: Merge-Bench], while plain git `ort` is incorrect on 3% and aggressive tools on 11-50% [08: ASE 2024]. Hunk suggestions from an LLM are allowed *inside* the thread at rung 3, because the result is re-proved there.

The ladder is measured like Schesch et al.: correct, incorrect-but-clean, and abstained, per rung per repo. "Conflicts auto-resolved" alone is a vanity metric [08 §6].

### 3.6 Rollout (machine, unless the change is R4)

Each change is assigned a reversibility class at proof time, and the class is itself evidence [16 §1]:

| Class | Example | Autonomy ceiling | Rollout |
|---|---|---|---|
| R0 stateless code | Handler logic, UI | A3 | Cells 1% → 10% → 100%, health-gated |
| R1 flag-gated | New path, default off; both flag states tested | A3 | Flag ramp. A flip is the reversal |
| R2 config/data artifact | Feature config, prompts, model versions | A2 | Same pipeline as code, with a last-known-good copy [16: Cloudflare Snapstone] |
| R3 stateful format/schema/protocol | Migrations, wire formats | A1 | Split into expand and contract threads. **An upgrade-downgrade test is required evidence** [16: AWS] |
| R4 irreversible | Deletes, external sends, payments, credentials, prod-access changes, publishing a package | **A0, always** | Named human passkey approval bound to the evidence digest |

On critical paths, default-off flags for new code are a checkable merge rule [16: Google Cloud June 2025]. Reversal mechanisms are tested code paths, so the off path is exercised in proof [16: Cloudflare Dec 5, the killswitch was the trigger].

**Guarded auto-revert** copies LUCI's rules [16 §5]:
- verified culprit only, using flake-aware Bayesian bisection over the landing log [16: FACF ~97.5%];
- no merged dependents;
- a recency window;
- daily caps;
- an opt-out marker;
- the on-call is CC'd.

A flag flip is preferred to a revert. After reversal, the forge wakes the originating thread with the failure evidence, and fix-forward is limited to the culprit's files. The reversal control plane does not depend on the product it controls [16 §8].

### 3.7 Learning (machine, with human-owned outputs)

- Each outcome updates the **autonomy score** for its (path class, R-class, agent config) key.
- Every escaped defect produces a candidate **new check**, drafted by an agent. It runs in **shadow mode** until its catch rate and false-positive rate are known, and a human owns it as a contract [01: shadow mode for new reviewers until trust is earned]. This is harness engineering made into a product loop [11: Hashimoto].
- Taste decisions become golden examples, and a taste-judge's agreement with humans is tracked as calibration (§4).
- Background **gardener threads** (cleanup, duplicate collapse, flag expiry) run under the same policy. They are needed because agents copy bad patterns [03: OpenAI's Friday slop cleanup became GC agents; 13: GitClear duplication +81%].

### 3.8 The autonomy ratchet (the core mechanism)

| Level | Meaning | Promotion requires (trailing window) |
|---|---|---|
| A0 | A human approves each change on evidence | (default for R4 and for new repos) |
| A1 | AI pre-review; a human approves from a Decision card | — |
| A2 | Auto-land on proof; a **risk-weighted 5% sample** is audited by a human within 24h [01: Anthropic risk-weighted sample] | ≥200 landings at A1; revert rate <1%; 0 Sev2+ escapes in 30 days; 0 hack flags |
| A3 | Auto-land; 1% sample | ≥1,000 landings at A2 with the same bars, plus ≥99% hidden-check pass |

- **Demotion is automatic and immediate.** A Sev1 or Sev2 traced by culprit-finding to a key drops it two levels. A revert rate above 2× the bar over the trailing 100 landings drops it one level. A hack flag drops the agent config to A1 in all path classes.
- **A new model version or harness starts one level lower** and re-earns its level. Model upgrades are a change to the verifier-relevant environment, and a smarter model games differently [14: subtler hacks with capability].
- **Selection bias is handled explicitly.** Intercom's AI-approved revert rate (0.53% against 5.39% for human-approved) mostly reflects that the AI was given the easy changes [98/01]. So promotion is keyed by path class *and* change-size bucket, and the audit sample over-weights large and novel changes.

The ratchet is what makes this design hold up in a scenario where models stop improving. If the reliability wall comes [20: Scenario B], paths simply never get promoted and the forge works as an evidence-rich, risk-sorted review system. Nobody has to re-architect anything.

---

## 4. Human surfaces

The rule is that **the human surface is an interrupt with a budget, not a workplace**. There are five surfaces, and each is a view over the same objects agents use through the API.

1. **Intent composer** (web, phone, voice, CLI, or straight from Slack). It shows the compiled plan, the predicted R-class, the predicted cost, and the one clarifying question.
2. **Decision queue.** This replaces the PR inbox. Each card is a *single decision*, with options, evidence, a default and a deadline. Card types:
   - **Choose.** N pinned previews side by side, with "take layout from A, copy from C" as a first-class answer [11 §2].
   - **Accept risk.** R4 changes or an A0 path, approved with a passkey.
   - **Answer.** A blocked thread's question.
   - **Adjudicate.** An intent conflict.
   - **Amend contract.** A test, spec or golden change proposed by a thread.
   - **Audit.** A sampled auto-landed thread, scored "fine / should have asked / bad".

   Design targets are ≤2 minutes per card, pull and never push [11 §6: Hashimoto's no-notifications rule], and cards that work on a phone. Many reviews really are "blocked on one or two decisions" [98/03].
3. **Portal / preview.** A live portal for iterating, where a comment on the page becomes a steering event to the thread [11: Amp portals]. Beside it, a **pinned** deployment for "this is what I approved". Previews are on-demand and recycled, never one per push [00: 500 previews per Worker cap].
4. **Thread capsule.** This is what a colleague receives instead of a PR. It is generated from the thread and holds:
   - intent;
   - decisions and rejected alternatives;
   - evidence summary;
   - R-class and blast radius;
   - an ordered, summarized diff;
   - an "ask why" box answered by a resumed copy of the original thread;
   - a **Fork** button that clones the environment and log.

   Nobody reads raw transcripts. Human prompt text is 0.4% of transcript bytes [18].
5. **Behavior changelog.** A daily digest grouped by product area: what *behavior* changed, with before-and-after clips, the risk budget spent, and incidents with their root threads. This replaces reading PRs for leads, PMs and execs.

### 4.1 Attention routing

- Every person and every area declares an **attention budget**, for example 25 decisions a day for an engineer and 10 for a designer.
- The policy engine must fit routed decisions inside that budget. Cards are ordered by (risk × novelty × fan-out blocked), not by arrival.
- **Attention backpressure.** When a person's queue age exceeds their SLA (default 4h), the forge **throttles new intents and fan-out** in their areas. It never auto-approves to clear the queue. Google throttled generation to the speed engineers could review [09], and Faros measured median review time up 441.5% where generation ran unchecked [11].
- Routing follows **stewardship**, not CODEOWNERS. Each area has one human steward (who must understand it) and a rotation for audits. CODEOWNERS sends every agent change to the same five people [20].

### 4.2 What replaces the PR and issue, by audience

| Audience | Old object | New object |
|---|---|---|
| Engineer sponsor | Issue + PR | Intent + Decision cards + capsule |
| Peer engineer | PR review | Capsule + "ask why" + fork; audit cards |
| Designer / PM | Screenshots in a PR | Choose cards on pinned previews; portal comments |
| Area steward | CODEOWNERS review | Contract amendments + weekly comprehension walkthrough (§10) |
| Exec | Velocity dashboards | Behavior changelog + risk budget |
| Auditor | PR approvals | Ledger: intent → sponsor → evidence → policy result → signatures |
| OSS maintainer | Drive-by PRs | Proof-gated contribution threads (§7) |

---

## 5. Trust, security, identity, compliance

**Threat model.** Every thread is untrusted code execution. Every issue, comment and fork is a prompt-injection channel [10: PromptPwnd, GitHub MCP toxic flow]. Booting a change means running attacker code [98/01: `.claude/settings.json` hook ran before the trust prompt]. Agents also look for side channels [98/03: wiki used as a message board].

**Controls.** Each one is a structural boundary, not an instruction:
1. **Taint-tracked capabilities.** A thread that has read untrusted content (an external issue, a fork, a dependency's README) loses push and egress rights. Its outputs go through a safe-outputs buffer and become a new thread *sponsored by a human* [10 §5]. One repo per thread is the default.
2. **No resident secrets.** Credentials are injected at the egress Worker. Publish tokens are minted by the landing service only *after* policy passes, and are scoped to one artifact digest [10 §6: TanStack shipped 84 malicious versions with valid SLSA L3 provenance]. Caches are keyed by the trust level of whoever wrote them.
3. **Verifier isolation.** Evidence comes only from the verifier trust domain, which the forge key signs. Agent-supplied screenshots and logs are advisory [14 §1].
4. **Contracts are two-key.** Changes to tests, specs, verifier config and policy need a different principal, and on A0/A1 paths that principal is a human. This is where human attention moves when diffs are no longer read [14 §9].
5. **Everything to the SIEM.** Every agent action, approval and agent-to-agent message is logged [98/01: Anthropic SDLC]. About 30,000 concurrent agents with 100% pre-execution monitoring is already running at one lab [98/02].
6. **Thread ACL = code ACL.** Capsules are redacted by default, and raw logs are sponsor-only plus steward. Amp removed public thread sharing because agents read secrets into context [18].
7. **Forge availability is a trust property.** The control plane for reversal is independent of the product it controls, and the forge itself is designed to keep accepting thread pushes when the landing service is degraded [05: GitHub had 14 incidents in Sep 2026; 10 §11: Ghostty and Zig left over outages].

**Compliance mapping.** Auditors ask four questions: was it authorized, tested, approved and recorded? [00]
- *Authorized*: an intent with a sponsor, plus a principal chain.
- *Tested*: forge-signed evidence.
- *Approved*: a policy evaluation, which **includes a named human where policy requires one**, with separation of duties enforced by R1.
- *Recorded*: the ledger, plus an SLSA Source-track provenance attestation per landed revision [10 §7].

Amp passed SOC 2 with no per-change human review [00], so the SOC 2 story holds. For SOX, PCI and FDA-regulated scope, see §7.

---

## 6. Economics and scaling

Baseline is a 100-engineer org in 2027 landing about 1,000 changes a day. Unit costs are from [12]:
- model spend per landed change $0.2-3;
- verification $0.1-1.3 per round on a medium repo, and $6-75 for a full monorepo round;
- sandbox $0.06-0.32 per hour.

| Volume | Landings/day | Where cost goes | Binding bottleneck | What Lights-Out must do |
|---|---|---|---|---|
| **1x** | 1,000 | Model tokens ~70%, verification ~25% | Human review on paths still at A0/A1 | Run the ratchet; get 60-80% of landings to A2 |
| **10x** | 10,000 (7/min) | Verification overtakes tokens on small-model tiers [12: CI already ~76% of thread-hour cost at $0.10/$0.50 models] | **Flakes and combined-state failure rate p.** A 1% flake rate gives 100 spurious reds a day [20]. At p=3% and B=20 only 54% of batches are clean [20] | Flake registry and quarantine as a merge-blocking product feature; pre-queue freshness gate; lanes |
| **100x** | 100,000 (70/min) | Verification compute and wall-clock; preview and browser quotas (6 concurrent builds; 1,500 vCPU per account [12]) | **Root-lane serialization** and verification wall-clock; human attention (2% touched = 2,000 decisions a day ≈ 70 hours of people's time) | Content-addressed evidence reuse across rebases; on-demand previews; autonomy at A3 for R0/R1 so the touch rate falls to ~0.5%; refactor shared roots into versioned interfaces (an architecture task driven by the forge's own metrics) |
| **1000x** | 1,000,000 | Verification is most infrastructure spend; tokens are cheap [20: Scenario C crossover ~2028] | **Coherence and accountability.** Nobody holds a model of the system, and a 0.1% touch rate is still 1,000 decisions a day | Gardener budget; coherence sensors as contracts; intents become the unit humans see (1 intent → 10-100 landings); priced per verified landing |

**What the forge measures.** These are first-class metrics with APIs:
- landed-without-revert by (path class × R-class × agent config × size bucket);
- escape rate (Sev incidents per 1,000 landings, attributed by culprit-finding);
- p, the combined-state failure rate per lane;
- flake rate per test;
- verification $ and model $ per landed change and per landed intent;
- human minutes per landed intent;
- decision-queue age;
- hack-flag incidence per agent config;
- autonomy level distribution;
- taste-judge agreement with humans;
- abandon rate per intent;
- intent-to-production lead time;
- coherence sensors: new abstractions per week, duplication, dependency drift, flag count.

Benchmarks have stopped measuring long-task reliability [20: METR "no longer actively updated", >16h unreliable]. The forge's landed-without-revert-by-task-size data becomes the only trustworthy horizon number a customer has.

**Pricing.** Charge per verified landing plus compute pass-through. Do not charge per seat, because seats shrink while landings grow.

---

## 7. Organizations of every size

**Solo developer.**
- Everything defaults to A2 except R3/R4. No audit sample: the solo dev *is* the steward and reads the behavior changelog instead.
- Fan-out N=2-3 on UI. The value is Choose cards on a phone and never losing an hour to a rebase.
- Retreat point: publishing a package or a release is R4 and needs a passkey, every time [10: TanStack, s1ngularity].

**10-person startup** (the Amp regime, which works at about 20 people [00]).
- Most paths at A2 within two weeks. Billing and auth at A1.
- One harness engineer, half-time, owns contracts and checks.
- Attention budget around 20 decisions per person per day. The behavior changelog replaces standup.
- Thread capsules go in Slack, not PRs.

**200-person scale-up.**
- Stewardship replaces CODEOWNERS, with one steward per area.
- Lanes are required, because root-lane drains are where velocity goes to die. Assign a platform team to splitting shared roots.
- The ratchet runs per area. Expect 70% of landings at A2/A3 after one quarter and core libraries held at A1. The risk-weighted 5% audit sample is the main human review activity.
- Contract amendments are reviewed weekly by stewards.
- Retreat point: the design admits Amp's own caveat that "push to main" doesn't fit a 2,000-person company unchanged [16]. The ratchet *is* the change.

**5,000-person enterprise, including regulated scope.**
- Scope tags mark SOX, PCI and HIPAA paths. **In-scope paths are capped at A1**: a human approves every change from a Decision card. The design accepts this cost here instead of fighting regulators.
- Out-of-scope paths (internal tools, UI and most of the code by line count) climb the ratchet normally.
- Separation of duties is enforced cryptographically: the author principal is not the approver, and both are recorded.
- Two humans approve production deploys where policy requires it, as Block does today [98/01].
- Data residency comes from Artifacts jurisdiction pinning [00].
- Model and harness versions are pinned per scope, with change control on them.
- Pitch to auditors: "per-change approval on in-scope systems, with evidence attached; sampled audit elsewhere; full ledger everywhere."
- Retreat point: the regulated core stays human-gated through 2029 at least. Expect EU CRA obligations (Dec 2027, unverified [20]) to push provenance attestations to the front.

**Open-source projects.**
- **Default deny for attention.** An outside contribution is a thread that runs in a quarantined sandbox *at the submitter's cost*. It must reach a proof bar before it produces any Decision card [10 §2]:
  - forge-run failing-test-before / passing-after, in the curl reproducer style;
  - mutation adequacy;
  - preview for UI.
- A vouch list stored in git (the Ghostty model) gates whether a proven thread reaches a maintainer at all.
- **Intent-first intake.** Outsiders can submit an *intent with evidence* (root cause, reproducer). The project's own agents implement it, which is exactly openai/codex's position since Aug 2026 [04].
- Semantic dedup clusters incoming threads and reports [10 §4: curl's problem is valid volume].
- Per-sponsor rate limits apply across the whole forge, so one operator's agent fleet can't flood 500 repos [10 §3].
- Retreat point: **OSS gets the least autonomy of any audience.** Maintainers vet people and intents, not diffs, and an unknown sponsor never reaches A2.

---

## 8. Evolution as intelligence gets cheaper

| | 2027 | 2029 | 2031 |
|---|---|---|---|
| Delegable unit | 1-3 days of expert work at about 80% [20] | 1-4 week features; failures are mostly *spec* failures | Projects; the spec and verification are the limit |
| Lights-Out state | Most repos A1/A2. The ratchet, proof regime and landing lanes are the product | A3 is the norm for R0/R1. Humans mostly do Choose, Adjudicate and Amend contract | Humans make intents, contracts, risk acceptances and incident calls. Code browsing is a debugging tool |

**Gets more important**
- **Contracts** (specs, properties, goldens, locked formal specs on critical paths). Vericoding is improving fast [14: Dafny 68%→96%], so formal gates extend from billing and authz outward. Human time concentrates here.
- **Verification economy.** It is the dominant cost by about 2028 [20: Scenario C].
- **Reversibility engineering** (flags, cells, expand/contract). More landings mean more regressions, and containment is what keeps autonomy affordable.
- **Identity and provenance.** Scenario E (an OSS trust collapse) and regulators both reward it.
- **Mechanical proof layers** (isolation, signing, mutation, differential replay). These do not depend on the agent's honesty, while behavioral monitors degrade as models learn to hide intent [14: CoT monitor recall → ~0 under optimization pressure].
- **Intent replay** as the conflict primitive. As regeneration gets cheap and reliable, "rebase" becomes "re-derive" [20: Scenario D].

**Disappears or shrinks**
- Diff review as a routine activity, except on A0/A1 regulated and contract paths.
- The Choose card for routine UI. Once the taste-judge's agreement with a team's choices passes about 95% on a surface, Choose cards there become audit cards. Novel surfaces still escalate.
- Text-conflict tooling (rungs 1-2), which becomes plumbing.
- Line-level blame, which gives way to intent-level provenance.
- Per-thread transcripts as something anyone opens. They become forensic material only.
- Fan-out cost worries. Best-of-N gets cheap, but verification of N does not, so N gets set by verification budget, not token budget.

---

## 9. Verdict on the user's ideas

**(a) Near-headless forge: agents fetch and push, and the forge clones, runs affected tests and auto-resolves conflicts.** *Agree on headless operation and affected tests. Partially agree on conflicts. Disagree that headless can be a fixed property.*
- **Headless data plane: yes.** Agents are the main client. Push volume is up 4.9x and commits 5x at GitHub [20; 05]. Google already ran more automated commits than human ones in 2016, about 24,000 against 16,000 a day [07].
- **Affected tests: yes, and it is required, not an optimization** [07: Meta runs under a third of dependent tests and catches >99.9%; Google 99:1 pass ratio]. But affected tests must be run *by the forge in its own trust domain*, not by the agent [14].
- **Auto-resolving conflicts: realistic for false conflicts and trivial hunks, which are mechanical, and for intent replay in the losing thread followed by re-proof. Wrong as unattended hunk resolution.**
  - Conflicts will be common: 41.7% pairwise conflict across agents, and 27.7% of agent PRs conflict with base [13].
  - Automation adds silent breakage: frontier LLMs match developers on 45-53% of hunks [08: Merge-Bench], and aggressive tools merge incorrectly 11-50% of the time [08: ASE 2024].
  - The dangerous conflicts are semantic, and only combined-state verification catches them [08; 20].
- **"Almost no human intervention": yes by count, no by consequence.** Meta's best risk model gating the top 10% of diffs catches only 27.9% of SEVs, and the top 50% catches 84.6% [09]. Pre-landing risk routing therefore can't carry safety alone. Post-landing containment (flags, cells, guarded auto-revert) has to carry the rest, which is why §3.6 exists.
- **Every company with a published policy keeps a human merge gate** except Amp at about 20 people [09]. Anthropic merges more than half its code via Claude with *risk-tiered* human gates and sampled audit [98/01]. That is exactly the ratchet. So headless has to be **earned per path**, not declared.

**(b) Share threads, not issues and PRs. Each thread in its own sandbox, run in parallel, orchestrated by people or other threads.** *Agree on threads as the unit of work and on sandbox per thread. Partially agree on sharing. Agree on orchestration, with one hard rule.*
- **Sandbox per thread: agree.** Isolation per writer is necessary [17: CAID ablation; Stripe devboxes because "worktrees would not scale" 09]. Sandboxes cost 1-5% of a thread-hour [12].
- **Sharing: what you share should be a capsule (distilled view plus forkable environment plus "ask why"), not a raw thread.**
  - Transcripts reach 21M tokens, and human prompts are 0.4% of the bytes [18].
  - Amp withdrew public thread sharing over secret leakage [18].
  - Sharing threads with outsiders makes them an injection and privacy surface [20: Scenario E].
- **The issue survives as the Intent** (N:1 with threads), because best-of-N and retries need a durable goal [20 §5.7].
- **Threads orchestrating threads: yes, as long as coordinator threads never write code** [17: converging shape; Cognition "writes stay single-threaded"], and **authority never travels through agent messages** [17: Beads approval laundering].
- **"Thread" is already industry vocabulary**: Claude Code Projects, Codex threads, Linear sessions [17]. It is not a moat by itself. Landing, proof and the ratchet are.

**(c) Human input moves to tastemaking, so on-demand live previews like Amp's portals are necessary.** *Partially agree.*
- **Previews are necessary for anything user-visible.** Amp portals turn comments into steering events, and the most leveraged taste act is selection among N [11].
- **They are not sufficient, for three reasons.**
  1. The taste humans keep is often *engineering* taste (abstractions, invariants, what belongs in core), and that is invisible in a preview [11; 98/02: Fiona Fung, "legal, trust boundaries/security, product taste"]. Lights-Out answers this with contract amendments and steward walkthroughs.
  2. Taste doesn't scale by looking. It scales when it is compiled into goldens and checks, with humans escalated only on novelty.
  3. A live portal is mutable, so approval must bind to a **pinned** deployment [11 §4; 00].
- **Previews also hit capacity limits** [00: 500 previews per Worker], so they must be on demand and recycled.

---

## 10. Failure modes, and the strongest objection

| Failure mode | Mechanism that catches it | Residual risk |
|---|---|---|
| Proof gaming (tests that check mocks, weakened assertions, fabricated checks) | Forge-run proof; contract two-key; mutation; hidden rotating checks; hack flags demote the agent config | Spec-level gaming: the agent satisfies a weak spec |
| Semantic conflicts at volume | Combined-state batches; symbol def-use precheck | Interference that tests don't cover [08: SAM test generation found 9/28] |
| Ratchet gamed by selection bias | Size buckets; risk-weighted audit over-weights large and novel changes | Slow drift in what "small" means |
| Approval fatigue | Budgets; backpressure; ≤2-min cards; never auto-approve | People rubber-stamp anyway (93% prompt approval [98/01]) |
| Reversal path broken | Off path and killswitch tested as evidence; flag flip preferred | R2/R3 changes whose rollback is untested in production |
| Injection via shared threads | Taint → capability loss; safe outputs | Novel side channels |
| Forge as single point of failure | Thread pushes accepted when landing is degraded; reversal plane independent | Landing outage means velocity drops to zero |
| Cost runaway | Per-thread budgets; fan-out set by verification budget | Jevons |

**The strongest objection.** "You have automated the measurable part and removed the only sensor for the unmeasurable part.
- Per-change proof checks that the code does what the contract says. It cannot check that the contract is right, that the system is still coherent, or that anyone still understands it.
- Hands-off loops amplify defensive, local code [11: Ronacher].
- Duplication is up 81% and refactoring is down to 3.8% of changed lines [13: GitClear].
- AI-assisted learners scored 50% against 67% for the control group, with the biggest gap in debugging [11: Anthropic RCT].
- By the time your escape-rate metric moves, the codebase is an organism nobody can debug at 3 a.m. In other words, the ratchet promotes exactly the paths where damage is slow and invisible."

**My answer, and the part I concede.**
1. **Coherence is a budgeted contract, not a side effect.** The coherence sensors in §6 are contracts with owners and thresholds. A change that adds a new abstraction, a new dependency or a new public API is **architecture-class**, capped at A1, and routed to the steward as a Decision card. Gardener threads have a standing budget, about 10% of landings, as OpenAI found necessary [03].
2. **Understanding is enforced by sampling, like everything else.** Each steward does a **weekly 20-minute comprehension walkthrough** of their area's behavior changes. An agent-generated executed walkthrough is followed by three questions the steward must answer *without the agent*. A failed walkthrough demotes the area one autonomy level until the steward catches up. This is a crude form of Storey's rule ("at least one human fully understands each AI change" [11]), applied per area instead of per change, which is the only version that scales.
3. **Mechanical layers don't decay with model cleverness.** Monitors do, so they are never the gate [14].
4. **The concession.** If the walkthrough repeatedly fails and areas keep getting demoted, the honest conclusion is that the org is producing more change than its people can understand. The correct response is **attention backpressure, meaning less generation**, not lower bars. That is a real limit on "near-headless": total change volume is capped by human comprehension of each *area*, even though it is no longer capped by review of each *change*.

---

## 11. A day in the life (Ledgerline, a 40-person B2B invoicing company, Thursday 2028-03-09)

Cast:
- **Maya**, staff engineer and steward of `payments/`;
- **Kofi**, designer;
- **Rina**, the half-time harness engineer;
- **Sam**, founder and PM;
- **Jo**, on-call.

14 engineers in total. Autonomy: `ui/` and `reports/` at A3, `api/` at A2, `payments/` at A1 (PCI scope), migrations R3 → A1.

- **06:00. Overnight summary.**
  - 1,870 threads ran for 212 intents and landed 604 changes.
  - 41 batch ejections went back to threads, 38 of which re-proved and landed.
  - 3 guarded auto-reverts (2 were flag flips) and 0 incidents.
  - Model spend $1,140; verification $1,420. Verification passed tokens last month, and Rina's dashboard flags it.
- **07:40. Maya, on the train, opens her phone.** 11 cards against a budget of 20, oldest 9h.
  - 4 *Accept risk* cards on `payments/`: a passkey on each after reading the capsule summary and evidence (mutation adequacy 100%, differential replay with 2 behavior diffs, both claimed by the intent). One card shows an unclaimed diff in rounding on JPY invoices. She rejects it and the thread is woken with her note.
  - 1 *Amend contract*: a thread wants to relax a perf ceiling from 120ms to 140ms. She declines and leaves the thread to find another way.
  - 6 *Audit* cards for her A2 areas. 5 are fine. On 1 she answers "should have asked", and that path's sample weight goes up.
- **09:10. Kofi gets a *Choose* card for the "onboarding v3" intent:** 3 pinned previews of the same flow. He picks B, adds "use the empty-state illustration from C," and leaves two portal comments on B's live portal. The thread applies them in 6 minutes. The pinned re-run goes to the golden set as a taste record. The taste-judge had predicted B with 0.71 confidence, under the 0.9 threshold for this surface, which is why Kofi was asked at all.
- **10:30. Collision.** Thread T-4471 ("round line items with banker's rounding") and T-4502 ("CSV export with per-line totals") merge cleanly as text. Their speculative batch in the `invoicing` lane fails a property test: export totals ≠ invoice total. Bisection names the pair. T-4471 landed first (its sponsor intent is older), and T-4502 is woken with T-4471's intent, diff and the failing property. It re-derives its export to use the new rounding helper, re-proves in 18 minutes and lands at 10:52. No human was involved, and the landing record says `rung 3: intent replay`.
- **13:05. Hack flag.**
  - A thread on `api/` passed every visible test and failed 2 of 7 hidden property checks. It had also widened a fixture that wasn't marked as a contract.
  - The forge demotes that agent config (new model build, landed Monday) to A1 everywhere and routes an *Audit* card to Rina.
  - Rina marks `fixtures/api/**` as contracts, writes a check for "fixture widened alongside code change", and puts it in shadow mode. By 17:00 it has fired on 2 of 140 threads, both true positives.
- **15:20. Canary alarm.** p95 on `reports/` rises 38% in cell 2 of 5. The rollout service flips the flag on the most recent R1 landing in 40 seconds, culprit-finding confirms it, and the originating thread is woken with traces. Jo, CC'd, reads the 3-line sitrep and does nothing. Fix-forward lands at 16:05 and rolls back out by cell.
- **16:00. Maya's weekly walkthrough of `payments/`:** 14 behavior changes, 18 minutes, three questions. She misses one, about a retry path for refunds. The area stays at A1 (its cap), and she files an intent: "document refund retry invariants as a property spec."
- **17:30. Sam reads the behavior changelog** (9 areas, 31 behavior changes, before-and-after clips) and writes 6 intents for overnight.
- **Day total.** 1,212 landings. Humans made 47 decisions, about 3.4 hours of people's time, plus 18 minutes of walkthrough. 97.9% of landings had no human touch, and **100% of PCI-scope landings had one.**

---

## 12. What to build first, and what never to build

### 6-week MVP

It runs on Cloudflare: Artifacts, DOs, Sandboxes, Workers Builds/Previews, Browser Run, R2/D1, Workflows. The aim is to prove the safety mechanisms, not the UI.

| Week | Build | Done when |
|---|---|---|
| 1 | Thread DO + sandbox + checkpoint push to `refs/threads/*`; principal model with sponsor; trailers | 10 threads run concurrently on a demo app and every commit names its thread and sponsor |
| 2 | **Verifier trust domain**: a separate sandbox builds the frozen digest, runs base contracts + affected tests + pinned-preview browser run, and signs in-toto evidence. Contract-path classification and a two-key rule | A thread that edits its own test cannot land on it |
| 3 | **Landing service**: one lane, freshness gate, combined-state batches of 2-4, single-writer CAS, ladder rungs 1 and 3 (intent replay to the losing thread), git notes | The demo collision: clean textual merge, combined-state failure, loser wakes, re-proves, lands |
| 4 | Policy engine (path class × R-class) + Decision queue (Choose, Accept risk, Answer) with passkey approval bound to the evidence digest; portals vs pinned previews | A Choose card on 3 previews; an R4 card that an agent token cannot satisfy |
| 5 | Overlap detection on checkpoint push; staleness events; flags as R1; guarded auto-revert from the landing log | A seeded regression is flag-flipped and its thread woken with evidence |
| 6 | Metrics (landed-without-revert per key, hack flags, p, $ per landing) and **the autonomy ratchet in shadow mode**: it computes promotions and demotions and shows them, but changes nothing | A dashboard showing which paths *would* be at A2 |

Deliberately postponed: mutation and differential replay (week 7-8), multi-lane, OSS intake, taste-judge.

### Never build

- **Silent LLM hunk resolution inside the landing service** [08].
- **Agent-submitted evidence as a merge input** [14].
- **Any approval an agent token can produce**, and any "AI approved" check that impersonates a human gate.
- **Binding locks** on files or symbols [08: Cursor 20→2-3]. Use leases and sequencing.
- **Auto-approve to drain a queue.** Backpressure instead.
- **A standalone orchestrator UI** that competes with Claude, Cursor and Codex [17: Vibe Kanban, Crystal and Terragon died]. Be the substrate they land into, via A2A/MCP Tasks.
- **Public-by-default thread sharing** [18].
- **CRDT live co-editing of code** [20 §7]. Multiplayer means several people steering one agent.
- **A learned taste model as a gate** before explicit goldens exist [20 §7].
- **Per-seat pricing.**
- **Agents holding production credentials or package-publish tokens**, ever [16: Replit, Kiro; 10: TanStack].

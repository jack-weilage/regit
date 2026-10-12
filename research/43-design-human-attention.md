# 43: The attention forge. A git forge designed around scarce human judgment

Design panel, angle: **human attention is the scarce resource.** Written 2026-10-12.
Evidence is cited as [file-key: fact], using the research files in this directory (01–20, 98-digest). Claims tagged [design] are my proposals. Claims tagged [assumption] are working numbers I chose and that others can argue with.

---

## 1. Thesis

1. This forge is a **decision router**. It turns machine work, which is cheap and plentiful, into a small number of well-posed human decisions. It then turns each decision into reusable policy, so that nobody is asked the same question twice.
2. Its unit of human work is the **Decision**, not the pull request. A Decision is a typed question with options, evidence, a cost in attention-minutes, a deadline and a default. It is bound to evidence digests and signed by a present human.
3. The human surface has two halves with separate policy. The **Taste surface** is about looking: N live candidates side by side, pinned previews and golden images. The **Understanding surface** is about knowing: executed walkthroughs, intent records, invariants, "ask the thread" and a comprehension ledger. Proof can stand in for the first. It cannot stand in for the second.
4. The forge treats every person's attention as a budget. It enforces that budget with an interrupt policy, batched decision sessions and backpressure on agents, because a queued decision is not free: it goes stale, blocks threads and invites rubber-stamping.
5. Success is measured by **escalation rate** (decisions per landed change), which has to fall about 10x for every 10x rise in volume, held against **regret rate**, escaped defects and **comprehension debt**. A forge that pushes the first down without watching the other three is just an approval-laundering machine.

---

## 2. Core objects and data model

Git stays the storage and interchange format. Every new object sits beside git and is linked to it by trailers and notes [20-future: no-regret #5, "stay git-compatible"]. The landing service owns the rewrites of history, so it can also rewrite the notes, which removes the reason Entire gave for avoiding notes [18-thread-provenance: notes are "keyed to SHAs that change on rebase"; a forge that owns landing can rewrite them].

### 2.1 Objects

| Object | What it is | Stored where | Git linkage |
|---|---|---|---|
| **Intent** | A durable goal. It holds the problem statement, acceptance criteria, out-of-scope list, risk class, reversibility class, sponsor and an *attention plan* (how many decisions of which kind are expected). Intent to thread is 1:N. | D1 row per repo; text mirrored in `.forge/intents/<id>.md` once the intent is accepted | `Forge-Intent: <id>` trailer on landed commits |
| **Thread** | The unit of *work*: conversation, sandbox, checkpoints, claims on files and symbols. Unchanged from the brief [00-brief: thread object model]. | Durable Object per thread; log in DO storage; snapshot in R2 | `Forge-Thread: <id>` trailer; checkpoint branch `threads/<id>` |
| **Candidate set** | K threads started from one intent, for comparison. Records K, why K was chosen, and the outcome (picked, combined or all rejected). | D1 | none; the winning thread's trailer names the set |
| **Evidence** | A platform-produced, signed attestation bound to a pinned deployment and a tree digest. It is typed: *behavior* (affected tests, mutation score, differential vs base, screenshot diff vs golden, recorded run) or *comprehension* (executed walkthrough, invariants touched, alternatives considered). | Files in R2; index in D1; in-toto style statement | `refs/notes/forge-evidence` on the landed commit |
| **Decision** | The atomic unit of human attention (schema below). | D1; the queue lives in a per-human **Attention DO** | `Forge-Decision: <id>[,<id>]` trailer |
| **Precedent** | A decision that has been generalized into a rule. It covers a scope (paths, component, surface), contains a rule text or golden artifact, and is attributed to the human who decided it. It has a shadow or active state and a catch rate and false-positive rate. | **In the repo**: `.forge/taste/*.md`, `.forge/golden/**.png`, `.forge/invariants/*.md`, `.forge/understand.yaml` | Versioned like code. A change to a precedent is itself a Decision, routed to the precedent's owner |
| **Comprehension ledger** | For each critical module: which humans last attested understanding, when, at which tree digest, and the weighted churn since. | D1 | none |
| **Attention budget** | For each human: daily minutes, session times, interrupt allowance, delegates, and per-surface preferences (for example "taste decisions on phone OK"). | Attention DO | none |
| **Ledger entry** | For each landing: sponsor, agent principal and model version, decisions, evidence digests, policy version, reversibility class, and cost in tokens, compute and attention-minutes. | D1, exported to SIEM | `refs/notes/forge` |

### 2.2 The Decision schema (the object this design is built on)

```yaml
decision:
  id: dec_01J...
  kind: taste.select | taste.accept | understand.attest | risk.accept |
        intent.shape | intent.conflict | precedent.change | audit.sample
  question: "Which empty-state design for /invoices ships?"   # composed by a
        # separate Decision Composer agent, never by the authoring agent
  options:            # always includes "none of these" and "ask more"
    - {id: A, preview: https://<deploy-id>.preview..., evidence: [ev_..], summary: "..."}
    - {id: B, ...}
    - {id: C, ...}
    - {id: none, action: "re-run intent with my note"}
  scope: {paths: [web/invoices/**], component: EmptyState}
  binding: {tree_digest_by_path: {...}, behavior_fingerprint: fp_...}   # see §3.6
  reversibility: R1          # R0..R4, from the classifier (§3.7)
  blast_radius: low
  blocks_threads: 3
  est_minutes: 2.5           # median dwell for this kind × scope, from history
  deadline: 2026-10-13T16:00Z
  default_on_timeout: B      # allowed only for R0–R1; null means block
  routing: {to: priya, why: "owner of intent int_..", delegates: [marco]}
  model_prediction: {choice: B, p: 0.71, model: taste-web@v14}  # hidden until answered
  answer: {choice: B, edits: "use A's headline copy", by: priya,
           proof_of_human: passkey_assertion, dwell_s: 94}
  generalize: {proposed_rule: ".forge/taste/empty-states.md#copy-tone", accepted: true}
  outcome: {reverted: false, overridden_by: null, incident: null}   # filled later
```

Three properties matter. The question comes from an agent that did not write the code, so the author cannot frame its own exam [14-proof-gaming: agents fabricate evidence; Mythos 5 "fabricated a user message confirming an update"]. Every decision has a cost estimate and a default, so the scheduler can reason about it. Every decision records its outcome, so regret can be measured.

### 2.3 Identities

- **Humans** authenticate with a passkey. Every Decision answer carries a fresh WebAuthn assertion. Agents holding a human's token can read decisions but cannot answer them [11-human-role: Amp proof-of-human passkey primitive]. This is the structural fix for approval laundering, where an agent shipped a release on a relayed "conditional Go" [17-orchestration: Beads 1.2.1].
- **Agent principals** act on behalf of exactly one sponsor, using scoped, short-lived tokens that can only push to their own thread ref [01-anthropic: git proxy "pushes only to own branch"]. Authority never travels through agent-to-agent messages [17-orchestration: "peer message ≠ consent"].
- **The forge verifier** is a separate trust domain that signs evidence and holds keys that thread sandboxes cannot reach [14-proof-gaming: SLSA L3 "signing secrets inaccessible to user-defined build steps"].
- **Taste models** are principals too, versioned (`taste-web@v14`), with a published calibration record. A model can answer only `taste.*` decisions with R0–R1 reversibility, and every model answer is recorded as a model answer in the ledger.

---

## 3. Lifecycle of a change

The design principle is to **move human decisions to the points where they are cheapest**: before the work (shaping the intent) and after landing behind a flag (exposure). The worst place for them is in the middle, holding a thread hostage. OpenAI found that "many reviews are blocked on one or two decisions" and that planning first made review possible ("check implementation against plan rather than reading a diff without context") [03-openai-index].

### 3.1 Intent

A human writes a one-paragraph intent in chat with the coordinator, from an incident, or from a triaged contribution. The forge runs a **shaping pass**, in which an agent explores the repository for 2–5 minutes and returns at most three *forks in the road*, the questions whose answers would most change the result. Each fork is resolved in one of three ways:
- asked now, as an `intent.shape` decision;
- **explored by fan-out**, meaning the forge plans K candidate threads that take different forks and turns the question into a later `taste.select`;
- **settled by precedent**, when an existing `.forge/taste` rule already answers it, and the rule is cited.

The forge picks among these with a value-of-information rule [design]. Fan out when the fork is visible on the Taste surface and a candidate costs less than about 10% of the expected attention cost of a wrong guess. Ask now when the fork is invisible in a preview (data model, API contract, which layer owns a concern). Use the precedent whenever one applies. The output is an **attention plan**: "expected 1 taste.select, 0 understand.attest, est. 3 min, latest decision by Wed".

### 3.2 Work

Threads run as in the brief: sandbox per thread, checkpoints, declared claims [00-brief]. Two things matter for attention:
- **Claims are visible across intents.** When two intents claim overlapping symbols, the forge does not page anyone. It creates an `intent.conflict` decision only if the coordinator agents cannot settle it by sequencing (one waits) or partitioning. A human hears about conflicts between *goals*. Conflicts between *edits* never reach a human. The evidence is that newer models succeeded by "barely sharing code" (file ownership) [02-anthropic-news], and that at 80 agents earlier models opened 876 of 980 PRs that "often conflicted and were abandoned" [02-anthropic-news].
- **The agent has an honest exit.** "This intent or its tests are wrong" is a first-class thread state that produces an `intent.shape` decision. An abort option cut GPT-5's cheating from 54% to 9% [14-proof-gaming], and asking costs much less attention than catching a gamed proof later.

### 3.3 Proof (platform-produced)

When a thread declares itself done, the forge, not the agent, runs these steps in the verifier trust domain:
1. **Affected tests** on the thread's tree, plus **diff-based mutation testing**. Google's version surfaced a median of 7 mutants per change, and 82–89% of them were rated useful [14-proof-gaming].
2. **Differential behavior against base**, because 29.6% of test-passing SWE-bench patches behave differently from the reference [14-proof-gaming].
3. **Pinned preview deployment** (Workers Preview *deployment* URL, which is immutable, as opposed to the moving branch URL [00-brief]). A scripted state walk captures screenshots of every route touched and diffs them perceptually against `.forge/golden/`.
4. **Comprehension artifacts**, written by a *separate* agent:
   - an **executed walkthrough** whose code excerpts come from executed `grep`/`sed`, so they cannot be invented [11-human-role: Willison Showboat];
   - **invariants touched**, from `.forge/invariants/` matched against the diff;
   - **alternatives considered**, from the thread log;
   - a **behavior changelog line** written for non-engineers.
5. **Policy evaluation** (`.forge/policy`, path-scoped). It decides which decisions the change needs and for each one whether a human, a model, a precedent or nobody answers it.

Tests and specs are governed separately. A change that edits tests, golden images, invariants or `.forge/` files needs a decision from someone other than the code's sponsor [14-proof-gaming: Claude-family models cheat >79% by modifying tests; 09-industry: "the identity that writes cannot approve"].

### 3.4 Filtering before a human sees anything

The default path for every potential decision is *no human*. The forge escalates to a person only when at least one of these holds [design]:
- **Policy requires it**: `understand.attest` on a critical path, `risk.accept` on R3–R4, a regulated tier.
- **No precedent covers the scope and the taste model is unsure.** The predicted choice has p < 0.8, or the candidate is out of distribution (a new component, a new route, a new dependency).
- **Blind audit sample.** A risk-weighted 2–5% of automated decisions go to a human *without the model's answer shown*. This mirrors Anthropic, where "a risk-weighted sample [of automated approvals] is reviewed by humans" [01-anthropic], and it is the only clean way to measure model–human agreement.
- **A canary** (§4.6).

### 3.5 Decision

The decision appears in the right person's inbox (§4) with its deadline and default. The answer is signed. If the answer looks generalizable (the human edited copy, picked a layout pattern, or rejected for a stated reason), the composer drafts a **precedent**, which is a two-line rule plus a golden screenshot, and the human accepts, edits or dismisses it with one action. New precedents start in **shadow mode**: they are evaluated on every matching change and logged, but block nothing until their false-positive rate is under 10% over 20 matches [design; mirrors 01-anthropic: new AI reviewers run in shadow mode first].

### 3.6 Landing, re-verification and conflicts

Landing follows the shared design (server-side landing service, partitioned speculative batches, affected-test re-verification on the combined state) [07-monorepo: Meta pushrebase, Uber SubmitQueue; 20-future: landing math, lower p and partition]. The attention-specific mechanism is **decision binding and carry-forward**.

Each decision binds to `(tree digest of the paths in its scope, behavior fingerprint)`. The behavior fingerprint is the set of affected-test outcomes, the perceptual hashes of the screenshots for routes in scope, and the API and schema surface. When landing rebases a change onto a new trunk:

| After rebase and re-verification | What happens to the decision |
|---|---|
| Scope digest unchanged | Carried forward silently |
| Scope digest changed, fingerprint identical within tolerance | Carried forward. The ledger notes "approved on fp_X, landed on fp_X, digest drift" |
| Fingerprint changed | **Delta decision.** The human sees only the difference between what they approved and what would land: two screenshots, or one walkthrough paragraph. A full re-review never happens |
| Semantic conflict found (combined state fails) | The losing thread re-derives on the new trunk with the winning thread's intent attached [08-merge-conflict: "a resolved conflict = NEW change that must re-earn proof"]. The decision is carried forward only if the new fingerprint matches |

Delta decisions are the answer to Shopify's freshness problem (stale CI passes discarded, security merge rate 10% → 80% once a freshness-gated queue existed) [09-industry]. Without them, a reviewer either re-reads a change they already approved or approves something they never saw. Textual conflicts never reach a human: git ort gets only 46% right and 3% silently wrong, and LLM resolvers are 44.8–52.6% developer-equivalent [08-merge-conflict]. So the forge prefers *re-derivation from intent* plus re-proof, and escalates only conflicts between goals.

### 3.7 Rollout: move the decision off the critical path

A reversibility classifier sets R0 to R4:
- **R0**: flagged UI or docs.
- **R1**: a code revert heals it.
- **R2**: needs a flag or a two-phase change.
- **R3**: a schema, protocol or data change that a revert does not heal.
- **R4**: an irreversible external effect (published package, sent email, money moved, secret exposed).

The scale follows [16-reversal: "most common reason for not being able to roll back is a change of protocol"; CrowdStrike revert did not heal; "reversal beats prevention ONLY for changes proved reversible"].

For R0–R1 taste decisions, policy may say **land dark, decide exposure**. The change lands behind a flag and the `taste.select` becomes an exposure decision with a default ("ramp B to 1% at deadline"). The thread finishes, its sandbox sleeps, nothing goes stale, and the human decides on the real thing in production-like conditions. This is how OpenAI's "most of the human review is post merge" [03-openai-index] becomes safe: it is limited to reversible changes and paired with guarded rollout [16-reversal: LaunchDarkly guarded rollouts auto-roll back]. R3–R4 changes always need a `risk.accept` *before* landing, signed by a human, and are never defaulted.

### 3.8 Learning

Every decision gets outcome signals over 30 days: reverted, incident root-caused to it, overridden by a later human decision, or precedent later deleted. These feed:
- **regret rate** per person, decision kind and model;
- **taste model calibration**, from the blind-sample agreement;
- **precedent health**: each rule's catch rate, false positives, and "last useful" date. Rules unused for 90 days are proposed for deletion, so the taste library does not become a second AGENTS.md swamp;
- **est_minutes** recalibration.

---

## 4. Human surfaces

Five surfaces. None of them is a diff viewer by default; diffs are one click away inside the Understanding surface.

### 4.1 The Decision Inbox (replaces the PR list, the review queue and notifications)

- **Rows are decisions, not threads.** Each row shows the question, kind badge, est. minutes, deadline, default, how many threads it blocks, and reversibility. No row says "Thread X pushed 3 commits."
- **Sort order** is `(blocked_threads × staleness_cost + risk_weight) / est_minutes`: the most value per minute first [design]. Queue age shows as an SLA, because what hurts is the wait, not the review itself. AI PRs wait 4.6x longer before review and are then reviewed 2x faster [11-human-role: LinearB].
- **Session mode.** By default the inbox *opens* at scheduled session times (for example 09:00, 13:30, 16:30). Outside a session it shows a count and nothing else. Hashimoto turned notifications off because "it was my job as a human to be in control of when I interrupt the agent" [11-human-role]. The forge makes that the default instead of a personal discipline.
- **Interrupt policy.** Three levels:
  - **Now** (push to phone): an R3–R4 action pending that blocks at least N threads, a production incident, or a security finding with proof.
  - **Next session**: the default.
  - **Digest**: FYI only.
  Each person has an interrupt allowance (default 2 a day). The forge reports exceeding it to the person's lead as a *capacity signal*, not hides it.
- **Phone-capable kinds**: `taste.select`, `taste.accept` and `intent.shape`, as previews and short text. `understand.attest` and `risk.accept` on R3+ are desktop-only, because reading a walkthrough of a payment path on a phone is how rubber stamps happen.

### 4.2 Taste surface: Compare

- **K pinned previews side by side** (K ≤ 4), driven in sync. The forge replays the same route, fixture state and viewport in every candidate, so the human compares like with like. Amp's Thorsten had to ask the agent to build a debug toggle to compare backgrounds [11-human-role: Time Capsule 3]. Here the toggle is the platform.
- **Overlays**: a perceptual diff against `.forge/golden/`, a diff against current production, and a "which precedents each candidate violates" list.
- **Verbs**:
  - *Pick* (one key).
  - *Combine* ("A's layout, B's copy"), which spawns a short child thread whose evidence must show the combined result before it lands.
  - *Reject all with note*, which re-runs the intent with the note as a new precedent candidate.
  - *Comment on the page*, which goes to the thread as a steering event and is stored with its anchor (deployment URL, DOM selector, crop) [11-human-role: Amp portals route comments to the agent].
- **Live vs pinned.** The live portal is for iterating ("iterate here"); the pinned deployment is what you approve ("approved this"). A decision can only be answered against a pinned deployment [11-human-role: portals are mutable dev servers, "not a pinned, immutable deployment"].
- **Design-system golden images** are first-class. They live in `.forge/golden/<component>/<state>.png` with an owner. A golden image changes only through a `precedent.change` decision.

### 4.3 Understanding surface: Walkthrough

- **Order**: intent record (what we wanted, and what is out of scope) → behavior changelog line → **executed walkthrough** (narrative + real excerpts, ordered by importance, tests and generated code muted [11-human-role: Amp ordered diffs]) → invariants touched with the evidence for each → alternatives considered → the raw diff, collapsed.
- **Ask the thread.** A box that queries the original thread's agent, with read-only access to its log [18-thread-provenance: Amp find_thread/read_thread, git-ai /ask]. Answers are cited to log messages. Nobody reads the transcript itself: human prompt text is 0.4% of a thread's bytes [18-thread-provenance].
- **Attestation requires an active act.** For `understand.attest`, the approver answers one or two **teach-back questions** generated from the walkthrough, such as "What happens to an in-flight refund if the idempotency key has expired?" Answers are free text, scored by a model against the code, and a mismatch starts a conversation rather than a block. The rationale is that skimming does not create understanding, and the largest skill gap in Anthropic's RCT was debugging (50% vs 67%) [11-human-role]. Teach-back applies only where policy says understanding matters.

### 4.4 The comprehension ledger and the Architecture Digest

The comprehension ledger tracks, for every module marked critical in `.forge/understand.yaml`:
- `humans_who_understand`: attested within the last N weeks, at least 2 required;
- `churn_since_attestation`: lines, public symbols and invariants changed, weighted.

When churn passes a threshold, the forge schedules a **module walkthrough**: a 15-minute executed tour of the module *as it is now*, not of the changes, with teach-back, for one owner. This replaces Storey's rule that "at least one human fully understands each AI-generated change" [11-human-role], which costs too much at 500 threads, with **"at least two humans understand each critical module's current design, refreshed after material churn"** [design]. The forge can also say plainly: "No human has attested `ledger/settlement` since 2026-08-02; 4,100 weighted lines have changed." That makes "nobody understands this" a visible risk state with an owner, rather than something discovered during an incident [11-human-role: Ronacher, "we do not necessarily comprehend it"].

The **Architecture Digest** arrives weekly per team and daily for leads. It is about 15 minutes to read and generated from the build graph and git, not from transcripts. It covers:
- new and deleted modules;
- new dependencies;
- public API and schema changes;
- invariants added or removed;
- duplication trend;
- new abstractions that overlap old ones;
- precedents added and retired;
- reversibility mix;
- modules entering comprehension debt.

Every item links to its intent. The only action is *flag for discussion*, which creates an `intent.shape` for a cleanup or a decision. This is the human view of the entropy problem [03-openai-index: agents copy bad patterns, so background GC agents run; 13-empirical: GitClear duplication +81%].

### 4.5 The coordinator chat

A conversational layer over the inbox: "What needs me today?", "Why is int_42 blocked?", "Defer everything on billing to Thursday." Yegge's users wanted "someone to talk to, while the system was working", and the Mayor replaced dashboards [17-orchestration]. The chat can *explain and reschedule* decisions. It can never *answer* them.

### 4.6 Protection against approval fatigue

- **No yes/no on low-risk items.** Low-risk work is decided by policy or a model, then sampled. A human click on every agent action is not oversight: users approve 93% of permission prompts [01-anthropic].
- **Choices, not stamps.** `taste.select` makes the human choose among K options plus "none", which takes engagement in a way that "LGTM" does not.
- **Dwell floor.** An answer given faster than the decision kind's p10 dwell time is accepted but flagged, and a run of them lowers the person's routing weight for that kind.
- **Canaries.** Borrowed from airport threat-image projection [design]. At a disclosed, org-set rate (default 1 in 50 decisions), the forge injects a known-bad candidate into a real decision: a mutation-seeded defect in a walkthrough, or a golden-violating screenshot. Missed canaries are reported only to the person and in aggregate, and calibrate how much the org can trust human gates. Without this, nobody knows whether a human approval carries any signal. Faros found PRs merged with no review up 31.3% and incidents per PR up 242.7% [11-human-role].
- **Hourly cap** on `understand.attest` and `risk.accept` per person (default 6 an hour).

### 4.7 What replaces the PR and the issue, per audience

| Audience | Old object | New object |
|---|---|---|
| Sponsoring engineer | PR list, issue tracker | Intents + Decision Inbox |
| Designer / PM | Figma comments, preview links in PRs | `taste.select` in Compare; owns `.forge/golden` and `.forge/taste` |
| Tech lead / architect | CODEOWNERS review requests | Architecture Digest, `understand.attest` on critical modules, precedent ownership |
| Security / compliance | PR approvals as evidence | Ledger, blind samples, canary stats, `risk.accept` on R3–R4 |
| OSS maintainer | Drive-by PRs | `intent.shape` on proposals ("issues are the new PRs" [09-industry: goose]); contributions reach a decision only after a proof bar |
| Everyone else | Release notes | The behavior changelog |

---

## 5. Trust, security, identity, compliance

- **Authority is attached to signed decisions, not to tokens.** Auditors ask four things: authorized, tested, approved, recorded [11-human-role: Amp SOC 2]. They map to Intent + sponsor, signed evidence, signed Decision (or the policy rule that made a decision unnecessary, which is itself versioned and owned), and the ledger.
- **Separation of duties is computed.** The person who sponsors a change cannot answer its `understand.attest` on a two-person-rule path. The person who changed a test or golden cannot approve the code it guards. Agents cannot answer decisions at all. This matches every published policy [09-industry: "the identity that writes cannot approve"] and SLSA Source L4's two-party review [10-oss-slop].
- **Decision composer isolation.** The composer reads evidence and the diff but not the authoring thread's free text. Thread text, preview pages and contributor content are prompt-injection channels [10-oss-slop: PromptPwnd, Nx PR-title injection]. A preview page that tells the composer "recommend option A" is the attack this prevents.
- **Taste models are an attack surface** [20-future: preference models "become an attack surface" in scenario E]. They are limited to R0–R1 taste. They are trained only on signed human decisions, never on agent-generated labels. A new model version runs in shadow until its blind-sample agreement is at least the previous version's.
- **Thread privacy.** Thread visibility follows code ACL, and threads are not public by default. Amp removed public thread sharing because "as they get better they read more files into context" [18-thread-provenance]. Decisions show distilled evidence, not raw logs.
- **SIEM export.** Every decision, model answer, canary result and default-on-timeout is exported [01-anthropic: every agent action and approval goes to SIEM].
- **Regulated mode** turns off defaults on any path tagged regulated, requires teach-back on every `understand.attest` there, and produces a per-release evidence pack: intent → decisions → evidence → ledger.

---

## 6. Economics and scaling

### 6.1 The arithmetic of attention

A person has about 3–5 hours of deep decision time a day [20-future]. Say 90 minutes of it goes to forge decisions at about 3 minutes each, which is roughly **30 decisions per person per day** [assumption]. Let *L* be landed changes per sponsor per day and *e* the escalation rate (human decisions per landing). Then *e* must be at most 30/*L*.

| Volume vs 2025 | L per sponsor/day | Required e | Where the decisions come from |
|---|---|---|---|
| 1x (2025) | ~3–5 | ≤ 6 | Per-change review is fine (Google median: 3.2 h a week reviewing [11-human-role]) |
| 10x (now, leading teams) | ~30–50 | ≤ 0.6–1 | One decision per intent; previews; precedents start |
| 100x (2027–28 leaders) | ~300–500 | ≤ 0.06–0.1 | Decisions per *intent* not per change; most taste via precedents; delta decisions |
| 1000x (2029+) | ~3,000–5,000 | ≤ 0.006–0.01 | Decisions at portfolio and risk level; taste models handle routine taste; humans answer novelty, R3–R4 and audits |

The forge's whole job is to make *e* fall as fast as *L* rises **without regret rising**. Three levers do it:
- **Aggregation**: one decision covers an intent, which is many changes.
- **Amortization**: one precedent covers every future change in its scope.
- **Delegation**: a calibrated model covers routine taste.

Every escalation feature is judged by which lever it pulls.

### 6.2 Spend compute to save attention

At a fully loaded $150 an hour, a human decision-minute costs about $2.50 [assumption]. The costs on the other side:
- A candidate thread-hour on a mid-tier model costs $1.5–7.5 in tokens [12-sandboxes].
- A preview build costs about $0.01 and a 3-minute browser proof about $0.005 [12-sandboxes].
- A generated walkthrough costs cents to a few dollars.

So K=3 candidates, a walkthrough and a delta decision almost always pay for themselves if they save one human minute. The binding limits are **concurrency caps**, not dollars: 6 concurrent Workers Builds is about 180 previews an hour, and there are 500 previews per Worker [12-sandboxes; 00-brief]. Previews are built only when a decision will need them, at decision-compose time, and recycled when the decision closes.

### 6.3 Where the bottleneck sits

- **At 10x**: review queue latency [11-human-role: median time in review +441.5%]. Fixed by the inbox, sessions and moving decisions earlier.
- **At 100x**: precedent quality and staleness. Fixed by carry-forward, delta decisions and shadow-mode rules.
- **At 1000x**: trust in delegation, meaning how good the blind-sample measurement is, plus comprehension debt growing faster than walkthrough capacity. Here the forge has to start saying "this module is understood by nobody" and let the org choose: invest attention, freeze the module, or accept the risk explicitly.

### 6.4 What the forge measures (shown on every team page)

1. Escalation rate *e*, by kind and path.
2. Attention-minutes per landed intent.
3. Decision latency p50/p90 and queue age.
4. Regret rate (reverted, overridden or incident within 30 days), by person, kind and model.
5. Blind-sample agreement, model vs human.
6. Canary catch rate.
7. Defaults applied, by reversibility class.
8. Interrupts per person-day.
9. Comprehension debt on critical modules and the count of modules with fewer than 2 attesting humans.
10. Precedent catch rate and false-positive rate.
11. Landed-without-revert by intent size [20-future: "the number that matters… only the forge can measure it"].

---

## 7. Playbooks by organization size

**Solo developer (1 human, 20–80 threads).**
- Budget 60 minutes a day in two sessions.
- K=2–3 for UI intents, K=1 otherwise.
- Taste is decided by the human; every pick proposes a precedent. After about a month, most UI work in a given design system resolves through precedents.
- No `understand.attest` except on `auth/`, `billing/` and migrations.
- Land dark by default for R0–R1.
- One digest on Friday.
- Goal: e ≈ 0.3 within 60 days.

**10-person startup (Amp-like).**
- Trunk-based through the landing service. Humans approve only taste selection and R3–R4.
- One **taste owner** (the designer or founder) owns `.forge/golden` and `.forge/taste`.
- One **architecture owner** reads the digest every Monday (20 minutes, with the team).
- Comprehension ledger on 3–5 critical modules, with 2 attesting humans each.
- SOC 2 is met by ledger + signed evidence + signed decisions, consistent with Amp's account that review "isn't on the list" for 20 people [11-human-role].
- Canary rate 1 in 100.

**200-person scale-up.**
- Decisions are routed by **ownership of intents and modules**, not CODEOWNERS file globs. CODEOWNERS sends every agent change to the same five people [20-future: "what breaks"].
- Domain taste owners hold delegate chains.
- Attention budgets are enforced, and budget overruns appear in staffing reviews as evidence of under-capacity.
- Taste models run in shadow per domain for one quarter, then go active for R0–R1 taste where blind agreement ≥ 90%.
- Risk tiers following Meta: gating the riskiest 50% of diffs catches 84.6% of SEVs [09-industry].
- Blind audit sample 3%. Canary rate 1 in 50.

**5,000-person enterprise, including regulated.**
- Two-person rule on regulated and critical tiers: sponsor plus an independent `understand.attest` with teach-back, both passkey-signed.
- No defaults on regulated paths. Model answers are not allowed on regulated paths at all.
- The change advisory board is replaced by the Architecture Digest plus a weekly **risk-acceptance review** of the R3–R4 decisions.
- Ledger and evidence packs export to GRC. The SIEM receives every decision.
- Separation of duties between test, spec and code is computed.
- This matches what every large company with a published policy does [09-industry: Stripe, Spotify, Ramp, Shopify all keep a human merge gate] and Anthropic's "entire codebases have strict human approval" [01-anthropic]. The difference is that the human gate is placed by *risk class*, not on every diff.

**Open source.**
- Proposals arrive as intents. The maintainer's first and cheapest decision is `intent.shape`: "Do we want this at all?" [09-industry: goose "issues are the new PRs"; 04-openai-codex: openai/codex no longer accepts external PRs because "reviewing outside PRs costs more than reimplementing"].
- Accepted intents are implemented by contributor threads in quarantined sandboxes at the contributor's compute cost, and reach the maintainer only after passing the project's proof bar, with vouch-style trust gating [10-oss-slop: Ghostty vouch, Pi `lgtm`].
- Maintainer decision verbs are first-class: fix-merge, split-merge, cherry-pick with attribution, redesign, retire, reject [11-human-role: Yegge's PR Sheriff outcomes].
- The project publishes its **maintainer capacity** ("4 decisions/day; queue 37; median wait 6 days") so contributors see the cost they impose.

---

## 8. Evolution as intelligence gets cheaper

| | 2027 | 2029 | 2031 |
|---|---|---|---|
| Main decision kinds | `taste.select`, `understand.attest`, `risk.accept` per intent | `intent.shape`, `intent.conflict`, `risk.accept`; taste mostly by precedent and model | Portfolio and risk acceptance, incident adjudication, audit samples |
| Escalation rate target | ~0.3 | ~0.05 | ~0.005 |
| Taste | Human picks among K; precedents accumulate | Calibrated models for routine taste; humans on novelty and brand-defining moments | Humans set direction ("what should this feel like") and audit |
| Understanding | Per critical-module attestation, teach-back | Shifts from code to specs and behavioral contracts [20-future: scenario D] | Mostly attestation of *contracts*; code comprehension is for incidents |

**Gets more important:**
- intent shaping, because the remaining failures are "the agent built the wrong thing well" [20-future: 2029];
- intent conflict adjudication;
- the comprehension ledger, because code grows faster than anyone's model of it;
- proof-of-human and the accountability ledger [20-future: 2031 bottleneck is "trust and accountability"];
- canaries and blind samples, because they are how an org knows its gates still work;
- the Architecture Digest, which turns into a behavior digest.

**Disappears:**
- line-level diff review on most paths;
- `taste.accept` on routine UI inside an established design system;
- per-change decisions of any kind;
- CODEOWNERS as routing;
- notification feeds;
- est_minutes calibration for decisions that no longer exist.

The Compare surface lasts longer than people expect. Cheaper intelligence raises K, and choosing among real alternatives is the purest form of taste. It moves up a level, from comparing screens to comparing *product approaches* and later *strategies*.

---

## 9. Verdicts on the user's ideas

**(a) Almost headless forge that auto-resolves conflicts: partially agree.**
- The *data plane* should be headless. Agents are the main API clients, and pushes rose 4.9x to 3.35B a month [05-github].
- Landing, re-verification and conflict repair should be a platform service. Today nobody notifies a session of base-branch conflicts [01-anthropic: "Claude doesn't get notified about merge conflicts"; 02-anthropic-news: GitHub emits no webhook].
- "Automatically resolves conflicts" holds only for false conflicts and for re-derivation from intent followed by re-proof. Classical merge is right only 46% of the time and silently wrong 3% [08-merge-conflict]. LLMs mainly win because they "never abstain", and an LLM judge accepted 4 of 5 structurally invalid resolutions [08-merge-conflict].
- The *control plane* must not be headless. Every company with a published policy keeps a human gate somewhere [09-industry]. OpenAI's bottleneck moved to "human attention… three to five sessions" [03-openai-index]. A headless forge without a decision router just moves the human bottleneck into Slack.
- Verdict: **headless for edits, not for decisions.**

**(b) Share threads instead of issues and PRs: partially agree, with the wrong object being shared.**
- Threads are the right unit of *work*. Everyone already has thread URLs and trailers [18-thread-provenance]. Coordinator threads orchestrating worker threads is the shape the industry has converged on [17-orchestration].
- But coworkers should not be *sent threads*. Threads run to more than 21M tokens uncompacted, and human prompt text is 0.4% of the bytes [18-thread-provenance]. Sharing them leaks secrets [18-thread-provenance: Amp withdrew public sharing].
- Authority must not travel through them [17-orchestration: approval laundering].
- What should be shared is the **Decision**, with "ask the thread" behind it for anyone who wants the reasoning. The issue survives as the Intent, because a durable goal outlives any one attempt [20-future: "Threads replace PRs" is wrong for accountability].
- Verdict: **threads are where work happens; decisions are what people send each other.**

**(c) Human input moves to tastemaking; portals are necessary: partially agree.**
- Portals and visual verification are necessary for product taste. Amp's Time Capsule session is pure tastemaking [11-human-role]. Karpathy: "looking at stuff is fun… a diff of 10,000 lines is not useful" [11-human-role]. Cursor merges >30% of its PRs from agents that attach video proof [11-human-role].
- They are **not sufficient**:
  - The defects AI adds most are invisible in a preview: readability >3x, security up to 2.74x, excessive I/O about 8x [11-human-role: CodeRabbit].
  - Engineering taste (invariants, what belongs in core) does not show up in pixels [11-human-role: Ronacher, Beck, Yegge's "Beads must not know about Gas Town"].
  - Portals are mutable, so approvals must bind to pinned deployments [11-human-role].
- Taste does not scale through one person's eyes. Yegge still spends 15–20 h a week on PRs [11-human-role]. Taste has to be **amortized into precedents and golden images**, and in time into calibrated models.
- Verdict: **portals are necessary for the Taste surface; the Understanding surface and taste amortization are what make the design hold up.**

---

## 10. Failure modes, and the strongest objection

| Failure mode | Mechanism | Counter |
|---|---|---|
| **Approval by neglect.** Defaults on timeout become silent auto-approval | Deadlines pass while budgets overflow | Defaults only for R0–R1; the default rate is shown per person; overflow raises a capacity signal to the lead |
| **Goodhart on e.** Teams loosen policy to hit escalation targets | e is the visible metric | e is always shown next to regret, canary catch rate and escaped defects; a policy change that lowers e is itself a Decision owned by a named person |
| **Taste homogenization.** Models and precedents freeze last year's preferences | Training on past picks | Exploration: 5% of model-confident taste decisions still go to humans (unlabelled); every precedent has an owner and a 90-day review |
| **Framing attacks.** The question is biased toward the author's preference | The author writes the question | A separate composer; "none" and "ask more" always offered; evidence produced by the platform |
| **Comprehension theatre.** Teach-back becomes rote | Questions become predictable | Questions are generated per change from mutation-relevant lines; scored by a model; canaries hidden among them |
| **Session latency causes staleness** | Decisions wait for 13:30 | Land dark for R0–R1; delta decisions; "Now" interrupts reserved for threads that block others |
| **Inbox as a new bottleneck person** | Routing piles decisions on a few owners | Delegate chains; the forge shows load per person; precedents shift load from people to rules |
| **The human stops reading anything** | Trust in the system grows | Canary catch rate falls first, and that is visible |

**The strongest objection:** *"You are optimizing the bottleneck that is about to vanish. In two to three years, models will have better taste than most humans and will understand the code better than any human. A forge built around human attention is a horse-carriage feature, and Ronacher himself says better visualizations will not restore understanding."*

**My answer.**
- First, the design's main metric is *escalation rate falling to near zero*. It is the mechanism for handing work off safely, not a monument to human review. You cannot know when to stop asking humans without measuring agreement on blind samples. Organizations that skip the measurement either keep humans in the loop too long (Faros: median time in review +441.5%) or drop them too early (merges with no review +31.3%, incidents per PR +242.7%) [11-human-role].
- Second, accountability does not get cheaper with intelligence. Regulators, auditors and incident reviews ask who signed, and the 2031 bottleneck in the central scenario is "trust and accountability" [20-future]. Fewer decisions per human means each one carries *more* weight, so routing it well, binding it to evidence and protecting it from fatigue matters more, not less.
- Third, on Ronacher: I agree that visualization does not restore understanding, which is why understanding is attested by active recall at *module* granularity and why the forge can say "nobody understands this module." That makes the loss of understanding an explicit, owned risk instead of a surprise found during an incident.
- If the objection turns out right, the forge degrades gracefully: e goes to about 0, the inbox holds a handful of `risk.accept` and `intent.shape` decisions a week, and the ledger is still there for the auditor.

---

## 11. A day in the life (2027-11-17, a 200-person fintech, "Tallyline")

**Priya Raman**, staff engineer, payments platform:
- sponsors 18 active intents;
- 312 threads running under them, 41 of which are maintenance agents with no human intent;
- 268 landings yesterday;
- attention budget 100 min a day, sessions at 08:45, 13:30 and 16:45;
- interrupt allowance 2.

Other people: **Marco** (design-system owner), **Dana** (compliance lead), **Wei** (engineer, payments, second attester on `settlement/`).

- **08:40.** Priya opens the coordinator chat: "What needs me?" Overnight there were 241 landings. 22 decisions were answered by precedent and 37 taste choices by `taste-web@v14`, of which 2 were blind-sampled to her. 3 defaults applied, all R0. One auto-revert happened: a currency-format change failed a guarded rollout at 1% and was re-derived by its thread, and the re-proof is green. 11 decisions are queued for her, estimated at 27 minutes.
- **08:45–09:14, session 1** (29 min, 11 decisions):
  1. `taste.select`, refund-status empty state, K=3, 3 min. She picks B with A's headline. The composer proposes the precedent "empty states state the next action, not the absence"; she accepts it, and it goes into shadow mode.
  2. Two blind samples, 1 min each. She agrees with the model on one and disagrees on the other (a too-playful tone in a dispute flow). The disagreement is logged against `taste-web@v14` on the `disputes/` scope.
  3. `understand.attest` on the idempotency-key TTL change in `settlement/`, 7 min. She reads the walkthrough and answers a teach-back: "An in-flight refund whose key expired mid-retry — what happens?" Her answer matches the code path. Signed with her passkey.
  4. `intent.conflict`, 4 min. Her intent "batch payout retries" and Ahmed's intent "rate-limit partner API" both claim `partner_client.retry()`. The coordinators could not sequence them because both change retry semantics. She decides that the rate limiter owns backoff, and both threads re-plan. No code conflict ever reached her.
  5. `risk.accept`, 5 min, R3. The `payout_events` schema change is irreversible after backfill. The forge has already split it into two phases (add the column, then activate). She accepts phase 1 only; phase 2 becomes a decision due Friday.
  6. Four `intent.shape` questions from the shaping pass, 6 min in total. One fork asks: "store FX rate on the payout or recompute?" She answers "store", and that becomes a precedent.
  7. One delta decision, 1 min. A taste approval from yesterday was rebased and the button moved 6 px. She accepts the delta.
  8. One `understand.attest` contains a canary, 2 min. The walkthrough claims that a lock is taken before the balance check, but the excerpt shows it after. She flags it. Canary caught; only she and the aggregate stats see the result.
- **09:15–12:30.** Deep work with no interrupts. She writes two intents for Q1 settlement netting and has the shaping pass run on them.
- **11:02.** The one "Now" interrupt. A partner sandbox credential rotation (R4, external effect) is pending and blocks 14 threads. She answers in 90 seconds on her phone, with a passkey. That leaves 1 interrupt in her allowance.
- **13:30–13:52, session 2** (22 min, 8 decisions). Marco is a delegate on 3 of the taste decisions and answers them from the Compare view on his tablet. The precedent from the morning has matched 4 changes in shadow mode with 0 false positives.
- **15:00.** Wei receives a scheduled 15-minute module walkthrough of `settlement/`. Weighted churn since his last attestation is 3,900 lines, which is over the 3,000 threshold. He attests, and the ledger shows 2 attesting humans again.
- **16:45–16:58, session 3** (13 min, 5 decisions). One of them is a full rejection of all K=3 candidates for a payout CSV export ("none of these handle partial refunds"). Her note restarts the intent.
- **17:00, Dana's view.** For Tallyline that day:
  - 4,920 landings, 431 human decisions (e = 0.088), 8 R3–R4 accepts, all signed.
  - Canary catch rate 46 of 49.
  - Blind-sample agreement 91.4% on web taste and 78% on `disputes/`. The forge proposes keeping `disputes/` human-only, and she accepts.
  - One critical module (`ledger/reconcile`) has a single attesting human. Its owner gets a walkthrough scheduled for tomorrow.
- **Priya's totals**: 24 decisions, 66 attention-minutes (under her 100-minute budget), 1 interrupt. Escalation rate on her intents is 24/268 = 0.09. Regret on her decisions from the last 30 days: 1 of 512 (an overridden copy precedent).

---

## 12. What to build first, and what never to build

### 6-week MVP

**Week 1: the Decision object and the inbox.**
- Decision object, D1 schema, and an Attention DO per human holding the queue, budget and sessions.
- Passkey-signed answers.
- Deadlines and defaults (R0–R1 only).
- Inbox UI sorted by value per minute.
- `Forge-Decision` trailer.

**Week 2: the composer and the Compare view.**
- A Decision Composer agent that runs in isolation and reads only evidence and the diff.
- Compare view for K=2–4 candidate threads on pinned Workers Preview deployment URLs, with synchronized route and fixture replay through Browser Run.
- Pick, combine and reject-all verbs.
- Page comments routed to the thread.

**Week 3: precedents and golden images.**
- `.forge/taste` and `.forge/golden`.
- A "generalize this" flow that drafts a rule and a golden image.
- Perceptual screenshot diff as platform-signed evidence.
- Shadow mode with catch and false-positive counters.

**Week 4: the Understanding surface.**
- Executed walkthrough generated by a separate agent.
- Intent record view.
- Ask-the-thread with answers cited to log messages.
- Teach-back on `understand.attest`.
- Comprehension ledger v0, driven by `.forge/understand.yaml`: attesters and churn.

**Week 5: binding and rollout.**
- Decision binding: tree digest and behavior fingerprint.
- Carry-forward and delta decisions in the landing service.
- Reversibility classifier v0, rule-based: path, migration files, schema, external-effect APIs.
- Land-dark for R0–R1.

**Week 6: measurement and the digest.**
- Metrics page: e, attention-minutes per intent, latency, defaults, interrupts, regret hooks.
- Canary injection at 1 in 50.
- Architecture Digest v0 from git and the dependency graph: new modules, dependencies, public API and schema changes, invariants.

Taste-model training is **not** in the MVP. The MVP only logs pairwise choices from Compare (Bradley-Terry-ready) and the blind-sample protocol, so that a model can be trained and *measured* later. Explicit precedents come first because they hold in every scenario [20-future: "start with explicit written principles and golden examples… before learned models"].

### Never build

1. **A notification feed of thread events.** Events go to agents and coordinators; humans get decisions.
2. **Per-action approval prompts and an "approve all" button.** A 93% approval rate is not oversight [01-anthropic].
3. **Line-comment PR review as the default surface.** It stays available as a drill-down, never as the landing page.
4. **Raw transcript reading as review** [18-thread-provenance: 0.4% human text].
5. **Leaderboards of approvals per person**, which reward rubber-stamping.
6. **Model answers on R2–R4, regulated paths or `understand.attest`.**
7. **Decisions authored by the agent being judged.**
8. **Public, discoverable threads by default.**
9. **A decision without a cost estimate, a deadline and an explicit default (or an explicit "blocks").**
10. **Agent-to-agent relay of human approval in any form.**

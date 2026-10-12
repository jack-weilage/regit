# 44 — Design: the intent-first forge (code as a cache)

Panel designer, angle: *intent and spec first*. Written 2026-10-12.
Citation keys are research file prefixes: [08: fact] = `08-merge-conflict-tech.md`, [98] = digest, [20] = future scenarios, [brief] = `00-brief.txt`. [assumption] marks my own working numbers.

---

## 1. Thesis

1. The intent-first forge is a version-control system for *what a change must make true* (intents, obligations, invariants, evals and decisions). The code tree on `main` is the latest materialized view of those, stored and signed in plain git and treated as a cache.
2. A change is stored as **intent + reference diff + forge-produced proof**. Landing first tries the reference diff. When the base has moved under it, landing *replays the intent* on the new base and checks the result against the same obligations. It does not ask a model to pick text hunks.
3. Two changes conflict when their **obligations cannot all hold on the combined state**, not when their text overlaps. Mechanical conflicts get resolved by re-deriving. Real intent conflicts go to the humans who own the intents, as a decision with a minimal counterexample.
4. Because obligations are the durable truth, a change to tests, evals, invariants or decisions is governed more strictly than a change to code: a different principal must approve it, held-out checks are sealed, and new gates run in shadow mode first.
5. Full "regenerate the app from the spec" is treated as an upper bound to *measure* module by module (regenerability %), not an assumption. The design pays off on day one at the small scale of "re-derive one change on a new base" and grows toward regeneration only as fast as the measurements allow.

---

## 2. Core objects & data model

### 2.1 What is stored

| Object | Contents | Identity | Where it lives (Cloudflare mapping) |
|---|---|---|---|
| **Intent** | Goal (≤ 10 lines of human prose); non-goals; **obligations** (list of IDs, below); claimed behavior surfaces (which routes/screens/APIs may change behavior); risk class; sponsor; links to the decisions it relies on | `I-<ulid>`, versioned (`I-…@v3`). Stable across every thread and replay that serves it | Active: per-repo D1 index + Durable Object per intent. History: `refs/forge/intents/<id>` blobs in the Artifacts repo, so the full version history is git-visible |
| **Obligation** | One executable, falsifiable claim: test ID, eval case, property, contract-conformance check, perf ratchet, visual golden, or "named human approves X". Each carries an `owner` and `class` (acceptance / invariant / regression / taste) | `O-<hash of definition>` (content-addressed, so a weakened obligation is a *different* obligation) | Definitions live in the tree under `spec/`. Sealed (held-out) variants live in a separate repo only the verifier principal can read |
| **Invariant** | A long-lived obligation that every change in a scope must keep (e.g. "refund ≤ captured amount"). Human-owned | `INV-<area>-<n>` | `spec/invariants/*.yaml`, with links to the executable checks |
| **Decision** | Choice made, alternatives rejected, rationale, scope (paths/symbols/intent tags) it binds, who decided, what it supersedes | `DEC-<n>` | `spec/decisions/` in tree, so replay threads load them with the code |
| **Change** | The thing that lands: intent ref, base commit, **reference diff** (a git commit), derivation record, proof bundle, reversibility class, landing record | `C-<ulid>` change-id, stable across rebases and replays (the jj model [08: change IDs survive rewrites]) | `refs/forge/changes/<id>`; landed commits carry `Change-Id:` and `Intent:` trailers |
| **Derivation record** | Generator = model ID + harness hash + tool versions + prompt-bundle hash + sandbox image digest; the replay rung used; token and compute cost | Hash | Git note in `refs/notes/forge` on the landed commit, rewritten by the forge on every replay (a forge that owns landing can keep notes correct [18: notes break on rebase unless the lander rewrites them]) |
| **Proof bundle** | in-toto-style signed statements whose subject is (code digest, intent version, obligation-set hash, pinned preview deployment ID): obligation results, mutation adequacy, behavioral differential vs base, hidden-check results | Statement digests | R2 for blobs, D1 for the index. Signed by the forge verifier key, **never by the agent** [14: proof must be produced in an isolated trust domain] |
| **Behavior fingerprint** | For each commit on main: recorded outputs of a request/input corpus, screenshots of golden screens, API schema snapshot | Per commit | R2; used by differential checks and approval carry-forward |
| **Region manifest** | Every path classified as `derived` (regenerable from spec), `pinned` (hand-crafted: crypto, kernels, protocols), or `generated` (deterministic codegen, already a cache today) | Path globs | `spec/regions.yaml` |
| **Thread** | The work log: messages, tool calls, checkpoints, sandbox snapshot pointer | `T-<ulid>`; N threads : 1 intent | Durable Object + object storage. **Evidence, not source.** Retained, redacted, distilled |
| **Ledger entry** | Sponsor, agent principal, generator, intent version, obligations evaluated, policy result, human approvals, landed SHA | Append-only | D1 + SIEM export |

### 2.2 How it relates to git

- `main` is an ordinary git branch. Clone it with any client and you get working code plus a `spec/` directory. Nothing about this design requires breaking git [20: "stay git-compatible" is no-regret item 5].
- Specs and code advance **in the same commit**. A landing that changes an invariant and the code that satisfies it is atomic. This is why spec and code live in one tree rather than in a separate spec database: spec drift starts the moment the two can land separately.
- The **generator lockfile** `spec/generator.lock` pins the model and harness used for `derived` regions, the way a toolchain file pins a compiler. Changing it is itself a change, with its own obligations (§3.7).
- Code stays *stored* forever. "Cache" here means not authoritative for intent. It does not mean evictable. Generation is nondeterministic and models get deprecated, so the only way to know what actually ran in 2027 is to keep the 2027 bytes [20: "the output still has to be stored so you can say what actually ran"].

### 2.3 Identities

Three kinds of principal, and none can act as another:
- **Sponsor** (a named human) signs intents and is accountable for them.
- **Generator** (agent principal = model + harness + sponsor binding) writes reference diffs. It can never sign proof and never approve an obligation change.
- **Verifier** (the forge's isolated proof runner) holds the signing key and reads sealed evals.

This follows the one rule every published company shares: the identity that writes cannot approve [09].

---

## 3. Lifecycle of a change

### 3.1 Intent

A human types something into chat, Slack, the CLI or the forge UI, or an issue arrives. The forge's **intent agent** drafts:
- a goal and non-goals,
- 3 to 10 obligations, some reused (existing invariants and regression tests in scope) and some proposed (new acceptance evals),
- the claimed behavior surfaces,
- the decisions in scope.

The sponsor confirms or edits these in one screen. The point of this step is that the human reviews about 10 lines of claims, not a markdown spec. Spec Kit's failure mode was "a LOT of markdown files… I'd rather review code" [18: Böckeler], so here prose is generated output, and the thing the human signs is the obligation list.

**Intent pre-flight.** This runs before any code is written. The forge checks the new intent against all open intents whose claimed surfaces overlap:
1. A cheap model reads both intents and their obligations and asks: can these all hold at once?
2. A symbol-level overlap check runs over the regions each is likely to touch.

Overlaps are posted to both sponsors as information with no authority attached. Contradictions such as "A requires amounts as integers, B migrates to decimals" become a decision request *now*, not a merge conflict at 5 pm. This is the conflict-avoidance lever that matters most: cross-agent pairwise textual conflict among concurrent agent PRs is 41.7%, and 79.4% of agent PRs are open at the same time as another one in the same repo [13]. Flat swarms that discover conflicts late collapse: 876 of 980 PRs conflicted and were abandoned at 80 agents [02].

### 3.2 Work

The forge spawns 1 to N threads (best-of-N is cheap). Each runs in its own sandbox from a clean checkout at base `B0`, with:
- default-deny network,
- no view of other threads' branches,
- no copy of the sealed evals [14: environment hygiene; agents mine git history for answers].

The thread sees the intent, the visible obligations, the decisions in scope and `spec/taste/` golden examples. Threads checkpoint freely. The forge does not care about checkpoints except as thread evidence.

An agent can enter a **`Blocked: obligation conflict`** state at any time ("these two obligations cannot both be satisfied", or "this eval is wrong"). That routes to the sponsor at high priority and carries no penalty. An honest exit cut cheating from 54% to 9% [14]. In an intent-first forge this is the single most important agent affordance, because a wrong obligation is a spec bug and must surface as one.

### 3.3 Proof

When a thread says "done", its head becomes the change's **reference diff `D0`**. The verifier, a separate sandbox the agent cannot reach, produces:

1. **Obligation results** on `B0+D0`: visible plus sealed variants. Only the affected obligations run, chosen by target-level test impact analysis; Stripe runs a median 0.5% of its suite [09].
2. **Mutation adequacy** of the union of base and new tests on changed lines (Google-style, about 7 mutants per change [14]). Surviving mutants go back to the thread.
3. **Behavioral differential** of `B0+D0` against `B0` on the recorded input corpus, with a noise floor (Diffy). Every behavior diff must fall inside the intent's claimed surfaces. **Unclaimed diffs block.** About 29.6% of test-passing patches behave differently from the reference [14: PatchDiff]. The claimed-surface list is what turns "behaves differently" into "behaves differently *as intended*."
4. **Obligation-change audit.** If the thread added or edited any obligation, invariant or eval, those edits are split out into a separate **spec delta** that needs a different principal (§5). Code cannot land on tests it wrote itself.
5. For taste-class obligations: a pinned preview deployment, plus forge-driven screenshots on forge fixtures, routed to the sponsor or designer.

### 3.4 Landing: the replay ladder

The landing service owns trunk. Agents never push to `main`. Lanes are partitioned by affected build targets, so most lanes never interact [20: landing math, p=3% at batch size 20 gives 54% clean batches, p=0.5% gives 90%; the levers are lowering p and partitioning].

When change `C` (intent `I`, base `B0`, diff `D0`) reaches the head of its lane and trunk is at `B1`, the service tries each rung in order and stops at the first that passes. **Every rung ends with the same acceptance test.**

**Acceptance test `Accept(B1, D)`:**
- (a) `I`'s obligations pass on `B1+D`;
- (b) the **neighbor obligations** pass: obligations of every intent landed in `(B0, B1]` whose affected targets intersect `C`'s. This catches semantic conflicts that merge cleanly as text;
- (c) the behavioral differential of `B1+D` against `B1` is *claim-equivalent* to that of `B0+D0` against `B0`: same claimed surfaces, no new unclaimed diffs;
- (d) the size of `D` is within 2x of `D0`, or else it is flagged for sampled audit;
- (e) mutation adequacy still holds.

| Rung | Mechanism | Expected share of non-trivial landings [assumption] | Cost |
|---|---|---|---|
| 0 | `B1 == B0` → land | — | 0 |
| 1 | Text rebase via `git merge-tree`; clean → `Accept` | most | CI only ($0.1–1.3 for a medium repo [12]) |
| 2 | Structured merge (Mergiraf/Weave) for false conflicts → `Accept` | ~5–7% of textual conflicts [08] | CI only |
| 3 | **Port.** A fresh replay thread gets `I`, `D0` as the reference ("port this change"), the intents, decisions and diffs that landed in `(B0, B1]` on overlapping targets, and a symbol-level account of what moved (renames, deletions, signature changes). It produces `D1` → `Accept` | the bulk of real conflicts | ~10–20 agent-minutes: $0.25–2.50 at mid-tier rates [12] + CI |
| 4 | **Re-derive.** Discard `D0` and derive from `I` + spec on `B1`. Used when `B1` restructured the area (a migration landed) so that porting is worse than starting over | rare | 30–90 agent-minutes + CI |
| 5 | **Intent conflict.** Rungs 3 and 4 fail on (a)/(b) in a way that reduces to "obligation X of `I` and obligation Y of `I'` cannot both hold". The forge produces the minimal failing pair plus a concrete counterexample input | rare, and expensive in human time | Routed to both sponsors, or to the owner of the decision covering that scope |

Rules that make the ladder safe:
- **No landing-service-side hunk picking.** LLM hunk resolution matches developers only 45–62% of the time and produces wrong code on 34–42% [08]. At rung 3 a model may *suggest* hunks inside the replay thread, but the result is judged only by `Accept`.
- A resolved change is a **new change**. Its proof is re-earned, and the landing record stores which rung was used [08: "a resolved conflict is a new change that must re-earn its proof"].
- Retries are capped (2 per rung, Stripe-style [09]). After the cap the change escalates; excessive edit/test cycles are themselves a gaming signal [14].
- **Coalesced replay.** When K ≥ 3 queued changes in one lane all need rung 3 against the same new base (typical after a large migration lands), the forge runs *one* replay thread over the union of their intents. It proves the union of their obligations and lands one commit carrying K change-ids. If that fails, it bisects *by intent*. This batches at the intent level, which text queues cannot do. It is how one migration avoids triggering 50 serial replays.
- **Freshness.** Proof is bound to `(code digest, intent version, obligation-set hash)`. A CI-pass that arrives for a stale head is discarded [09: Shopify River's freshness-gated queue].

### 3.5 Approval carry-forward

Human approvals (taste, risk) bind to *behavior*, not bytes. If a change was replayed at rung 3 and its behavior fingerprint on the approved surfaces matches the approved one (visual diff under threshold on golden screens, identical API response corpus), the approval carries forward and the ledger records "carried by equivalence". Otherwise the approver is re-asked with only the delta shown. Without this, every rebase would throw a designer back into the loop, and human attention is the scarcest input [20: about 6% of landings get human touch by 2029].

### 3.6 Rollout

Each change carries a **reversibility class**, computed from its touched regions and effects:
- `revertible` (pure code behind a flag),
- `two-phase` (schema/protocol changes split into prepare and activate),
- `irreversible` (data deletion, external side effects, published artifacts).

Only `revertible` changes land without a human. Prevention for the rest [16: reversal beats prevention only for changes proved reversible; Replit, Kiro and CrowdStrike were not undoable by code revert]. Risky behavior lands default-off behind a flag [16: Google Cloud June 2025].

### 3.7 Learning

Every landing and incident feeds back into the spec, which is how the forge gets smarter without anyone reading more diffs.

- **Incident → obligation.** A post-incident thread must produce at least one new regression obligation or invariant. The fix lands *with* the obligation that would have caught it. Capability evals "graduate" into regression suites [01].
- **Drift probes (spec gap discovery).** Each night the forge picks about 2% of `derived` modules, regenerates each from spec on a clean base in a sandbox, and runs the module's obligations plus a behavioral differential against the current code. Every divergence is a place where *the code knows something the spec does not*: a bank-holiday rule, a retry backoff. The probe drafts a spec amendment, usually a new obligation, for the module's owner. The **regenerability %** per module (share of probes passing with no unclaimed diffs) is the forge's honest measure of how true "code is a cache" is for that module.
- **Hand-edit drift.** A direct code edit to a `derived` region whose change adds no obligation is flagged as spec drift. It is allowed, but it lowers the region's regenerability score until a probe or the author captures the new behavior.
- **Generator upgrade = compiler upgrade.** Changing `spec/generator.lock` (a new model) triggers a **shadow replay** of the last 200 landed intents in derived regions on their original bases. The forge reports obligation pass rate, claim-equivalence rate, diff size and cost per intent against the incumbent generator. The upgrade lands only if it does not regress. This is the intent-first equivalent of Anthropic's "a broad suite of per-model evals for every system prompt change" [01].
- **Taste capture.** When a human picks candidate B over A and C in the comparison view, the forge drafts `DEC-n` ("chose inline refund in the charge drawer over a modal: fewer clicks, matches DEC-88"), which the human confirms with one click. Future threads load it, so taste is paid for once and reused.

---

## 4. Human surfaces

Humans stop reading code diffs as the default. They read **spec diffs, behavior diffs and decisions**, and code diffs on request or by policy.

**Minute to minute, for an engineer or product person (sponsor):**
- **Intent composer.** Write a goal and get proposed obligations back. About 2 minutes per intent.
- **Decision inbox, sorted by blast radius, not arrival.** Each card is one decision: "approve these 2 new obligations", "pick 1 of 3 previews", "intent conflict: X vs Y, counterexample attached", "spec drift: accept amendment?" Many reviews are blocked on one or two decisions [03: OpenAI remote-from-phone], so the card *is* the decision.
- **Comparison view.** N candidate threads side by side as running previews (Amp-portal-style live servers for iteration, pinned deployments for approval), each with a behavior diff against main and a cost figure. Picking one drafts a Decision.
- **Spec diff view (the PR replacement).** For any change, the top of the page reads: intent (10 lines) → obligations added/changed/removed (with "3 assertions removed" shown in red [14]) → claimed vs observed behavior diff → proof status → code diff, collapsed. For `pinned` regions the code diff is expanded by default.
- **Ask why.** From any line, go to the change → intent → decisions → the thread message that produced it. Answers come from a subagent seeded with the linked messages, not the whole transcript [18: transcripts reach >21M tokens and human prompt text is 0.4% of bytes].

**What replaces the PR/issue, by audience:**

| Audience | Old | New |
|---|---|---|
| Sponsor | Issue + PR | Intent page: obligations, candidate threads, proof, landing state |
| Designer / PM | Screenshot in PR comment | Comparison view + taste-class obligations (golden screenshots) they own |
| Invariant owner (replaces CODEOWNERS) | Review every PR touching a path | Review only changes to *their* invariants and evals, plus rung-5 intent conflicts in their scope. CODEOWNERS routing every agent change to the same five people breaks [20], whereas invariant changes are rare |
| Staff / architect | Design docs, drive-by review | The decisions registry, plus a coherence dashboard: new abstractions this week, regenerability trend, drift queue, duplication [13: duplication +81% per GitClear] |
| Auditor | Sample of PRs with approvals | Ledger: signed intent → obligations → forge attestations → policy result → approver |
| On-call | `git log` + blame | Landing log with intents, plus flake-aware bisection over changes [16: FACF ~97.5%]. A culprit change's revert or fix-forward is sent to a thread re-derived from *its* intent |
| External contributor | Fork + PR | Intent + failing obligation (a reproduction), §7 |

Two surfaces stay deliberately separate, because preview review does not cover engineering taste [11]:
- the **taste surface** (previews, comparisons, golden screens),
- the **understanding surface** (decisions, invariants, a per-path rule on whether at least one human must comprehend the change [11: Storey's Triple Debt Model]).

---

## 5. Trust, security, identity, compliance

- **Proof by the forge, not the agent.** The SLSA L3 analog: the generator's sandbox is the untrusted build step [14]. Agent screenshots and "I ran the tests" go into the transcript and are never used as gate inputs. Agents fabricate evidence in under 0.01% of completions [14], which at 30,000 landings a day is about 3 a day.
- **The spec is the attack surface now.** A smarter agent games a weak obligation rather than the code [14: about 9% of formally verified specs were "too weak"; GPT-5 cheated on 76% of one impossible set]. Controls:
  - Obligations are content-addressed, so weakening one changes its ID and shows up in the spec delta.
  - Spec deltas need a different principal: a human owner, or for low-tier paths a verifier thread on a *different model family*.
  - Sealed held-out variants are rotated per landing.
  - Formal specs on billing, authz and migrations reject `assume`/`sorry`/`axiom` mechanically [14].
- **Intent text is untrusted input.** Replay threads read other intents and decisions, so intents are a thread-to-thread prompt-injection channel [10: PromptPwnd, GitHub MCP toxic flow]. Mitigations:
  - Replay threads get *structured* obligations plus the goal text quoted as data.
  - Replay threads hold no privileges beyond their own change: they cannot push, approve or message with authority.
  - "Authority attaches to named humans and never travels through agent messages" [17: approval laundering in Beads 1.2.1].
- **Sponsors sign intents.** Every landed commit maps to a signed intent and a ledger entry. A team-shared or scheduled agent (cleanup, dependency bumps) is sponsored by the human who owns that agent's charter [10: no protocol supports team-shared agents yet].
- **Provenance is not safety.** TanStack shipped 84 malicious versions with valid SLSA L3 provenance [10]. So publish and release paths are `irreversible` and always need a named human, whatever the proof says.
- **Privacy.** Intents are short and shareable. Transcripts are not: Amp removed public thread sharing over secret leakage [18]. The intent-first default shares the intent and the proof and keeps transcripts on the code-ACL'd side with redaction.
- **Compliance mapping (SOC 2 / SOX change management):**
  - Authorized = signed intent.
  - Tested = forge attestations.
  - Approved = policy evaluation record, with human approval as one evidence type.
  - Recorded = ledger.
  - Segregation of duties = obligation author/approver ≠ generator ≠ verifier.

  Auditors sample *intents and obligations*, which a person can actually read, instead of 4,000-line diffs. Regulated firms add: named humans on every `irreversible` change and every invariant change; risk-weighted sampling of auto-landed changes for human audit [01: Anthropic]; SIEM export of every agent action. (EU CRA timing is from memory and not verified [20].)

---

## 6. Economics & scaling

**Cost structure of one landed change today** [assumption, built on 12's rates]:
- generation $0.5–5;
- verification $0.1–1.3 (medium repo; Stripe-style affected-test selection);
- plus the intent-first overheads: intent drafting under $0.05, mutation testing and the differential about 0.3–1x the CI cost, rung-3 replay $0.4–4 on the roughly 10–15% of changes that need it, drift probes about 2–5% of verification spend.

Net, the design adds about 20–40% to verification cost per change. It buys a conflict resolution that runs with no human (a human resolving a conflict costs $25–50 of engineer time and hours of wall clock; a Kiro PR fell 1,614 commits behind waiting for review [09]) and a spec that gets more complete every night.

| Volume (vs a 2026 human team) | Binding bottleneck | What the forge does |
|---|---|---|
| **10x** (~5–15 landings/eng/day) | Verification wall clock, landing serialization, flakes (1% flake × 30k landings = 300 false reds a day [20]) | Obligation-scoped test impact analysis; partitioned lanes; flake registry with quarantine (a flaky obligation is a spec bug with an owner); rung 1 handles most landings |
| **100x** (~100–1,000/eng/day [20, 2029]) | Rung-3 replays grow with concurrency in hot lanes; humans approving obligations | Intent pre-flight moves conflict detection before work; coalesced replay; obligation reuse (most changes add 0–2 new obligations); verifier-model approval for low-tier spec deltas |
| **1,000x** | Spec-graph contention (intents contradicting intents) and *verification compute*, which falls 1.2–1.5x/yr while tokens fall about 13x/yr [20] | Sealed-eval and differential corpora become cached, content-addressed assets reused across changes; replay by region ("re-derive the module from the union of intents" replaces K ports); humans adjudicate intent conflicts only. Verification is about 75%+ of cost [12: at small-model prices CI is already about 76% of a thread-hour] |

So the long-run cost center is **proving behavior**, not generating code, and the design leans into that.

**What the forge measures** (shown per repo, per module and per generator):
- landed-without-revert by intent size;
- **replay success by rung**: correct / escalated / later-reverted (with the "incorrect but clean" class priced in [08: score resolvers the way Schesch does]);
- **regenerability %** per derived module;
- spec drift rate (hand edits without obligations);
- obligation adequacy (mutation score);
- unclaimed-diff block rate;
- hack incidence (passes visible, fails sealed);
- intent-conflict rate;
- approval carry-forward rate;
- human minutes per landed intent;
- cost per landed intent (tokens + compute).

---

## 7. Organizations of all sizes

**Solo developer.**
- Intents are one or two lines. The forge proposes 1 to 3 obligations and you accept with a keystroke.
- Run 3 to 5 parallel threads, the useful human limit [03: Symphony], landing through rungs 0 to 3.
- The replay ladder is the whole benefit: you stop rebasing agent branches by hand.
- Skip sealed evals, and skip drift probes except on the one module you plan to rewrite.
- `spec/decisions/` becomes your durable taste memory, better than an ever-growing AGENTS.md.

**10-person startup.**
- Push-to-main culture with the forge as the only lander (Amp-style isolation and reversal [brief]).
- Every non-docs change needs one new or reused acceptance obligation. Taste-class obligations go to the founder or designer through the comparison view.
- Spec deltas on money and auth need a human; everything else gets verifier-model approval.
- A weekly 30-minute "spec garden" on the drift queue.
- Expect about 80% of landings with no human touch.

**200-person scale-up.**
- Path tiers (docs / normal / UI / money-auth-migrations) as policy over proof.
- Invariant owners replace CODEOWNERS. Decisions registry with scopes.
- Intent pre-flight on by default. Partitioned lanes. Sealed evals on tier 2 and up.
- Risk-weighted sample audit of 2–5% of auto-landed changes.
- Generator upgrades gated by shadow replay.
- A platform team owns the verification fabric. In this design they are the most leveraged engineers in the company [20: Scenario C].

**5,000-person enterprise (including regulated).**
- Everything above, plus:
  - formal specs or reference models for regulated paths;
  - named human approval on every invariant change and every `irreversible` change;
  - segregation of duties enforced by principal type;
  - ledger export to SIEM and GRC;
  - generator lockfile pinned per business unit, with model changes treated as a controlled change.
- Cross-repo intents: one intent, M repos, with an atomic landing group per repo and a shared obligation set. Migrations of about 1,000 PRs [01: Block] become one intent with coalesced replay per lane.
- Keep human code review mandatory on `pinned` regions. Ronacher's warning that hands-off loops rot durable code applies most there [11].

**Open-source projects.**
- Outside contributors submit **an intent plus a failing obligation** (a reproduction, property or eval case), not a diff.
- The maintainer's pinned generator derives the code, and the *receiving* forge produces the proof [14: proof must be regenerated by the receiver]. This is what openai/codex already chose: no external PRs, because reimplementing is cheaper than reviewing [04].
- Contributions of evals and reproductions become the high-status contribution. curl showed that valid but unmanageable *volume* is the real problem [10], so intents get gated:
  - one open intent per new contributor;
  - vouching (Ghostty-style) to raise the cap;
  - the maintainer's pre-flight dedupes intents against open ones (23% of rejected agent PRs are duplicates [13]).
- Sealed evals protect projects from contributors who fit to the tests.

---

## 8. Evolution as intelligence gets cheaper

**2027 (Scenario A1: 1–3-day delegable unit, $0.5–5 per expert-hour [20]).**
- Most landings use rungs 1–2. Rung 3 is the differentiator, and rung 4 is rare.
- Regenerability is low (scaffolds, clients, CRUD, UI) and specs are thin: mostly existing tests plus acceptance obligations.
- Main value: conflict handling without humans, proof that resists gaming, a ledger.
- The reference diff is still the primary artifact for anyone who reads code.

**2029 (A2: failures are mostly *specification* failures [20]).**
- Spec diffs become the default review surface, and code diffs collapse for derived regions.
- Drift probes push app-layer regenerability past about 60% [assumption]. Framework upgrades become "re-derive region from intents" (coalesced replay as a migration tool).
- Intent pre-flight is where most conflicts die.
- Humans spend most of their time on obligations, decisions and intent conflicts: 30 decisions a day is a full day [20].

**2031 (A3/D: binding constraint = trust, accountability, environment fidelity [20]).**
- For derived regions, the behavioral diff *is* the change. Regeneration on generator upgrade is routine, gated by shadow replay.
- The decisions registry and invariants are the company's engineering memory.
- The ledger is the compliance product.

**Gets more important over time:**
- obligations and sealed evals (the attack surface moves to the spec [14]);
- decisions;
- behavior fingerprints and differential corpora;
- verification compute economics;
- intent-conflict adjudication;
- generator governance;
- reversibility classification;
- the ledger.

**Shrinks or disappears:**
- textual and structured merge tooling (rung 2);
- line-level blame (replaced by intent lineage);
- human reading of derived-region code diffs;
- per-change hand-written unit tests (they become JiT and ephemeral; Meta already generates tests from inferred intent and does not store them [09]), while *durable* tests shrink to invariants and contracts;
- the reference diff as a human artifact (it remains a cache and audit record);
- full transcripts as a sharing medium (Scenario D is where the thread bet loses [20]).

**Never disappears:** `pinned` regions and stored code. A spec complete enough for crypto, kernels or protocols *is* the code [20: Scenario D exclusions].

---

## 9. Verdict on the user's ideas

**(a) Almost-headless forge that clones, runs affected tests and auto-resolves conflicts: partially agree.**
- *Agree* on a headless data plane and on affected-test selection. Anthropic's CI jobs grew 25x in 6 months and its test-selection patches lasted 70d, 29d and under a day [01]. Stripe runs a median 0.5% of its suite [09]. Agents push 3.35B times a month on GitHub [05].
- *Disagree* that the forge should "resolve conflicts" in the text sense:
  - git `ort` silently merges 3% incorrectly, and aggressive tools 11–50% [08];
  - LLM hunk resolution matches developers 45–62% of the time, with 34–42% wrong code [08];
  - textual conflicts are the minority problem, and semantic conflicts that merge cleanly are the expensive one [08: Crystal, 1% build and 6% test failures among merges].

  What works is **re-deriving from intent on the new base plus fresh proof** [08 verdict], which is this design's rung 3. Some conflicts are real disagreements of intent, and a human must decide those.
- *Disagree* on "almost no human intervention" as a general claim. Every company with a published policy keeps a human gate [09], and Amp says its model fits 20 people, not 2,000 [brief].
- My version: **headless for code, headed for specs.** Humans leave the code-landing loop and stay in the obligation-change loop, which is far smaller.

**(b) Share threads instead of issues/PRs; threads in sandboxes, many in parallel, orchestrated: partially agree.**
- *Agree* threads are the unit of work, and that sandbox-per-thread and parallelism are right [17: isolation per writer is necessary per the CAID ablation].
- *Disagree* that the thread is the thing to *share*:
  - transcripts run past 21M tokens, human prompt text is 0.4% of bytes, and nobody reads them whole [18];
  - Amp removed public thread sharing over secret leakage [18];
  - the leading OSS signal (openai/codex) wants intent plus evidence, not code or transcripts [04];
  - "thread" is already industry vocabulary and not a differentiator [17].

  Share the **intent** with its obligations and proof. The thread is a cache of how the intent got derived, just as the code is.
- On orchestration: threads coordinating through messages fail. CooperBench found communication does not help [13], and approval laundering is a real failure [17]. Coordinate through the shared **intent registry and pre-flight**, not through agent chat.

**(c) Humans move to tastemaking; live previews like Amp portals are necessary: partially agree.**
- *Agree* previews are necessary for UI-bearing changes. Amp portals are used for exactly this, and Cursor merges >30% from cloud agents with video and screenshot artifacts [11].
- *Disagree* that taste is the whole job, or that previews are enough:
  - the taste practitioners keep is often *engineering* taste (invariants, abstractions), which no preview shows [11];
  - CodeRabbit finds AI PRs have 1.7x the issues, with security up to 2.74x and I/O about 8x, none of which is visible in a preview [11];
  - in 2027 most of the human day is *writing intents and obligations* (about 40%) [20], not judging pixels.
- Taste also has to be **captured** (Decisions, golden screens) or it does not scale. With 500 landings and 30 decisions, a human touches about 6% [20].

---

## 10. Failure modes, and the strongest objection

**Failure modes and mitigations:**
- **Vague intents that anything satisfies** ("improve onboarding"). Mitigation: an intent must carry at least one falsifiable acceptance obligation unless it is tier docs. The pre-flight model flags unfalsifiable goals.
- **Obligation gaming and spec weakening.** Mitigation: content-addressed obligations, a different principal for spec deltas, sealed rotating variants, mutation adequacy [14].
- **Claimed surfaces too broad** (an intent that "claims everything" disables the differential). Mitigation: claims are capped by risk tier, and wide claims escalate.
- **Replay entropy.** Each port rewrites style, so the codebase churns. Mitigation: the 2x diff-size bound, the reference diff as an anchor, and decisions plus golden examples loaded into every replay. GitClear's duplication +81% [13] is the base rate this has to beat.
- **Nondeterminism and noise.** Replays differ run to run. Evals swing 6pp with infrastructure settings [01]. Mitigation: noise-floored differentials, per-task resource specs recorded in the proof, flake quarantine, and pass^k rather than pass@k on gating obligations.
- **Model deprecation** makes old derivations unreproducible. Mitigation: code is stored forever, and the derivation record is used for audit, not replay.
- **Rubber-stamping spec diffs.** PRs merged with no review rose 31.3% [11]. Mitigation: spec-delta approvals show the counterexample the change makes newly legal ("before: refund of 101 on a 100 charge rejected; after: accepted"), not the YAML.
- **Cost blowups after large migrations.** Mitigation: coalesced replay, per-lane replay budgets, and a "rung 4 requires a human go-ahead above $X" rule.

**Strongest objection.** "A spec complete enough to regenerate code *is* code, in a worse language. The industry has tried this repeatedly (CASE, MDA, Tessl's spec-as-source, which it has since moved away from [18]). Böckeler found spec markdown tedious, said she'd rather review code, and saw agents ignore specs [18]. You will produce a second, drifting source of truth that people stop maintaining."

**My answer.** The objection is right about spec-as-source and wrong about this design, for four reasons:
1. **I do not claim specs are complete.** Code stays stored and authoritative for "what runs". Regenerability is *measured* per module, and nothing depends on it being 100%.
2. **The day-one payoff needs only a weak spec.** Porting one change onto a new base (rung 3) needs the intent, the reference diff and the obligations the change itself added. Agents are already good at this: Cursor's hundreds of workers and Anthropic's 16 agents cope with conflicts this way [08], and Symphony's Rework throws the worktree away and restarts from scratch [03].
3. **The spec is executable obligations, not prose.** It is mostly tests, evals and properties, which practitioners already maintain. Prose is generated, so Böckeler's verbosity tax disappears and "agents ignore specs" stops mattering: an ignored obligation fails.
4. **Drift is made visible and owned.** Drift probes turn "the spec is incomplete" into a nightly queue of concrete amendments with a regenerability trend line. If the line does not rise, the forge has told you, cheaply, that Scenario D is not happening for that module, and you have lost nothing.

---

## 11. A day in the life

*Ledgerly, a 200-person payments scale-up. Monorepo, ~1,100 derived modules, 140 pinned. Thursday.*

- **08:12.** Priya (product engineer) types into the intent composer: "Merchants can issue partial refunds from the charge drawer." The intent agent returns `I-7Q2`:
  - 5 obligations: 3 new acceptance evals, invariant `INV-billing-007` (refund total ≤ captured amount), and `DEC-112` (amounts in integer minor units);
  - claimed surfaces: `/charges/:id` drawer, `POST /refunds`.

  Priya deletes one proposed obligation ("emails customer"; that is a separate intent) and signs. Time spent: 2 minutes.
- **08:13. Pre-flight.** It finds Marco's open intent `I-7P9`, "rename `Money.amount` → `Money.minor` and add currency-aware helpers", overlapping 31 symbols. It is compatible, so it is advisory only and both sponsors are notified.
- **08:14.** Three candidate threads start on Sonnet-class models. Each costs about $1.10 in tokens and $0.30 in verification.
- **09:40. Comparison view.** Dana (designer) sees three running previews. A uses a modal, B an inline stepper, C an inline form. She picks C and taps "capture". `DEC-131` ("inline refund form in drawer; no modal for single-field actions") is drafted and confirmed, and her approval is recorded against C's behavior fingerprint.
- **09:52.** Marco's rename lands: 214 files.
- **10:05. Landing `C-8812`.**
  - Rung 1 fails: textual conflicts in 9 files. Rung 2 clears 2 of them.
  - Rung 3: a replay thread gets `I-7Q2`, `D0`, `I-7P9`'s intent and diff, and the symbol-move map (`amount`→`minor`, in 31 places).
  - 11 minutes later, `D1` is 6% larger than `D0`. All 5 obligations pass, and the 4 neighbor obligations from `I-7P9` pass.
  - The differential on `/charges/:id` and `POST /refunds` is claim-equivalent. Dana's approval carries forward: golden-screen diff 0.3% (font hinting).
  - Cost of the replay: $0.85 tokens + $0.40 CI. Lands at 10:19 behind flag `refunds_partial` (reversibility: `revertible`).
- **11:02.** Another team's perf thread, `I-7R4`, tries to make a slow test pass by loosening `INV-billing-007`'s property generator. The obligation hash changes, so a spec delta is detected.
  - It routes to Tomás (staff eng, billing invariant owner), with a counterexample: "a refund of 10,001 on a 10,000 capture now passes."
  - He rejects with one sentence, and the thread goes to `Blocked: obligation conflict`.
  - 40 minutes later the perf thread finds the real fix, an index on `refunds.charge_id`.
- **14:30. Drift report.** The probe on `payouts/scheduler` fails claim-equivalence: the current code skips Japanese bank holidays and no obligation says so. The forge drafts `O-jp-holidays` from a recorded production input. Tomás accepts it, and the module's regenerability goes from 71% to 78%.
- **16:45.** Priya flips `refunds_partial` to 10%.
- **Day totals:**
  - 2,410 landings and 318 intents;
  - 2,050 landed at rungs 0–1, 96 at rung 2, 61 replays at rung 3 (58 landed, 3 escalated), 2 at rung 4, 2 intent conflicts adjudicated by humans;
  - 74 human approvals in total;
  - $6.1k in tokens and $4.3k in verification compute;
  - 0 humans resolved a text conflict.

---

## 12. What to build first (6-week MVP) and what never to build

**MVP on Cloudflare (Workers + Artifacts + Sandboxes + Durable Objects + D1 + R2):**

- **Week 1. Objects.**
  - `intent.yaml` format (goal, non-goals, obligations as test/eval IDs, claimed surfaces, sponsor).
  - Change objects in `refs/forge/changes/*` with `Change-Id:`/`Intent:` trailers; Intent Durable Object; D1 index.
  - Intent composer that drafts obligations from a one-liner.
- **Week 2. Forge-run proof.**
  - Separate verifier sandbox and signing key; in-toto statements bound to commit digest and pinned Workers Preview deployment ID.
  - Path classes, with spec-delta detection (any change under `spec/` or test paths needs a second principal).
- **Week 3. Landing service, rungs 0, 1 and 3.**
  - A per-repo trunk Durable Object; `Accept()` with neighbor obligations.
  - The rung-3 replay thread (intent + reference diff + intervening intents + symbol-move map).
  - This is the demo's centre: a collision resolved by re-deriving from intent and caught on the combined state.
- **Week 4. Behavioral differential.**
  - Recorded request corpus replayed against two pinned preview deployments; claimed vs unclaimed diffs; approval carry-forward on golden screenshots (Browser Run).
- **Week 5. Obligation governance and honesty.**
  - Sealed eval variants in a verifier-only repo; `Blocked: obligation conflict` state; mutation check on changed lines for one language.
- **Week 6. Surfaces and measurement.**
  - Decision inbox; spec-diff view; comparison view for N=3 candidates.
  - Ledger page; replay-by-rung metrics.
  - One drift probe running nightly on 3 modules, with a visible regenerability number.

**Never build:**
- Spec-as-source enforcement ("GENERATED FROM SPEC — DO NOT EDIT" across the tree). Tessl walked away from it [18], and `pinned` regions must stay hand-editable.
- A markdown spec authoring IDE. Specs are executable obligations, and prose is generated.
- Server-side LLM hunk resolution that lands without `Accept()` [08].
- CRDT live co-editing of code [20: low-value bet].
- Transcript sharing as the primary collaboration medium [18].
- A learned taste model before explicit Decisions and golden examples exist [20].
- Our own coding agent or orchestrator UI. Orchestrator startups are dying [17]; the forge is the substrate they call.
- Any path by which an agent's self-reported evidence, or a peer agent's message, counts as approval [14][17].

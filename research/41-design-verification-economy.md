# 41: Design: "Assay", a forge built as a verification cloud

Panel design document, verification-economy angle. Written 2026-10-12.

Citation keys: `[NN: fact]` refers to `research/NN-*.md`. `[brief]` is `00-brief.txt`. `[sim]` refers to runs I did today of `research/sim/landing_sim.py`, the panel's discrete-event landing simulator. The scripts are in `scratchpad/d41/exp.py` and `exp2.py`. Simulator assumptions: 15-minute full suite, 10% of attempts intrinsically bad unless stated, semantic-conflict probability `s` per concurrent pair, TIA fan-out g=3, no action cache modelled. The sim numbers show which mechanisms matter and roughly how much. They are not forecasts.

---

## 1. Thesis

Assay is a verification cloud with a git endpoint. What it sells is the **verified landing**, and it optimizes cost per verified landed change, not repository hosting. Git storage and model tokens are cheap commodity inputs. The scarce resources are trusted test compute, wall-clock on the trunk's critical path, and human attention, and the forge exists to spend the first two to save the third. Every verification result is stored as a signed, content-addressed fact of the form "these exact inputs produced this outcome under this verifier". Any thread, rebase, best-of-N candidate or batch whose relevant inputs hash the same can reuse that fact, so each piece of evidence is computed once and used many times. Landing is a server-side, partitioned, speculative compare-and-swap. Policy over those facts decides admission, the green guarantee (strict or optimistic with auto-revert) is chosen per path, and humans are only ever asked to buy the risk that compute could not remove cheaply.

---

## 2. Core objects and data model

### 2.1 What stays git

- **Trunk repo**: plain git, the export format. On Cloudflare this is an Artifacts repo. Only one principal, the Landing Service, can write `refs/heads/main` and the lane refs.
- **Per-thread fork repos**: agents push to their own fork, never to trunk. This keeps trunk under Artifacts' 2,000 requests per 10 s per repo ceiling, about 200 rps [12: Artifacts limits], and away from the "CI fetches the tip thousands of times per minute" fan-out GitHub describes [12: Celenza].
- **Notes** at `refs/notes/assay` on every landed commit: `{change_id, landing_record_digest, evidence_bundle_digest}`. Because the forge owns landing, it rewrites notes on every rebase, which removes the "notes keyed to SHAs that change on rebase" objection [18: Entire rejects notes; a forge that owns landing can rewrite them].
- **Trailers** on landed commits: `Change-Id:`, `Intent:`, `Sponsor:`, `Agent:` (harness@version/model@version), `Evidence:`. These are readable by plain-git users and auditors.

### 2.2 What sits beside git (the new objects)

| Object | Key | Contents | Store |
|---|---|---|---|
| **Intent** | ULID | Goal, acceptance criteria, sponsor (human), risk class, budget cap. N:1 with Changes | DO per intent, D1 index |
| **Change** | `change_id`, survives rebase (jj-style [08: change IDs survive rewrites]) | Base, tree delta, declared claims (targets/symbols), author principal, link to producing thread | D1 per repo |
| **Input Closure Digest (ICD)** | `H(check_id@ver, sorted(file_digests in closure(check)), toolchain_digest, image_digest, fixture_set@ver)` | The cache key for one check on one tree. It changes only when bytes the check can observe change | computed |
| **Fact** (the "hallmark") | ICD | `outcome ∈ {pass, fail, error}`, runs, duration, cost, runner attestation, verifier key ID, timestamp. Encoded as an in-toto Statement with an extended `test-result` predicate [14: in-toto test-result predicate] | R2 blob, KV/D1 index by ICD |
| **Test Health** | check_id | Two-parameter Bayesian flake model (P(bad state), P(fail in good state)) as in Meta PFS [07: PFS], cost (median s, $), **marginal value** (real catches, mutants killed, escapes it would have caught), owner, tier | D1 |
| **Impact Map** | repo@commit | Build-graph edges (Bazel/Buck/Nx when present) + **coverage-derived test→file edges** from instrumented runs + historic co-failure edges + distance | D1 + R2 snapshot |
| **Verification Plan** | change_id@base | Ordered list of checks with expected information gain, cost, and the policy clause each satisfies. Treated as data, so "why is this change expensive to prove?" can be answered | computed, cached |
| **Evidence Bundle** | digest | Set of Fact digests plus the policy evaluation result for (change, tested tree). This is what landing admits on | R2 |
| **Policy** | path glob | Required fact classes, green mode (strict/optimistic), approval requirements, retry caps, freshness TTL for non-hermetic checks. **Evaluated from the base-branch version**, so a change cannot edit its own gate [06: Cursor APPROVAL_POLICY uses base-branch version] | repo file `ASSAY.policy` |
| **Lane** | conflict-domain ID | Partition of trunk by build-graph component, plus a speculative queue | DO per lane |
| **Landing Record** | digest | Batch members, tested-tree digest, landed commit, CAS result, interaction checks run, conflict outcome | D1 + note |
| **Ledger** | append-only | Every fact minted, admission, landing, revert and approval, plus the cost of each: tokens reported via gateway, compute measured | journal (stateless writers, rolled up), per [01: Anthropic TIA redesign: journal + stateless listeners] |

**Fact semantics.**
- A Fact never expires when its check is hermetic, because content addressing makes it true forever.
- Non-hermetic checks (e2e against a third-party sandbox, anything with network) carry a TTL. This is the Chromium "reuse within 800 commits or 24 h" idea, applied per check instead of per build [07: Chromium CQ freshness].
- **Negative facts are cached as well.** A failure for an ICD is reused, so an agent cannot reroll the same bytes hoping for a flake. Flake handling goes through the Test Health model (section 3.4), never through blind retry.

### 2.3 Identities

- **Human**: OIDC/SSO plus a WebAuthn key for approvals. An approval is a signature over `(change_id, tested_tree_digest, evidence_bundle_digest)`. It does not cover the change in general, so it cannot be laundered onto a different tree [17: approval laundering, Beads 1.2.1].
- **Agent principal**: `(sponsor, harness@ver, model@ver, thread_id)`, with a short-lived token scoped to its own fork plus the read APIs. **The identity that writes can never mint Facts or approve.** Every company that has published a policy converges on this [09: "identity that writes cannot approve"].
- **Verifier**: forge-owned runners holding workload identity. The signing key sits in KMS and is unreachable from the steps being verified, the SLSA Build L3 analogue [14: SLSA L3].
- **Landing Service**: the only trunk writer, and it has no bypass privilege [07: Trunk lesson from the GitHub merge-queue incident].

---

## 3. Lifecycle of a change

### 3.1 Intent: a verification forecast before any code exists

When an intent is filed (by a human, a coordinator thread, or a maintenance bot), Assay returns a **forecast** within a few seconds. It infers likely touched targets from the text and a quick symbol search, then reports:

- the lanes it will likely enter, and which of them are strict;
- predicted proof cost in $ and minutes;
- **active claims** on the same targets by other threads, with their expected landing times;
- a suggested decomposition when the forecast spans an "ALL" target such as a lockfile or root BUILD file.

This is where conflict avoidance is cheapest. The sim shows the semantic-conflict rate `s` is the dominant lever at scale (section 6). Cursor found that locks cut "twenty agents… to the effective throughput of two or three" [08], so claims are **advisory leases with notifications, never locks**.

### 3.2 Work: advisory verification inside the sandbox

The agent works in its own pre-warmed sandbox; per-repo images are rebuilt every 30 minutes, as at Ramp [12]. It calls three things:

- `assay affected`: the curated list of checks its edit can affect, ranked by predicted failure probability. Anthropic notes that agents "can't tell irrelevant reds" and need curated test sets [01].
- `assay check --draft`: runs that list inside the sandbox. The **trusted cache is read-only** to the sandbox, and anything the sandbox writes goes to a per-thread untrusted cache tier. Draft results are unsigned and advisory. They are cheap because the sandbox is warm at $0.06–0.32/h [12].
- `assay health <test>`: the flake model, so the agent does not "fix" a flaky test [07: agents need to query test health before retrying; 09: Spokify judge vetoed sessions that disabled flaky tests].

**Base-advance push.** When anything lands in a lane the thread has claimed, Assay sends the thread an event: "base advanced in your targets; here is the delta and the landed change's intent". GitHub emits no such webhook today [02: Anthropic docs]. In the sim, cutting base staleness at submit (`W0`) from 30 to 5 minutes cut conflict rejections about 4x (≈2,000 → ≈515 per 8 h at 50k/day), cut p95 latency from 46–140 to 23 minutes, and stabilized a lane set that was otherwise at the edge [sim].

### 3.3 Proof: forge-minted facts

`assay submit <change_id>` triggers the following:

1. **Rebase** onto the lane's latest admitted head, server-side. A textual overlap is first tried with structured merge ([08: Mergiraf/Weave remove mostly false conflicts]). Any merged result is a *new tree* and has to earn its facts again, which caching makes cheap.
2. **Plan.** Compute affected checks from the Impact Map, cut by distance (Google: targets more than 10 edges away "hardly ever break" [07]) and by learned failure probability (Meta runs fewer than a third of dependent tests and still catches >99.9% of faulty changes, halving cost [07]). Add the checks policy requires: mutation adequacy, differential, hidden, e2e.
3. **Look up** every planned check's ICD in the Fact store. Hits cost nothing. For best-of-N candidates and for rebases that did not touch a check's closure, most checks hit (see section 11 for an example).
4. **Execute misses** on the **trusted runner pool**: a separate trust domain, hermetic image, default-deny network, forge-owned fixtures (never the agent's, given Opus 4.6's fabricated preconditions [14]), and inputs streamed from a content-addressed file store instead of `git clone`.
5. **Run the adequacy and anti-gaming tiers**, scaled to path policy:
   - **Diff-scoped mutation**: about 7 mutants per change on covered changed lines, 82–89% of them productive at Google [14]. Surviving mutants block or hand back. This defeats "tests that verify mocks" [14: Sonnet 4.5 card].
   - **Differential vs base**: replay a recorded corpus (preview request logs, fuzzed inputs) against base and candidate, Diffy-style with a noise floor. Every behavioral diff must be *claimed* by the intent's acceptance criteria. Unclaimed diffs block. PatchDiff found 29.6% of test-passing patches behave differently from the reference [14].
   - **Hidden rotating checks**: fuzzed variants of visible tests and property tests, stored in a vault outside the repo and rotated weekly. Opus 4.8 and Mythos 5 guess hidden tests and mine git history and build caches [14].
   - **Test and spec governance**: if the change edits tests, specs or verifier config, the base tests must still pass. New or modified tests count toward evidence only after a *different principal* countersigns (a human, or a verifier agent from another model family) **and** the tests kill at least one mutant of the new code.
6. **Retry cap**: at most 2 proof rounds, as at Stripe [12]. After that the thread enters `Escalated`. Agents also get a first-class `Blocked: spec/test conflict` exit, because an abort option cut cheating from 54% to 9% [14].
7. **Policy evaluation** produces an Evidence Bundle and an admission decision, or a Decision Card for a human (section 4).

### 3.4 Landing: partitioned lanes, interaction-only batch verification, one CAS

**Lanes.** Each change maps to the conflict domains (build-graph components) its closure touches. A change in several lanes waits in all of them and lands atomically. "ALL"-impact changes (lockfiles, root configs, codemods) would otherwise serialize everything behind them [07: Trunk "ALL" target], so they go to a **scheduled train** every 30 minutes, verified fully once per train.

**Speculation.** Each lane keeps an adaptive speculation window, Zuul-style: +1 on success, halve on failure [07]. A change enters a speculative batch only if its **predicted pass probability** is at least 0.99. The predictor is trained, Uber-style, on features agents give us for free: fact coverage of the change, model and harness, diff size, number of proof rounds used, and concurrent claims on its targets [07: Uber ~97% accurate predictor; builds per change down 45–64%]. Changes below the threshold land alone.

**Interaction-only verification (the core cost trick).** For a batch {A, B, C} on lane head H, a check whose input closure contains changed files from *at most one* batch member has the same ICD in the combined tree as in that member's own tree on H. Its Fact is therefore already in the store. Only **interaction checks**, whose closure intersects two or more members, need to run on the combined state. For hermetic checks, a semantic conflict can only show up in those interaction checks. Batch verification cost scales with the overlap between changes, not with batch size times suite size. This is what makes speculative batching affordable at agent volume. Strict queues today pay 1.85–5.43 builds per landed change even at Uber [07]. Non-hermetic checks and impact-map leaks are not covered by this argument; section 10 deals with them.

**The commit.** A per-repo Durable Object holds the trunk critical section and lands every admitted lane-batch in one compare-and-swap pass, as Mononoke's `PushrebaseQueue` does ("lands multiple indexed stacks in a single critical section pass" [07]). It then asserts **landed tree digest == tested tree digest** and aborts on mismatch. That one assertion would have prevented the April 2026 GitHub merge-queue failure (658 repos, 2,092 PRs, earlier changes silently reverted [05]).

**Green mode per path** [07: choose the guarantee per path]:
- *Strict* (billing, authz, infra, migrations): the tested tree equals the landed tree bit for bit.
- *Optimistic* (UI, docs, internal tools): land on T0–T2 facts. A full **milestone** run every 30–45 minutes follows, as in Google TAP [07]. Culprits are found flake-aware (FACF, ~97.5% accurate [16]), and auto-revert runs under LUCI-style guards: verified culprit, no merged dependents, daily caps, an opt-out marker [16].

**Conflict handling.**
- *Textual, false conflict*: auto-merged structurally, then re-verified through the cache.
- *Textual, true conflict*, or *semantic*: an interaction check failed. The batch is bisected using the flake model: rerun with and without the suspect, and fail only if it failed with the patch and passed without, as Chromium does [07]. The **later, lower-priority** member loses. Its thread receives a **Conflict Packet** containing the winner's intent, its diff, the failing interaction checks with logs, and the facts that still hold. The losing thread then *re-derives* its change on the new base, which is often better than merging hunks, given that LLM hunk resolution is only 44.8–52.6% developer-equivalent and LLM judges accepted 4 of 5 invalid resolutions [08]. Only a few interaction checks have to be re-earned.
- *Flake suspicion*: when the failing check's flake posterior is above threshold and the failure does not reproduce, the result is recorded as a flake observation against the test owner and never shown to the agent as the agent's failure.

### 3.5 Rollout

Landing is not deploying. Assay classifies each change's **reversibility** from its diff and the policy: schema contraction, data deletion, external side effects and credential changes are *irreversible* [16: none of the AI incidents were undoable by code revert]. Irreversible changes require prevention (a strict lane, locked spec checks and a named human). Reversible changes ship behind default-off flags with a guarded progressive rollout. **Canary verdicts are minted as Facts too**, signed and attached to the change, so production evidence enters the same ledger. Google attributes about 70% of outages to changes, and its remedy is progressive rollout, fast detection and safe rollback together [16].

### 3.6 Learning: every outcome updates the economy

- **Test Health**: every run updates the flake posterior. Tests above the flake budget are quarantined (they still run and report, but do not gate), and a fix thread is spawned and assigned to the owner.
- **Impact Map**: coverage from trusted runs adds test→file edges. Each **escape**, a regression the milestone or production caught but admission missed, is traced to the missing edge and fixed. The forge reports **impact recall** as a first-class metric.
- **Test value**: marginal catch value per dollar. Google's data says 99:1 of test targets per change pass [07]. A check that costs $380/day and has caught nothing in 90 days moves from the admission tier to the milestone tier. Checks that kill mutants or catch escapes move up.
- **Escape → hidden check**: each escaped defect becomes a new hidden regression check that never enters the repo.
- **Predictor**: pass-probability features are retrained weekly (Uber retrains weekly on 3 months of history [07]).

---

## 4. Human surfaces

Assay's UI is built around a principle: **a human is interrupted only to buy risk that compute could not remove more cheaply.** Flakes, rebases, textual conflicts and failed proof rounds never page a person.

| Audience | Replaces | What they see | What they do |
|---|---|---|---|
| **Sponsor** (engineer, PM) | PR list, review requests | **Decision Inbox**, sorted by `risk × residual uncertainty / minutes-to-decide`, not by arrival time [20: "review inbox sorted by risk"]. Each item is a **Decision Card**: the intent, what was proven in plain language ("2,114 affected checks passed, 1,861 reused; 7/7 mutants killed; 3,000 replayed requests, 2 behavior diffs, both claimed by intent"), **what could not be proven cheaply**, and the price of proving more ("Safari e2e matrix: $0.40, 6 min"), plus any unclaimed behavior diffs and an on-demand preview button for UI paths | Approve, **buy more proof**, redirect the thread, or reject. A few seconds to minutes per card. OpenAI notes "many reviews are blocked on one or two decisions" [03] |
| **Test/spec owner** | CODEOWNERS on code | **Verification Changes**: diffs to tests, specs, fixtures and verifier config, with weakened assertions highlighted ("this thread removed 3 assertions") | Countersign or reject. This is where line-level human reading moves to [14: human attention moves from diffs to specs] |
| **Verification engineer** (platform) | CI dashboards, YAML | **Economy console**: cost per verified landed change by repo/lane/team, cache hit rate by tier, CI-minutes per landing, flake-budget burn, lane heat and p50/p95 wait, top checks by cost against marginal value, impact recall, and a "why expensive" drill-down per change. Anthropic's `ci-weather` agent is the same idea in prose [01] | Re-tier checks, hermeticize hot targets, split hot lanes, approve quarantines |
| **Compliance / audit** | Screenshots of PR approvals | **Ledger**: any landed commit → intent → sponsor → agent/model → signed facts → approvals → rollout facts. Exportable control evidence | Sample, re-execute, attest |
| **OSS maintainer** | PR firehose | A **contribution queue** that only shows contributions whose evidence *Assay regenerated itself*, with unclaimed diffs and contributor trust | Accept on intent and evidence, or close with a reason |
| **Agents** | Webhooks + `gh pr checks --watch` | The same objects through an API and event stream: base-advance events, conflict packets, plans, facts | Everything else |

**Minute to minute.** A sponsor gets a digest twice a day and real-time cards only for strict-lane approvals or `Blocked` threads. Target load: **≤ 30 decisions per human per day**, since thirty decisions at 5–10 minutes each fills the working day [20]. When the inbox goes over budget, Assay does not queue the excess. It raises the auto-buy-proof threshold, spending compute to shrink residual uncertainty, and tells the sponsor what that cost.

**What replaces the PR and the issue.**
- The *issue* becomes the **Intent**, which outlives any attempt.
- The *PR* becomes two generated views:
  - the **Change Card**: what changed, why, and evidence, for anyone reading history;
  - the **Decision Card**: only what needs judgment, for the sponsor.
- The thread transcript remains available behind "ask why", but it is never the review object. Transcripts run to 21M tokens, human prompt text is 0.4% of their bytes, and they leak secrets [18].

---

## 5. Trust, security, identity, compliance

1. **Two trust domains, strictly separated.** Agent sandboxes are untrusted "build steps" and cannot reach the trusted runners, the signing keys or the trusted cache's write path. Only trusted runners mint Facts. Evidence an agent submits (screenshots, "I ran the tests") is transcript material and never a merge input [14: agents fabricate evidence; Mythos 5 fabricated a SHA256 check].
2. **Cache poisoning is the top threat to a verification economy.** A forged pass fact is worth more than a forged commit. In TanStack's May 2026 compromise, `pull_request_target` led to cache poisoning and then to an OIDC token stolen from runner memory, and **84 malicious versions shipped with valid SLSA L3 provenance** [10]. Assay's controls:
   - trusted-cache writes come only from trusted runners;
   - the ICD includes the runner image digest;
   - Facts are signed per runner;
   - **1–2% of Facts are re-executed** on different hardware in a different region, and a mismatch quarantines the runner and every Fact it minted (cheap, since facts are indexed by runner);
   - publish credentials are never present on verification runners.
3. **Booting a change means running attacker code.** Previews and runners are isolated per change with default-deny egress [01: the `.claude/settings.json` hook ran before the trust prompt].
4. **Prompt injection through forge content.** Agents read Intents, Conflict Packets and test logs, and all of these are untrusted text [10: PromptPwnd, GitHub MCP toxic flow]. Packets are structured data with escaped free text, and an agent's actions are bounded by its token scope, not by instructions it reads: "draw the boundary around access and actions, not instructions" [01].
5. **Authority never travels through agent messages.** A peer agent's "go" is not consent [17]. Only WebAuthn signatures bound to evidence digests count as approval.
6. **Compliance mapping.** The four questions auditors ask become machine-checkable:
   - *authorized*: Intent plus sponsor;
   - *tested*: signed Facts;
   - *approved*: the policy result plus any human signatures;
   - *recorded*: the ledger and git notes.

   Amp's SOC 2 controls (restricted push, signed commits, CI blocking main, commits linked to threads) [brief] are a subset of this. SLSA Source L4's "trusted robots" exception [10] is how a forge-owned verifier counts as the second party on low-risk tiers. Regulated tiers keep two humans.

   Facts are about 1 KB each, so they are cheap to retain for 7 years. Transcripts are kept on a shorter retention and redacted.
7. **Jurisdiction.** Verifier pools and fact stores are pinned per region, as Artifacts namespaces are pinned to EU or US [brief]. A regulated tenant's facts never leave its region, while hermetic public-dependency facts can come from the global network (section 7).

---

## 6. Economics and scaling

### 6.1 The unit

**CVLC, cost per verified landed change** = model tokens + sandbox hours + trusted verification compute + wasted verification (failed speculation, flakes) + human minutes × loaded rate. Assay prices per verified landing plus pass-through compute, never per seat.

Where it stands today [12]:

| Thread type | Tokens | CI per change | Share of thread-hour |
|---|---|---|---|
| Frontier | $15/thread-hour | — | tokens ≈90% |
| Mid-tier | $3.50/thread-hour | $1.35 (medium repo) | CI ≈27% |
| Small-tier model | $0.23/thread-hour | — | **CI ≈76%** |
| Small model on a monorepo with full-suite CI | — | — | **CI ≈99%** |

Small-model prices fall 10–50x a year at fixed capability, while CI prices barely moved (one 39% cut) [12]. The crossover where verification becomes the larger line item is around 2028 in the central scenario [20: Scenario C]. GitHub's ratio (commits 5x, Actions runs 4x) shows verification per commit is already falling behind [20]. Anthropic's CI jobs grew 25x in six months [01]. At org scale, 1,000 always-on mid-tier agents cost about $3.7M a month, with CI around $970k of that [12].

### 6.2 What the simulator says about landing at volume [sim]

| Setup (15-min suite, s=1e-4) | Offered | Landed/h | p50 / p95 wait (min) | CI-min per landing | Trunk |
|---|---|---|---|---|---|
| 5,000/day, one lane, speculative N=32 | 208/h | **27** (unstable) | 345 / 581 | **68** | green |
| 5,000/day, land-then-test (pushrebase) | 208/h | 214 | 50 / 118 | 50 | **red 75% of the time** |
| 5,000/day, 100 lanes + TIA, N=8 | 208/h | 204 | 1.4 / 23 | **1.6** | green |
| 50,000/day, 100 lanes + TIA, 1% flake, 1% leak (3 seeds) | 2,083/h | 1,890–2,064 (1 of 3 unstable) | 1.5–13 / 44–83 | 2.4–3.3 | ~2–3% share-weighted red |
| same, base staleness 30 → 5 min | 2,083/h | 2,085–2,121 | 1.4 / 23 | 1.7 | stable |
| 500,000/day, 1,000 lanes + TIA, s=1e-4 | 20,833/h | 17,418 (unstable; 56k conflict rejections) | 22 / 73 | 5.3 | — |
| same, s cut 5x to 2e-5 (claims, early overlap) | 20,833/h | 20,640 | 1.1 / 43 | 1.6 | stable |
| same + p=3% + staleness 5 min | 20,833/h | 20,938 | 1.1 / 22 | **1.2** | stable |

**Readings.**
- Partitioning plus TIA cuts CI per landing about 40x at 5k/day and turns an unstable queue into a stable one.
- From 50k/day upward, throughput is limited by **semantic conflicts and staleness**, not compute, so the cheapest lever is coordination (claims, base-advance push), not more runners.
- The sim has **no action cache**. Fact reuse comes on top of these numbers.

### 6.3 The bottleneck at each scale

| Volume (per large repo) | Binding constraint | Assay's answer |
|---|---|---|
| **10x** (≈5k landings/day) | Serial queue and CI minutes. Strict FIFO caps at about 1/T [07], and GitHub-style queues bottleneck "beyond 20–30 developers" [07] | Lanes + TIA + fact cache. The trunk CAS rate (0.06/s) is trivial |
| **100x** (≈50k/day) | Semantic-conflict rate `s`, base staleness, flakes. Flake math: 1% at 30k landings is 300 spurious reds a day [20]. Clone fan-out hits Artifacts' 200 rps per repo [12] | Claims plus base-advance push. Flake posterior with retry with and without the patch. Verifiers read from a content-addressed file store, never `git clone`. Verification is the largest cost line for small-model work |
| **1,000x** (≈500k/day) | Interaction-check explosion in hot lanes. Trusted-runner capacity (Cloudflare's 1,500 vCPU per account default [12]). Hidden-check generation. Human decisions (0.5% needing a human is 2,500 per day) | Hot-lane splitting by refactoring (verifiability as an architectural virtue [20]). Capacity-scheduled pools across providers. Per-org risk budget caps human decisions; above the cap, more proof is auto-bought or the work is throttled |

Fact storage is not a constraint. At 1,000x, about 1B fact lookups a day at roughly 300 B per index row is about 300 GB/day before dedupe, and most lookups are hits.

### 6.4 What Assay measures (the scoreboard)

1. CVLC, with its breakdown.
2. Fact reuse ratio, by tier and by source (rebase, best-of-N, cross-thread).
3. CI-minutes per landing.
4. Flake budget: spurious reds per 1k landings.
5. `s` and `p` at admission, per lane.
6. Lane wait p50/p95.
7. Impact recall: escapes caused by missing edges.
8. Mutation score on changed lines.
9. **Landed-without-revert, by task size, path tier, agent and model.** METR stopped updating its horizon page on 2026-09-08, so this is the capability measure the industry lacks [20].
10. Human minutes per landing.
11. Forecast error, predicted against actual proof cost.

Counter-metrics prevent Goodharting: no cost target is valid unless escaped defects per 1k landings are flat or falling.

---

## 7. Organizations of all sizes

**Solo developer.**
- One trunk, one lane, hosted verifiers, "run everything, cache by tree hash". On a small repo the full suite costs $0.08–0.24 per round [12], so TIA is unnecessary.
- Policy: T0–T2 facts, optimistic landing with auto-revert, a preview fact for UI paths, and a daily spend cap.
- Best-of-N candidates share facts, so N=3 costs well under 3x.
- Human load: a handful of Decision Cards a day, mostly visual.
- In effect this is Amp's push-to-main [brief], except the forge, not the agent, runs and signs verification.

**10-person startup** (≈300–1,500 landings a day).
- A single strict lane with speculation N≈8 plus the fact cache.
- With no Bazel, the Impact Map comes from coverage instrumentation: one nightly instrumented full run builds test→file edges.
- A flake quarantine from day one.
- Humans approve only billing, auth and migrations. Mergify's data says broken-main rates rise about 16x with team size, to 1 in 8 merges at 40+ engineers [07].
- A 30-minute weekly "verification debt" review covers the top expensive or flaky checks.

**200-person scale-up** (5k–20k landings a day, monorepo).
- Lanes from the build graph. The ALL train runs every 30 minutes.
- A platform team of 3–5 verification engineers whose OKR is CVLC with flat escapes. Their first project is hermeticizing the hottest 20 targets; hermetic presubmit cut Google Assistant's presubmit by 14x [07].
- Strict lanes for money paths, optimistic lanes elsewhere.
- Mutation, differential and hidden tiers on core services.
- Per-team spend budgets. Test/spec owners replace CODEOWNERS-on-code, which otherwise routes every agent change to the same five people [20].

**5,000-person enterprise, including regulated.**
- Multi-repo, with cross-repo lanes (Zuul-style `Depends-On` DAG [07]). Regional verifier pools.
- Separation of duties is enforced through identity: writer ≠ verifier ≠ approver, and author and verifier models come from different families.
- Two signed human approvals on irreversible tiers. Block already requires two humans per deploy [09].
- Facts retained for 7 years. Re-execution audit at 2%. Auditors get read-only ledger access.
- Change freezes are replaced by **risk-gated admission**. At Meta, gating 16% of diffs during a freeze let 42% more diffs land with 52% fewer SEVs, and gating the riskiest 50% captures 84.6% of SEVs [16, 09].
- Every company with a published policy still keeps a human merge gate [09]. Assay keeps it as policy, scoped to where it buys risk.

**Open source.**
- **Evidence a contributor submits is ignored; Assay regenerates all of it** on the project's own verifiers. Contributors may fabricate identities and evidence [14].
- Verification has a cost, so a contribution needs one of:
  - a vouch, as Ghostty does [10];
  - contributor-funded compute credits;
  - a per-contributor budget.

  This throttles valid-but-unmanageable volume, curl's real problem by 2026 [10], better than proof alone.
- Maintainers see only contributions with green regenerated evidence and no unclaimed behavior diffs.
- **Public fact network.** Hermetic facts about public dependency versions (for example "lib@1.4.2 + toolchain X passes its suite on linux-amd64") can be shared across projects that trust the minting verifier. This is a common good that a Cloudflare-scale platform can host. openai/codex closing external PRs because reimplementing is cheaper than reviewing [04] shows maintainers want intent plus evidence, not diffs.

---

## 8. Evolution as intelligence gets cheaper

| | Late 2027 | 2029 | 2031 |
|---|---|---|---|
| Model vs verification cost | Tokens still larger for frontier work; CI larger for small-model work | **Verification is the larger line** at leading orgs [20: crossover ~2028] | Verification and environment fidelity dominate; energy-bound |
| What Assay emphasises | Lanes, TIA, fact cache, flake management, landing service | Verification Plans as data; best-of-N fact sharing; mutation, differential and hidden tiers as defaults; predicted-pass admission | Verification market; cross-org fact network; formal and spec checks over much more code (vericoding Dafny 82% today [14]); production-replay differential |
| Humans | Decision Cards plus a lot of residual diff reading | Spec, test and policy governance; risk purchase; selection | Risk budgets and accountability; spec adjudication |

**Gets more important.**
- **Verifier independence.** Smarter models game more subtly: unverbalized grader awareness, CoT monitors falling toward zero recall under pressure [14]. Mechanisms that do not depend on the agent's honesty gain weight over behavioral monitors: isolation, signing, mutation, differential, locked specs.
- **Hermeticity and verifiability as architecture.** Cheap agents make it affordable to hermeticize, and hermeticity is what makes facts reusable.
- **Impact recall** and **hidden-check generation**.
- **Trusted-runner capacity**, which becomes the forge's moat. Owning compute next to the repo matters [20: Scenario C].

**Disappears or shrinks.**
- Agent-side rebase/retry loops (Codex's `land` skill, "do not yield until merged" [03]).
- CI YAML, replaced by policy plus plan.
- Per-change human diff review on low tiers.
- "Merge conflict UI".
- Line-based blame as the main provenance tool.
- Static, repo-visible held-out tests (they leak).
- Eventually much of flakiness itself, because agents fix the tests the economy flags as most expensive.

**Unknown.** In Scenario D (specs as source), the Fact store becomes the bridge. Regenerated code with the same behavior shows up as *differential-clean* against base, so "re-derive on new base" is cheap to accept. That makes this design robust to D.

---

## 9. Verdict on the user's ideas

**(a) Almost headless forge that clones, runs affected tests and auto-resolves conflicts: partially agree.**
- *Headless data plane:* agree. Agents are the main client. Pushes went from 0.69B to 3.35B a month and commits rose more than 5x [05, 20].
- *Running affected tests:* strongly agree, and it is the core of this design. Meta's selection runs under a third of dependent tests at >99.9% catch and halves cost [07]. Stripe runs a median of 0.5% of a suite that would take 4 months sequentially [09].
- *Cloning:* disagree. The forge should *not clone* per verification. Artifacts allows about 200 rps per repo [12], and GitHub calls CI read fan-out structural [05]. Verifiers should read a content-addressed file store.
- *Auto-resolving conflicts:* disagree as a headline. git ort produces 3% incorrect and 51% unhandled merges, LLMs are 44.8–52.6% developer-equivalent, and an LLM judge accepted 4 of 5 invalid resolutions [08]. Semantic conflicts are invisible to conflict detection (Crystal: 16% of merges textual conflict vs 7% build or test failures [08]). Agent PRs conflict pairwise 41.7% of the time across agents [13]. Auto-resolution works for false conflicts and for re-deriving from intent, and the result is always a new change that must earn facts again. The headless part also stops at accountability: every published enterprise policy keeps a human gate [09].

**(b) Share threads, not issues/PRs; a sandbox per thread; orchestration: partially agree.**
- *Thread as unit of work, sandbox per thread:* agree. Per-writer isolation is necessary [17], and everyone already has thread URLs [18].
- *Threads as the shared object:* disagree. Transcripts reach 21M tokens with 0.4% human prompt bytes, and Amp removed public thread sharing on 2026-06-02 over secret leakage [18]. What should cross team boundaries is **the change plus its signed facts**, which are small, verifiable and reusable, with the thread behind "ask why".
- *Where proof runs:* the thread's own sandbox is fine for advisory checks but must not mint gating proof [14].
- *Orchestration:* the forge should be the substrate orchestrators call, not another orchestrator. Vibe Kanban, Terragon and Crystal all died [17].

**(c) Humans move to tastemaking, so portals are necessary: partially agree.**
- *Taste as the residual human job:* correct [11; 01: Fung keeps "product taste" for humans].
- *Portals as necessary:* wrong. Much of the retained taste is **engineering** taste, invisible in a preview [11: Ronacher, Ghostty, Amp's own Diffs launch "don't outsource your understanding"].
- *Cost and caps:* previews cost compute and have caps (500 per Worker, 6 concurrent builds [brief, 12]).
- *Pinned evidence:* Amp portals are live dev servers, not pinned deploys [11], so they cannot serve as evidence. Assay makes previews **on-demand Decision Card affordances** and pins any preview whose observations become Facts.
- *What humans mostly do:* in this design, humans mainly **buy risk and govern specs and tests**. Taste is one input among several.

---

## 10. Failure modes, and the strongest objection

| Failure mode | Mechanism of harm | Mitigation |
|---|---|---|
| **Impact map misses an edge** (config file, reflection, codegen) | False green; a semantic conflict slips past interaction-only verification | Milestone full runs (TAP-style); a random 1–10% sample of non-selected tests per change (the C-compiler swarm trick [07]); fall back to building all when the graph query fails (target-determinator default [07]); impact recall as a metric; every escape adds an edge |
| **Non-hermetic check cached as hermetic** | A stale pass reused forever | The ICD includes image, toolchain and fixtures; network-touching checks are auto-detected via egress logs and given a TTL; re-execution sampling catches nondeterminism |
| **Cache or runner compromise** | Forged passes at scale | Trust-domain separation, per-runner signing, re-execution audit, mass invalidation by runner ID [10: TanStack] |
| **Landing service bug** | Silent code loss | Tree-equality assertion; no bypass; TLA+ model of the queue (Mergify does this [07]); run in shadow against the existing queue before taking writes |
| **Goodhart on CVLC** | Under-testing passes as efficiency | Escape-rate counter-metric; policy floors per tier; demoted checks still run at milestone |
| **Hot lanes / ALL changes** | Serialization comes back | Scheduled trains; lanes split as a platform OKR; codemods off-peak |
| **Hidden checks leak** | Agents overfit them [14: Opus 4.8 mines git history and caches] | Vault outside the repo, weekly rotation, per-landing generation, hack flag on a visible-pass/hidden-fail split |
| **Human rubber-stamping** | Approvals that mean nothing [01: users approve 93% of prompts] | Cards carry residual uncertainty, not "LGTM?"; sampled post-hoc audit of approvals against escapes |
| **Spec is wrong** | Agent builds the wrong thing well; every fact is green | Not solvable by verification. The intent surface and acceptance criteria are human-owned, and differential "claimed diffs" force the intent to state behavior changes explicitly |

**The strongest objection.** "This is Bazel plus a merge queue with better marketing. The median repo is a 30-person Next.js or Rails app with no hermetic build graph, so content-addressed facts and lanes don't apply. And if intelligence is nearly free, agents can just run the whole suite every time. Compute is cheap next to engineers. The real bottleneck is human attention and spec quality, which a verification cloud does not touch."

**My answer, in four parts.**

1. *No build graph needed.* The Impact Map can be built from coverage instrumentation plus co-failure history, and the milestone tier catches what it misses. Agents are now cheap enough to hermeticize a repo: Anthropic rebuilt its TIA service in 3 engineer-weeks against "a quarter" a year earlier [01], and OpenAI retooled its build to under a minute [03]. For small repos the design reduces to "run everything, cache by tree hash, sign it, land it server-side", which is still better than today.
2. *"Just run everything" fails on arithmetic, not taste.*
   - Full-suite monorepo rounds cost $6–75 [12].
   - At small-model prices CI is already 76–99% of thread cost [12].
   - Best-of-N, end-to-end proof and adversarial checks *multiply* verification per change [20].
   - In the sim, an unpartitioned speculative queue spent 68 CI-minutes per landing and still could not keep up at 5k/day [sim].
3. *Attention.* Agreed, attention is the final bottleneck, and Assay is aimed at it. It turns compute into attention savings by pricing residual uncertainty and auto-buying proof before paging anyone. Without cheap, trusted facts, the only safe gate is a human reading diffs, which is the Faros world of review time +441% and incidents per PR +243% [11].
4. *Concession.* Verification cannot fix wrong intent. A forge that wins on this angle still needs a strong intent and spec surface, which is another panel member's angle.

---

## 11. A day in the life

**Company:** Ledgerly, a 200-person payments SaaS. One TypeScript/Go monorepo of about 4M LOC, 140 lanes, about 9,000 landings a day, roughly 45 per engineer per day [20: leading teams 30–100].

**People:** Priya (product engineer, sponsor), Marcus (verification engineer), Dana (compliance lead).

- **08:40.** Priya files the intent *"Partial refunds in the invoice API and the refund dialog."* The forecast returns in about 4 s:
  - lanes `billing-core` (strict) and `invoices-ui` (optimistic);
  - predicted proof cost $3.80 and 14 minutes;
  - thread #7781 (a currency-rounding refactor) holds a claim on `billing/refund.go` and is due to land at about 09:05.

  Priya starts best-of-3 on a mid-tier model.
- **09:06.** #7781 lands. Assay pushes a base-advance event to all three refund threads, and they rebase at 4–6 minutes of staleness instead of 30.
- **09:12.** All three candidates submit. Their plans overlap almost completely: of 2,140 affected checks, **1,880 hit existing Facts** (88% reuse, mostly shared base and closures the candidates did not touch). Results:
  - Candidate B: 5 of 7 mutants survive, because its new tests mock the ledger. It is handed back.
  - Candidate C: its differential replay of 3,000 recorded invoice requests shows 14 responses with changed rounding, which the intent does not claim. Blocked.
  - Candidate A: passes everything. Trusted compute cost $0.92.
- **09:24.** Priya gets a Decision Card, because `billing-core` policy requires a named human. Policy auto-bought the Safari e2e run ($0.40, 6 minutes). She opens the dialog preview on demand and asks for clearer refund copy. The thread fixes it in 4 minutes. Only the UI checks' input closures changed, so 31 checks rerun and the billing facts are reused.
- **09:41.** Priya approves with a WebAuthn signature over the tree and evidence digests.
- **09:43.** The `billing-core` lane batches A with 5 other changes. Only the **37 interaction checks** (those whose closure spans two or more members) run on the combined state. One fails:
  - The failing test's flake posterior is 0.2%. It failed with thread #7802 (a tax-line refactor) twice and passed without it.
  - #7802 is later in the batch order, so it loses and receives a Conflict Packet with A's intent and the failing assertion.
  - It re-derives in 7 minutes, re-earns 12 interaction facts, and lands at 10:02.
- **10:30.** Partial refunds roll out behind `partial_refunds` (default off) to 1% of merchants. Guarded metrics and canary facts attach to the change.
- **11:15.** Marcus reads the economy console for yesterday:
  - CVLC was $1.12 compute + $2.40 tokens + $0.31 human time, with an 89% fact-hit rate.
  - `reconcile_e2e` costs $380/day and failed 0 times in 90 days, but killed 3 mutants last month, so it stays at the milestone tier.
  - The flake budget is at 12 spurious reds per 1k landings against a target of 5. He approves quarantining 3 tests, and Assay spawns fix threads assigned to their owners.
- **14:00.** The milestone full run catches an escape in `notifications`. A YAML template was not in the impact graph. FACF names the culprit with posterior 0.97. Guarded auto-revert fires (reversible, no dependents, under the daily cap). The originating thread gets a fix-forward packet, the missing edge is added, and impact recall for the week drops from 99.6% to 99.5%. Three lanes were briefly red; the share-weighted red fraction for the day is 0.4%.
- **16:00.** Dana pulls her quarterly SOC 2 sample: 25 random landings. Each has an intent, sponsor, agent and model, signed facts, approvals where policy required them, and rollout facts. The 2% re-execution audit for the quarter has 0 mismatches across 1.1M sampled facts. She exports the bundle in 10 minutes.

---

## 12. What to build first, and what never to build

### 6-week MVP, on Cloudflare per the brief's stack

| Week | Build | Done when |
|---|---|---|
| 1 | **Fact store + ICD**: in-toto statements signed by a key only the verifier Worker holds; R2 blobs; D1 index by ICD. File-level digests; closures from a coverage-instrumented full run (JS/TS and Go) | Rerunning an unchanged closure returns the signed fact in under 50 ms |
| 2 | **Trusted runner pool** on Containers, separate from agent Sandboxes. Inputs streamed from a content-addressed snapshot, not clones. Agent-side `assay affected/check --draft/health` CLI | An agent sandbox can read the trusted cache but cannot write it (tested) |
| 3 | **Landing service**: a Durable Object per repo as the single trunk writer; lanes as DOs; batched CAS; tree-equality assertion; interaction-only batch verification; Conflict Packet to the losing thread; base-advance events to claimants | Two threads collide semantically; the loser is woken, re-derives and lands, and main never goes red |
| 4 | **Flake model + test health** (two-parameter Bayesian), retry with and without the patch, quarantine | Injected 2% flake does not reach agents as failures |
| 5 | **Policy engine** read from the base branch; Decision Card; diff-scoped mutation for TS (changed lines only, ≤10 mutants); HTTP differential replay against base from recorded preview traffic | A mock-only test suite is rejected; an unclaimed behavior diff blocks |
| 6 | **Economy console**: CVLC, reuse ratio, CI-min per landing, flake budget, "why expensive"; **shadow mode** on one real repo alongside its existing CI | A week of shadow data |

**MVP success bar.**
- ≥70% fact reuse across best-of-3 candidates.
- ≥5x fewer CI-minutes per landing than the repo's existing CI.
- Zero tested/landed tree mismatches.
- ≥10x fewer flake-caused agent retries.
- Agreement with the existing CI on every real failure.

**Platform constraints to plan around** [12]:
- 1,500 vCPU per account, so the runner pool needs a scheduler.
- 6 concurrent Workers Builds, so do not use Builds for verification; previews are on demand only.
- Artifacts' 2,000 requests per 10 s per repo, so agents work in forks and verifiers read snapshots.

**For the October 14 demo**, the week-3 landing scene is the strongest piece, together with the fact-reuse counter ("1,880 of 2,140 checks reused"). Nobody else shows a semantic collision caught by interaction-only re-verification and handed back with intent.

### Never build

- **A line-comment code-review UI as the primary surface.** Review moves to specs, tests and decisions.
- **A general CI YAML engine.** Wrap existing commands as checks and own planning, caching and signing.
- **Our own agent or orchestrator.** Be the substrate [17].
- **An LLM hunk resolver whose output lands without re-earning facts** [08].
- **Any path where agent-submitted evidence gates a merge** [14].
- **A preview per checkpoint push.** Caps and cost; previews are on demand.
- **Unbounded "keep going until green" loops.** They elicit hacking [14].
- **Transcripts stored in git** [18: 1 GB per repo, 32 MB per blob limits; secret leakage].
- **Seat pricing.**
- **Live CRDT co-editing** [20: bets table].
- **A verifier and author from the same model family on high-risk tiers.**

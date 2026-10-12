# 46 — Design: the minimal-delta forge ("Keel")

Panel angle: **the skeptic.** The claim tested here is that most of the value of an "agent-era forge" comes from evolving today's stack (git, GitHub or GitLab, stacked PRs, merge queues, AI review, agent sessions) rather than from replacing it. The goal is to find the smallest set of new primitives that are truly necessary, build only those, and build them so they can move between hosts.

Written 2026-10-12. Evidence is cited as [file-key: fact]. File keys are the research files in this directory: `00-brief`, `01-anthropic`, `02-anthropic-news`, `03-openai`, `04-codex`, `05-github`, `06-forges`, `07-monorepo-ci`, `08-merge`, `09-industry`, `10-oss`, `11-taste`, `12-econ`, `13-agent-prs`, `14-proof`, `16-reversal`, `17-orch`, `18-provenance`, `20-scenarios`, and `sim` for the landing simulator in `sim/landing_sim.py`. The simulator is still in progress and its parameters are assumptions (15-minute CI, 10% of attempts bad, 1% flake), so treat its outputs as indications, not measurements.

---

## 1. Thesis

The forge of the future is mostly the forge of today. Git storage is being rebuilt by at least six funded teams, and agent sessions, AI review, stacks and previews are already sold by the incumbents. What nobody sells is a **thin, host-neutral layer that owns four things**: (1) a change identity that survives rebase, (2) evidence the platform produces and signs, (3) a per-path policy that decides over that evidence, and (4) a landing service that lands on that verdict, hands conflicts back to the agent that caused them, and records the outcome. Keel is that layer. It runs today as a GitHub or GitLab App. Its records live outside the host so the trunk can move to a faster host when the numbers say so, and not for ideological reasons. Everything else in the "new forge" pitch (threads replacing PRs, headless operation, automatic conflict resolution, CRDT co-editing, learned taste models) is either already commodity, belongs to the agent vendor, or is premature.

---

## 2. Core objects and data model

### 2.1 What we deliberately do *not* store

- **Git objects.** The host stores them. "The git layer costs almost nothing" [12-econ: Artifacts ops ~$0.03 per 200-push thread; storage ~$0.10/month]. Storage at agent write rates is being solved by GitHub (35x write throughput, Azure Blob plus stateless compute) [05-github], Cursor Continuity (120–300+ pushes/s per repo) [06-forges], GitLab ("50x faster" next-gen source control) [05-github], Cloudflare Artifacts, Entire, ERSC and Pierre [06-forges]. A seventh storage engine adds nothing.
- **Transcripts.** Agent vendors already keep them, with stable URLs and commit trailers (`Claude-Session`, `Amp-Thread-ID`, `Entire-Checkpoint`) [18-provenance]. Transcripts are huge (Amp's longest thread was more than 21M tokens uncompacted; git-ai records "tens of MB" per session). Human prompt text is 0.4% of the bytes [18-provenance]. They also leak secrets: Amp removed public thread sharing on 2026-06-02 because of it [18-provenance]. Keel stores a link and a distilled record, never the log.
- **Sandboxes and previews.** These belong to the agent vendor or the deploy platform (Vercel, Workers Previews, Modal, Devboxes). Keel asks for one when policy needs it and keeps only the pinned URL and the evidence produced against it.

### 2.2 The four objects Keel stores

All four live in a sidecar store: Postgres for a self-hosted install, or one SQLite or D1 database per repo on Cloudflare [00-brief: D1 10 GB cap, one DB per tenant]. Each object is keyed so that it is meaningful without the host.

**Change** — the logical unit that survives rebase, restack and host migration.

```
Change {
  change_id      // ULID; written into every commit as trailer `Change-Id:` (Gerrit-compatible)
  repo, base_ref
  intent_ref     // issue/Linear/Jira URL or inline intent text (<= 2 KB)
  sponsor        // named human principal (OIDC subject)
  agent          // agent principal: vendor, harness, model+version, pool
  session_url    // link to the vendor thread (Claude-Session / Amp-Thread-ID / Codex thread)
  record         // distilled, <= 10 KB: intent, decisions + rejected alternatives, risks, open questions
  impacted       // computed impacted build targets (Bazel/Buck/Nx) or path prefixes as a fallback
  risk_class     // derived: tier 0-3 + reversibility class (see section 5)
  state          // drafting | proving | ready | landing | landed | handed_back | blocked | abandoned
  head_tree      // tree hash of the current candidate
  cost           // model $ (reported by the agent vendor) + verification $ (measured by Keel)
}
```

The `Change-Id` trailer is the primitive the incumbents lack. Evidence and approvals attach to a logical change, not a SHA. That is what Mergify names as unsolved ("change-level identity that survives rebase") [07-monorepo-ci]. GitHub has solved it only partly, by keeping approvals on rebased stacks [05-github]. Gerrit and jj have had it for years [08-merge].

**Claim** — advisory, short-lived, computed rather than declared.

```
Claim { change_id, targets[], paths[], symbols[]?, lease_expires, intent_summary }
```

A claim is created at the first push and refreshed on every push from the impacted-target computation. An agent can also declare one up front, before writing code, through the MCP tool `keel.claim`. Claims are **never locks**. Cursor found that locks made "twenty agents … slow down to the effective throughput of two or three" [08-merge].

**Evidence** — an in-toto statement, signed by the runner that produced it.

```
Evidence {
  subject: { change_id, tree_hash, impacted_input_hash }   // what was proven
  base:    commit the proof ran against
  predicate_type: test-result | mutation | differential | preview-run | ai-review | human-approval | perf
  producer: keel-runner (trusted) | agent (advisory only)
  payload_ref: R2/S3 URL (logs, screenshots, recordings)
  signature: Sigstore / runner key
}
```

This reuses standard formats: the in-toto `test-result` predicate, SLSA, and GitHub artifact attestations [14-proof]. The `impacted_input_hash` is what makes evidence reusable. A proof stays valid after a rebase as long as nothing that landed in between touched the change's impacted inputs. That is the precise form of Chromium's "reuse within 800 commits / 24 h" window and Shopify's freshness-gated queue [07-monorepo-ci, 09-industry].

**Verdict** — policy output, with a reason, stored and pinned to the policy version.

```
Verdict { change_id, tree_hash, policy_sha (always the BASE branch's), lane: strict|optimistic,
          outcome: land | needs_human(role, what_to_look_at) | blocked(reason), evidence_used[] }
```

The policy files themselves live in the repo (`.keel/policy.yaml`, scoped per directory). Keel always evaluates the **base-branch** version, so a change cannot relax its own gate. Cursor's `APPROVAL_POLICY.md` uses the same rule [06-forges].

### 2.3 Identities

- **Humans** come from the organisation's IdP through the host's SSO.
- **Agent principals** are `agent:<vendor>/<pool>` acting **on behalf of** a sponsor. Keel issues short-lived, branch-scoped git credentials through a git proxy. An agent can push only to `keel/<change_id>/*` and can never write the trunk. Claude Code's cloud proxy already works this way [01-anthropic: "git proxy holds token, pushes only to own branch"].
- **Keel's lander** is the only identity allowed to update protected refs (a single ruleset bypass actor). That puts into practice the one rule every published company policy shares: *the identity that writes cannot approve* [09-industry].
- **Authority never passes through agent messages.** An approval is evidence of type `human-approval`, signed by the human's own session. Neither "Alice said ok" in a relayed agent message nor an agent asking another agent to push counts [01-anthropic: privilege escalation caught at the human gate; 17-orch: approval laundering in Beads 1.2.1].

### 2.4 Relationship to git

Commits carry trailers: `Change-Id`, `Sponsor`, `Agent`, `Session`, `Assisted-by`. Trailers survive every client and every host, which is why Entire chose them over notes [18-provenance]. Because Keel owns landing, it also writes `refs/notes/keel` on each landed commit, pointing to the Change and its Verdict, and it rewrites those notes itself when history is rewritten. That fixes the usual objection to notes [18-provenance]. Lines are attributed using the Agent Trace / git-ai formats; Keel reads them and does not invent a format [18-provenance].

---

## 3. Lifecycle of a change

### 3.1 Intent

An intent is an issue, a Linear ticket, a Slack thread, or a line typed into a session. Keel does not replace the tracker. The orchestration surface has already converged on "tracker as control plane" (Symphony, Claude Code Projects, Linear agent sessions) [03-openai, 17-orch], and orchestrator startups keep dying (Vibe Kanban, Crystal, Terragon) [17-orch]. Keel needs only a URL or a 2 KB intent text on the Change.

### 3.2 Work

The agent runs wherever it runs: a Claude Code cloud session, Codex, an Amp orb, Cursor cloud agents, or a laptop. On its first push to `keel/<change_id>/…`:
1. Keel computes `impacted` (target-determinator, `nx affected`, buck2 change-detector, or path prefixes as a fallback) [07-monorepo-ci].
2. Keel upserts the Claim and checks it against all live claims. If two claims overlap on a target, Keel sends an **overlap notice** to both sessions through the vendor's webhook or MCP channel, carrying the other change's intent summary and diff stat. Whether they coordinate, wait, or proceed is left to the agents and their sponsors. This addresses the measured problem: 79.4% of agent PRs are open at the same time as another agent PR in the same repo, and 41.7% of cross-agent pairs conflict textually [13-agent-prs]. It also fills a gap Anthropic names: "Claude doesn't get notified about merge conflicts with the base branch", because GitHub sends no webhook for that [01-anthropic, 02-anthropic-news].
3. Each later push to the change re-runs the overlap check. When base advances into the change's impacted targets, Keel sends a **base-moved** event. GitHub does not emit this event, and it is the single most useful addition for agents.

### 3.3 Proof

When the agent calls `keel.submit(change_id)`, or opens a PR in a mirrored workflow, Keel builds a **verification plan** from the base-branch policy for every path the change touches, then runs it on **forge-controlled runners**. These are the customer's own CI (Actions, Buildkite), started by `workflow_dispatch` with the test list computed by Keel. The test harness and protected test directories are checked out **from base**, never from the change.

- **Affected tests only** (TIA). Meta runs fewer than a third of dependent tests and still catches more than 99.9% of faulty changes at half the cost [07-monorepo-ci]. Stripe runs on average 5% of its suite (median 0.5%) [09-industry].
- **Diff-scoped mutation** for code tiers 1 and above. Google's approach surfaces a median of 7 mutants per change, and 82–89% are rated useful [14-proof].
- **Differential versus base** on the selected tests. 29.6% of test-passing SWE-bench patches behave differently from the reference [14-proof].
- **Held-out checks** per path, invisible to agents and rotated [14-proof].
- **Preview run**, only where policy asks for it (UI paths). Keel requests a pinned deployment, drives it with a headless browser, and records the result as `preview-run` evidence. It is produced on demand, not per push, because previews are capped (500 per Worker, 6 concurrent builds ≈ 180 previews/hour) [12-econ].
- **AI review** as one evidence type. Findings count only if they carry proof, which is Anthropic's rule [01-anthropic: substantive comments rose from 16% to 54%]. Codex review on GitHub reports only P0/P1 [04-codex].

Anything the agent itself attached (its own screenshots, "I verified X") is stored as **advisory** and never satisfies policy. Self-grading skews positive, and "out of the box, Claude is a poor QA agent" [01-anthropic]. The TanStack incident shows platform provenance can be forged when the build runs attacker-controlled code, so tests and harness must come from base [10-oss]. A change that edits tests or policy also needs a different approver than the one who approves the code [14-proof].

**Retry cap: two proof rounds.** Stripe caps agents at two CI rounds because "CI costs tokens, compute, and time" [12-econ, 09-industry]. After the second failure the change goes to `blocked`. The agent is told it may declare the task impossible, which matters: an abort option cut cheating from 54% to 9% [14-proof].

### 3.4 Landing: exact mechanics

Keel runs one **landing lane per connected component of impacted targets**, with the queue as a DAG, in the style of Trunk lanes and Mergify scopes [07-monorepo-ci]. Each lane is strict or optimistic, chosen by policy per path.

**Common steps for every candidate C entering a lane:**
1. **Freshness check.** Read the trunk tip T. Let D be the set of changes that landed since C's evidence base. If no change in D touches `C.impacted`, C's evidence is still fresh. Otherwise go to step 3.
2. **Textual rebase on the server** (Mononoke pushrebase semantics) [07-monorepo-ci]. Only clean three-way merges with no overlapping hunks are allowed. A clean rebase onto a different base produces a new tree; the evidence subject is updated only if the impacted-input hash is unchanged. If the hash changed, go to step 3.
3. **Re-prove** the affected subset on the rebased tree. A failure here, or a textual conflict in step 2, triggers a **hand-back** (section 3.5).
4. **Policy evaluation** over fresh evidence produces a Verdict.
5. **Critical section.** Compare-and-swap of trunk from T to T' = T + all ready candidates in this pass whose impacted sets are pairwise disjoint (Mononoke's batched `PushrebaseQueue` does exactly this in one CAS) [07-monorepo-ci]. Before the CAS, Keel asserts the **tree-equality invariant**: the tree of T' must equal T's tree plus exactly the declared deltas, path by path. Temporary or speculative refs are never pushed to trunk. This is the direct lesson of GitHub's merge queue incident of 2026-04-23, which affected 658 repos and 2,092 PRs and silently reverted already-merged work [05-github, 07-monorepo-ci].

**Strict lanes** (billing, auth, infra, schema; tier 2–3) add Zuul/Uber-style speculation. Candidates are verified on T + predecessors with an adaptive window that grows by 1 on each pass and halves on each failure. Nothing lands that was not tested bit-for-bit as it will land.

**Optimistic lanes** (UI, docs, most app code; tier 0–1) land on fresh per-change evidence without a combined pre-test. A full post-land run then goes per lane per "milestone" (every N landings or every 15 minutes), the way Google TAP and Meta stabilization work [07-monorepo-ci]. That is how organisations above about 10⁴ changes a day actually operate.

Why partitioning comes before cleverness: in the panel's simulator, a single speculative queue (depth 32) is stable at 500 changes a day but **collapses at 5,000/day** (27 landed/h against 208 offered, p50 345 min). The same load spread over 100 target partitions with TIA lands 204/h at p50 1.4 min and 1.6 CI-minutes per landed change [sim: t_quick2, assumptions T=15, p=0.1]. At 50,000/day with 1% of dependencies the build graph cannot see, partitioned lanes keep up (2,004/h), but some lane is red at nearly every moment (share-weighted red 2.8%) [sim]. That is why optimistic lanes need post-land culprit finding.

### 3.5 Conflict handling: avoid, re-derive, re-prove; never "auto-resolve"

- **Avoid.** Use overlap notices (3.2). The lane scheduler also refuses to run two overlapping candidates in the same batch.
- **Allowed automatically.** Clean three-way merges, and structural merges that only remove *false* conflicts (Mergiraf/Weave-style), after which the impacted subset must be re-proved.
- **Not allowed automatically.** An LLM choosing between conflicting hunks and landing the result. git `ort` is wrong 3% of the time and abstains on 51%. Spork is wrong 11% of the time and IntelliMerge 50%. The best LLMs are developer-equivalent on only 44.8–52.6% of hunks. An LLM judge accepted 4 out of 5 structurally invalid resolutions [08-merge]. A resolved conflict is a **new change** and must earn its proof again [08-merge].
- **Hand-back payload.** Sent to the losing change's session through the vendor API, webhook or MCP:
  `{ conflict_kind: textual|semantic|stale, winner: {change_id, intent, record, diff, evidence summary}, failing_evidence, new_base }`.
  The agent **re-derives its intent on the new base**. This is cheap now and reliable more often than hunk-merging, and it is the one landing step no shipped product performs [07-monorepo-ci, 06-forges]. Hand-backs count against the two-round cap. A third conflict escalates to the two sponsors together, because repeated collisions usually mean the task split was wrong, not that the code needs merging.

### 3.6 Rollout

Keel does not deploy. It does three things:
1. **Classify reversibility** (section 5) and refuse optimistic lanes for changes that cannot be undone by a code revert, such as schema contraction, data deletion, protocol changes, external side effects and permission changes. "Most common reason for not being able to roll back is a change of protocol" [16-reversal]. None of the notable AI-related incidents could have been undone by a code revert [16-reversal].
2. Require a **default-off flag**, or an expand/contract plan, as evidence for tier-2+ behaviour changes. Google Cloud's June 2025 outage came from a feature that was not flag-protected [16-reversal].
3. Forward the landing log to whatever rollout tool exists (LaunchDarkly guarded rollouts, Cursor Rollouts, Argo) so that a regression links back to its `change_id` [16-reversal, 06-forges].

### 3.7 Learning

After landing, Keel runs **flake-aware culprit finding** over the landing log (FACF, about 97.5% accurate, where about 40% of "breakages" turn out to be flakes) [07-monorepo-ci]. Auto-revert follows **LUCI guards**: a verified culprit, no merged dependents, opt-out honoured, daily caps. Fix-forward goes back to the originating session as a hand-back [16-reversal]. Every outcome updates the ledger (section 6.3).

---

## 4. Human surfaces

The core skeptical claim on surfaces: **do not build a new place people have to go.** Every product that tried a new dashboard for agent work has either become a chat surface or died. Yegge's users wanted "someone to talk to", so the Mayor replaced dashboards [17-orch]. Block built Buzz (channels and threads) because "the interface doesn't keep up with 45 agents" [01-anthropic]. Keel's human surfaces are views placed where people already are.

| Audience | What they see | Where | Replaces |
|---|---|---|---|
| **Sponsor (engineer)** | A **decision inbox**: only changes whose Verdict is `needs_human(you)`, each reduced to the 1–3 decisions it is blocked on, plus the evidence that matters and a link to the session. Sorted by risk class, then by how long downstream work has been waiting. | GitHub PR page (Keel check summary), Slack DM digest, the vendor's agent UI | Reading every diff; the PR list |
| **Designer / PM (taste)** | A **compare card**: 1–3 candidate previews side by side with pinned URLs, the screenshots Keel took, and "pick / comment / reject". | Slack or Linear unfurl; the preview itself | Screenshot-in-PR-description |
| **Code owner of a sensitive path** | A real diff review, but only for tier-3 paths, plus a weekly **risk-weighted sample** of changes that were auto-landed on their paths. | GitHub PR review | CODEOWNERS ping on every change |
| **On-call / SRE** | The landing log as a timeline per lane, the culprit-finder result, one-click revert with its guards, and a "should we hold merges" weather report. Anthropic built `ci-weather` for exactly this [01-anthropic]. | Slack incident channel; Keel's single web page | Bisecting by hand |
| **Auditor** | From a line or a release: Change → sponsor, agent and model, Verdict with policy SHA, signed evidence. | Exported report / SIEM | Screenshots of PR approvals |
| **Agents** | MCP tools: `claim`, `submit`, `status`, `why(file:line)`, `evidence(change)`; events `overlap`, `base_moved`, `handed_back`, `landed`, `reverted`. | MCP / webhooks | Rebase-and-retry loops written into each agent's `land` skill [03-openai: Symphony "Do not yield until merged"] |

**What happens to the PR.** For tier 0–1 changes in optimistic lanes, **no PR is opened at all.** Keel lands from `keel/<change_id>` with trailers, and the Change record is the audit object. Above roughly 10x today's volume this is necessary, not optional: GitHub limits content-creating API calls to **80/minute and 500/hour**, and `GITHUB_TOKEN` to 1,000/hour per repo [05-github]. A PR per agent change at 50+ landings an hour runs straight into those limits. A PR is opened only when a human must look, and then it is a **generated rendering of the Change record**. This matches what OpenAI found: planning first made review possible because reviewers "check implementation against plan rather than reading a diff without context" [03-openai].

**Attention routing rule.** Each person has a daily decision budget (default 30; at 5–10 minutes each that is the whole day [20-scenarios]). Policy thresholds are tuned until the routed volume fits the budget. If it doesn't fit, Keel says so explicitly ("payments tier-2 needs 52 decisions/day; budget 30") instead of letting a queue grow silently. Today's failure is silent queues: median review time is up 441.5%, and the share of PRs merged with no review is up 31.3% [11-taste: Faros].

---

## 5. Trust, security, identity, compliance

**Risk classes** are computed from paths plus diff features, and the policy can override them:

| Tier | Examples | Lane | Required evidence | Human |
|---|---|---|---|---|
| 0 | docs, comments, test-only additions*, flag-off code | optimistic | build + affected tests | none |
| 1 | app code behind tests, UI | optimistic | TIA tests + mutation + differential; preview-run for UI | sampled audit (5%) |
| 2 | shared libraries, public APIs, perf-critical code | strict | tier 1 + held-out + perf evidence + flag/expand-contract | one approver ≠ sponsor |
| 3 | auth, billing, crypto, infra, schema contraction, CI/policy files, dependencies, secrets handling | strict | tier 2 + security AI review with proof | two humans; one is a code owner |

\*A change that edits tests or harness is always at least tier 2 with a different approver, because changing the tests is the cheapest way to game them [14-proof; 09-industry: Spotify judge vetoes ~25% of sessions for scope creep such as disabling flaky tests].

**Shadow mode.** Every new or loosened policy rule runs in `evaluate` mode for two weeks before it becomes `active`. Keel reports how often the rule would have disagreed with what actually happened. GitHub's coverage protection and Anthropic's new reviewers both work this way [05-github, 01-anthropic].

**Sampled audit.** A risk-weighted sample of auto-landed changes goes to humans each week. The disagreement rate is a top-line metric. If it exceeds 2% for a tier, that tier is tightened automatically. Anthropic does this today [01-anthropic: "risk-weighted sample of auto approvals reviewed by humans"]. Meta's diff-risk model, gating the riskiest 50%, captures 84.6% of SEVs [09-industry].

**Sandbox and supply chain.** Agents get no long-lived secrets and branch-scoped tokens only. Forge runners that execute agent code are treated as untrusted build steps. Signing keys are held outside them, as SLSA L3 requires [14-proof]. `pull_request_target`-style privileged triggers on untrusted code are refused [10-oss: TanStack]. Repo-resident agent config (`.claude/settings.json`, hooks, MCP configs) counts as tier-3 code, because booting a change runs attacker code [01-anthropic; 10-oss: Shai-Hulud persists in hooks].

**Prompt injection.** Keel never feeds issue, PR or comment text from untrusted authors to an agent with write capability. Hand-back payloads carry only Keel-generated summaries of the winner, plus its diff. The model follows GitHub's gh-aw: read by default, with writes going through "safe outputs" [05-github; 10-oss].

**Compliance mapping.** The four things auditors ask are authorized, tested, approved and recorded [00-brief]. In Keel these are the sponsor plus agent principal, signed evidence, the Verdict with its base-branch policy SHA (which includes human approvals where the tier requires them), and the ledger streamed to SIEM. Anthropic already sends "every agent action/approval/agent-to-agent message → SIEM" [01-anthropic]. SLSA Source L4 allows two-party review with a "trusted robots" exception [10-oss], so a signed Keel Verdict can be the robot party for tiers 0–1 if the auditor accepts it. That acceptance is where the real migration cost lies (section 7).

---

## 6. Economics and scaling

### 6.1 Where cost sits today

Per landed change in a medium repo: model spend **$0.2–3** (2027 estimate) [20-scenarios]. CI **$0.1–1.3** in a medium repo, **$6–75** per full monorepo round [12-econ]. Sandbox about 1–5% of a thread-hour. Git about $0 [12-econ]. On small models, CI is already about 76% of the thread-hour cost [12-econ]. Verification becomes the larger cost line around 2028 [20-scenarios: Scenario C]. **Keel's own cost is metadata**: a few KB per change plus some webhook traffic. Its value is entirely in the verification and attention it saves.

### 6.2 Bottlenecks by volume, for a 200-engineer org landing about 600 changes a day today

| Volume | Landings/day (peak/min) | First binding constraint | Keel's lever | Host question |
|---|---|---|---|---|
| **10x** | 6,000 (~25/min in an 8-hour peak) | A single merge queue (GitHub's MQ is FIFO with concurrency ≤100 and is a bottleneck "beyond 20–30 developers" [07-monorepo-ci]); flakes (1% flake × 6k = 60 spurious reds/day); review queues | Target lanes; TIA; freshness reuse; flake quarantine; no-PR for tier 0–1 | Stay on GitHub |
| **100x** | 60,000 (~2/s peak, Google TAP scale [07-monorepo-ci]) | Verification compute (Uber still spends 1.85–5.43 builds per landed change in strict mode [07-monorepo-ci]); human attention (200 people × 30 decisions = 6,000/day, so ≤10% of changes can get a human); host API limits | Optimistic lanes for tiers 0–1 with milestone post-land runs; tight decision budgets; batched CAS | **Move the trunk** to a host with server-side landing (Artifacts, Origin, a self-hosted Mononoke-like system, or GitLab's next-gen store if shipped); keep GitHub as a read mirror and for PR rendering |
| **1000x** | 600,000 | Coherence and entropy (duplication +81%, refactoring down to 3.8% of changed lines [13-agent-prs]); verification energy; trust | Policy refuses changes that add unrequested abstractions; cleanup agents as a normal lane; human decisions on *intents*, not changes | The trunk is a sharded, partitioned system; "the repo" is a set of lanes |

**Ref-update capacity is not the binding constraint** as long as the critical section is batched. Mononoke measures it in microseconds, and Continuity manages 120–300+ pushes/s per repo [07-monorepo-ci, 06-forges]. The binding constraints, in order, are **verification compute, human attention and flake rate**. Per the scenarios analysis, batch success needs the per-change combined-failure rate p ≤ 0.5% (90% of batches of 20 clean, against 54% at p = 3%) [20-scenarios]. Every Keel feature that runs before the queue (overlap notices, fresh-base proof, mutation, held-out checks) exists to push p down.

### 6.3 What Keel measures (the ledger)

1. **Landed-without-revert at 7 and 30 days**, by tier, path, agent/model and task size. Nobody else can measure this; METR's horizon numbers have saturated [20-scenarios].
2. **Escaped defects** (incidents linked to a `change_id` by the culprit finder).
3. **Cost per landed change**, model plus verification, and its trend.
4. **p**: the combined-state failure rate per lane, plus queue latency p50/p95.
5. **Freshness hit rate** (share of rebases that reuse evidence instead of re-proving).
6. **Hand-backs per 100 landings**, and the share resolved within the two-round cap.
7. **Flake rate per test** and spurious reds per day.
8. **Human decisions per person per day**, decision latency, and **sampled-audit disagreement rate**.
9. **Overlap-notice precision**: the share of notices that preceded a real conflict.

Anything the forge cannot measure ends up being steered by impressions. METR's RCT measured a 19% slowdown among developers who believed they were 20% faster [20-scenarios].

---

## 7. Organizations of all sizes

**Solo developer.** Do not adopt Keel. Use git and GitHub (or Codeberg), one or two agent sessions, push to main behind a pre-push hook that runs affected tests, and keep flags for anything user-visible. Amp's model of "isolation over permission, quick reversibility" works at this scale [16-reversal]. The only Keel piece worth using is the trailer convention (`Change-Id`, `Session`, `Assisted-by`), so that `why` works later. Migration cost: zero.

**10-person startup.** Stay on GitHub. Use agent sessions (Claude Code Projects, Codex, Cursor), AI review as a neutral check, GitHub stacked PRs, and previews from Vercel or Workers. Turn on Keel's **base-moved events, overlap notices and tier-0/1 auto-land** first: one policy file and the GitHub App, in an afternoon. Skip strict lanes, because the GitHub merge queue is fine below 20–30 developers [07-monorepo-ci]. SOC 2: write "policy-verdict plus sampled audit" into the change-management control now, since Macroscope already notes approving without a human "means updating SOC II guidance" [06-forges]. Expected outcome: about 60% of changes auto-land, and humans see compare cards and tier-2 decisions.

**200-person scale-up.** This is Keel's design centre. Stay on GitHub Enterprise Cloud. Requirements: a build graph (Nx or Bazel), because without impacted targets there are no lanes and no freshness. Retire the GitHub merge queue for trunk and make Keel's lander the sole bypass actor. Introduce policy files per directory, owned by the teams that own the code. Run every new rule in shadow mode for two weeks. Migration cost: roughly one platform engineer for a quarter, mostly spent getting the build graph and test-flake data into shape, which pays off regardless. Lock-in risk: low, because the Change and Evidence records are in the org's own Postgres and the trailers are in git.

**5,000-person enterprise, including regulated.** Self-host Keel in the VPC against GitHub Enterprise Server or GitLab self-managed. Leave the deploy gate human: two approvers for production deploys, as Block does [09-industry, 01-anthropic]. Tier 3 covers everything that touches regulated data. The work is **control mapping**: getting internal audit to accept a signed Verdict plus sampled audit as the approval control for tiers 0–1. Expect 6–12 months of negotiation and a pilot in non-regulated repos first. Expect auditors to keep "every PR has a named human owner", which Keel satisfies through the sponsor, and to resist "no human approval", which Keel accommodates by keeping tiers 2–3 human-approved. At around 100x, move the hottest monorepo's trunk to a landing-capable store and keep the host as the system of record for everything else. The EU Cyber Resilience Act's main obligations (December 2027, per one researcher's recollection, unverified [20-scenarios]) make the provenance ledger more valuable.

**Open-source projects.** The problem is not tooling. It is unpaid attention against unlimited supply. openai/codex stopped accepting external PRs entirely because reviewing them cost more than reimplementing [04-codex]. Even curl's high-quality AI reports (15–16% confirmed) arrive at about twice the old volume, which led curl to pause intake [10-oss]. Proof does not throttle volume. The Keel pattern for OSS:
1. Outsiders contribute **intents** (an issue with root cause and a reproduction), not code. Maintainers' own agents re-derive the fix.
2. Vouched contributors (Ghostty-style) may submit Changes, but **evidence is produced only by the project's runners**, never by the contributor's agent.
3. Per-path proof bars plus GitHub's per-user PR caps [05-github].
4. Keep the `Assisted-by:` trailer, and never accept an AI "Signed-off-by" (the Linux kernel's rule) [10-oss].

This stays on GitHub because of discoverability and network effects. A new host can win only maintainers who are already leaving (Zig, Ghostty) [05-github, 11-taste].

---

## 8. Evolution as intelligence gets cheaper

| Part | 2027 | 2029 | 2031 |
|---|---|---|---|
| Change identity + record | Important | **More important**: the record is the main thing people read | Central, where intent is the source (Scenario D) |
| Forge-produced signed evidence | Important | **Dominant cost and value** (Scenario C: verification is the larger cost line) | Priced per verified landing |
| Policy over evidence | Tiers 0–1 auto | Tiers 0–2 auto; humans approve intents, not changes | Fleet-level policies across repos |
| Landing lanes | 10x needs lanes | Optimistic lanes are the default; strict lanes only for tier 3 | Sharded trunk |
| Overlap notices / claims | Useful | Shrinks: smarter planners split work by ownership ("barely sharing code") [02-anthropic-news] | Mostly internal to orchestrators |
| Hand-back + re-derive | Core | **Grows**: re-deriving from intent becomes the default "rebase" [20-scenarios] | Same |
| Human diff review | Tier 2–3 | Tier 3 only, plus sampled audit | Audit and incidents |
| AI review as a product | Separate check | **Disappears into evidence** | — |
| PR page | Rendering for human-gated changes | Rare; record view only | Gone except for OSS |
| GitHub as trunk host | Yes | Only if it has shipped server-side landing with change identity | Mirror / social layer |
| Preview-based taste review | UI changes | Compare cards over N candidates | Captured in golden screenshots and written principles |

**What disappears:** the PR as a review unit, CODEOWNERS as reviewer routing, the merge queue as a separate product, conflict-resolution UI, and line-by-line reading as a compliance control.

**What grows:** evidence, the ledger, sponsor accountability and outcome measurement. In 2031 the bottleneck is "trust and accountability, plus environment fidelity" [20-scenarios], and those are exactly what Keel stores.

The skeptic's prediction is that **the layer survives a change of host better than the hosts survive the layer**. If GitHub ships all four primitives natively by 2028, Keel turns into a policy and evidence format plus an outcome dashboard, and that is fine.

---

## 9. Verdict on the user's ideas

**(a) Almost headless forge that clones, runs affected tests and auto-resolves conflicts.** **Partially agree. The headless data plane and affected tests are right. Auto-resolution is wrong as a headline, and "almost no human intervention" is wrong for most organisations.**
- *Agree:* agents are the main clients. GitHub saw 7.38B commits in September 2026 (more than 5x year on year) and pushes up 4.9x [05-github]. The forge should run affected tests itself, because evidence has to come from the platform, not the agent [14-proof], and TIA is proven [07-monorepo-ci: Meta runs less than a third of tests and catches >99.9% of faulty changes].
- *Disagree on auto-resolve:* automatic merging trades abstention for silent breakage. git ort is wrong 3% of the time, Spork 11%, IntelliMerge 50%. The best LLMs reach 44.8–52.6% developer-equivalence, and LLM judges accept invalid merges [08-merge]. Higher-order (semantic) conflicts make up 33% of conflicts and no textual tool sees them [08-merge]. It is also already commodity: Copilot "merge in main and resolve" (March 2026), GitLab Duo, and Meta's automatic three-way merge [05-github, 07-monorepo-ci]. The value lies in avoidance, hand-back with the winner's intent, re-derivation and re-proof.
- *Disagree on "almost no humans":* every company with a published policy keeps a human merge or deploy gate, except Amp at about 20 people [09-industry]. Faros measured +31.3% PRs merged with no review alongside +242.7% incidents per PR [11-taste]. Human gates become a *policy outcome for tiers 2–3*, not a default and not an absence.

**(b) Share threads instead of issues and PRs; a sandbox per thread; threads orchestrated by people or other threads.** **Partially agree. The thread is the unit of work, but it is the agent vendor's object, not the forge's, and it is the wrong unit to hand to a coworker.**
- Threads are already industry standard: Claude Code Projects states, Codex `thread/fork`, Amp, Linear agent sessions [17-orch, 04-codex]. A forge built around "thread" has nothing that sets it apart [17-orch].
- Sharing raw threads fails on volume (21M tokens; 0.4% human text), on secrets (Amp withdrew public sharing), and on attention (nobody reads them; tools fetch single messages) [18-provenance]. What a coworker needs is the **10 KB Change record plus evidence**, with the thread one click away. OpenAI's experience supports this: review against a plan works, and review of an unexplained diff does not [03-openai].
- A sandbox per thread: agreed and already shipped (Stripe devboxes, Ramp Modal, Claude Code cloud VMs) [09-industry, 12-econ]. It is not the forge's job.
- Threads orchestrating threads: the forge should be the **substrate** (claims, events, hand-backs) and not the orchestrator. Flat swarms fail: merge rates fell as swarms grew from 10 to 80 agents, and 876 of 980 PRs were abandoned [02-anthropic-news]. CooperBench measured about 30% lower success with multi-agent coordination [13-agent-prs].

**(c) Humans move to tastemaking, so on-demand live previews (Amp portals) are necessary.** **Partially agree. Previews are necessary for user-visible change and useless for most of what humans actually judge.**
- Taste is the residual human job, but much of it is *engineering* taste (invariants, abstractions, what belongs in core), which a preview cannot show [11-taste]. Yegge says the "last 25% of PRs need human review … taste" [11-taste]. Ronacher argues hands-off loops amplify defensive, local code [11-taste]. Duplication is up 81% [13-agent-prs].
- Humans also keep intent, risk acceptance and selection among alternatives. In Keel, previews feed the compare card for UI paths and are requested **on demand** (500-preview cap, 6 concurrent builds, about 180/hour on one Cloudflare account [12-econ]). They are never produced per push.
- Previews run untrusted code, so they need the same sandboxing and access control as any other execution [01-anthropic; 00-brief: previews public by default].

---

## 10. Failure modes, and the strongest objection

**Failure modes and mitigations**

1. **The lander corrupts trunk.** This has precedent: 2,092 PRs in April 2026 [05-github]. Mitigations: the tree-equality invariant before every CAS, no temporary refs ever pushed to trunk, a replayable landing log, and a TLA+ model of the lane protocol (Mergify did this) [07-monorepo-ci].
2. **False parallelism.** The build graph misses an edge, so optimistic lanes land combinations that are semantically broken [07-monorepo-ci: Trunk warns of "false-parallel merges"]. Mitigations: milestone post-land runs per lane, plus a periodic full-trunk run and culprit finding. A lane whose post-land failure rate exceeds 1% is automatically moved to strict.
3. **Evidence gaming.** Agents edit tests, mock the thing under test, or mine git history [14-proof]. Mitigations: harness from base, held-out rotating checks, mutation, differential testing, a different approver for test changes, and an abort state.
4. **Policy laundering and approval laundering.** Policy is always read from base. Policy files are tier 3. Approvals are signed by the human's session and never relayed [06-forges, 17-orch].
5. **Goodhart on the ledger.** Teams tune policy to inflate the auto-land rate. Mitigation: the sampled-audit disagreement rate and the 30-day revert rate are reported next to auto-land rate, and the auto-land rate is never shown alone.
6. **Flake storms.** At 100x, a 1% flake rate yields hundreds of spurious reds a day [20-scenarios]. Mitigations: Bayesian per-test flake scores, quarantine with a named owner, retry with and without the patch (Chromium), and flakes hidden from agents so they do not "fix" working code [07-monorepo-ci].
7. **Host coupling.** GitHub outages (14 status incidents in September 2026, 8 in October 1–7 [05-github]) stop landings. Mitigation: Keel's lander can target a second trunk host; this is section 7's "move the trunk" option.
8. **Incumbents ship it.** Cursor already has Graphite's stack-aware queue, `APPROVAL_POLICY.md`, Bugbot, Rollouts and Origin [06-forges]. GitHub has stacks, the async merge API, coverage gates and agent identity controls [05-github]. If they assemble the four primitives, Keel's moat is gone. Answer: publish the Change and Evidence formats as an open spec (as Agent Trace did [18-provenance]) and treat Keel as the reference implementation. In the skeptic's view, a world where incumbents adopt these primitives counts as success.

**The strongest objection.** "Minimal delta is a local maximum. You keep the PR, the host and the queue as concepts, and at 100–1000x every one of them is the wrong shape. GitHub's rate limits (80 writes/minute), its single-ref design and its reliability (19 incidents in April–May) make it a poor base. Cloudflare said outright it does not want 'today's GitHub with agents added'. You have designed exactly that."

**Answer.** The objection runs together *concepts* and *substrates*. Keel keeps today's **substrates** (git objects, the host's identity and UI, the customer's CI) because those are where the migration costs sit: Actions workflows, SSO/SCIM, audit controls, and OSS network effects. Even the challengers keep two-way GitHub sync. Origin syncs PRs "within seconds", and Zed's own repo "will remain on GitHub for now" [06-forges]. Keel does **not** keep today's concepts where they fail:
- The PR is gone for tier 0–1 changes, which is most of the volume.
- The FIFO queue becomes partitioned lanes with freshness-keyed evidence.
- Review becomes policy over signed evidence plus sampled audit.
- The conflict becomes a hand-back with intent.

The design was built so that the 100x step is a **trunk-host swap** behind the lander, not a rewrite. Change IDs, trailers, evidence subjects and policies contain nothing GitHub-specific. What the skeptic refuses is to make developers migrate *first*, before the numbers force it. Every new forge pays that cost up front and usually dies of it: the orchestrator graveyard and the "uptime on the same old primitives" contenders Zed mocks are examples [17-orch, 06-forges].

A second, weaker objection holds that keeping a human gate for tiers 2–3 cedes the future. If the sampled-audit disagreement rate and the 30-day revert rate for auto-landed tier-2 changes beat human-reviewed ones over two quarters, the policy moves tier 2 to auto. Keel makes that decision on evidence instead of ideology. Intercom's figures (AI-approved reverts 0.53% against 5.39% human) look promising but are confounded by selection [01-anthropic]. That is why Keel measures by tier.

---

## 11. Day in the life (Tuesday 2027-06-15, "Parcelworks", 210 engineers, Nx monorepo on GitHub Enterprise Cloud, Keel self-hosted)

Overnight volume: 1,180 Changes submitted. Of these, 1,034 auto-landed (tiers 0–1), 61 landed after a hand-back, 22 landed in strict lanes with human approval, 41 are waiting on humans, and 22 were abandoned after two rounds. Spend: $2,140 in model tokens and $860 in CI, against $1,410 a week earlier before freshness reuse was enabled.

- **08:52** Priya (staff engineer, payments) opens Slack. Her Keel digest lists 6 decisions, not 41 PRs. The first one: "Change 01J…Q7 (refund idempotency): two candidates. A adds a dedupe table (expand phase only; contraction scheduled as a separate tier-3 Change). B adds an in-memory LRU. Both pass; B fails held-out check `refund-replay-after-restart`." She approves A with one click. Her signed approval becomes evidence. 4 minutes.
- **09:10** Two sessions get **overlap notices**. Session S1 (Claude Code, sponsor Tomás) is adding a currency field to `rates/`. Session S2 (Codex, sponsor Aiko) is refactoring `rates/` formatting. S2's planner chooses to wait 20 minutes, since its lease is lower priority. No conflict happens.
- **09:41** S3's tier-1 UI change hits **base-moved** because a design-token Change landed in its impacted target. Its evidence is stale. Keel re-proves the 212 affected tests (3 min 40 s, $0.31) and it lands at 09:46. No human is involved.
- **10:05** Marco (product designer) gets a **compare card** in #checkout-design: three on-demand previews of the new address form, with Keel's screenshots at 3 breakpoints. He picks #2, writes "label alignment like #1" in the comment box, and the winning session folds that in. The two losing sessions are archived. 6 minutes of Marco's time; 3 previews built, 41 seconds each.
- **11:15** A **semantic conflict**: Change C-A (landed 11:02) renamed `Shipment.eta` to `estimatedArrival`. Change C-B, in another lane because the build graph missed a codegen edge, used `eta` in a new email template. The 11:15 post-land milestone run in lane `notifications` goes red. The culprit finder names C-B with 0.98 confidence after 2 reruns. Under LUCI guards (verified culprit, no dependents, within the daily cap), Keel **auto-reverts C-B at 11:19** and **hands it back** to its session along with C-A's intent and diff. The agent re-derives against the new name, re-proves, and lands again at 11:34. Keel files a build-graph-edge ticket assigned to platform, because a miss like this is what moves a lane to strict mode. Humans involved: none until the ticket.
- **13:30** Dee (SRE) checks the `ci-weather` view. Flake rate is 0.6%. One test, `geo-batch-e2e`, has failed spuriously 14 times since 06:00, so she quarantines it and assigns its owner. No merge hold is needed.
- **15:00** A tier-3 Change (dropping the old `legacy_refunds` column, the contraction phase) needs two humans. Priya and Femi from the data team review the actual diff and the expand-phase evidence: zero reads of the column in 14 days, from production query logs attached as evidence. They approve it. Keel lands it in the strict lane, with speculation, at 15:22.
- **16:40** Weekly sampled audit: Femi is shown 12 random auto-landed tier-1 Changes from the payments paths. He disagrees with 1 (a needlessly duplicated date helper) and marks it. That disagreement goes into the payments tier-1 rate, now 1.4% against the 2% threshold. The duplication feeds the cleanup-agent lane.
- **18:00** End of day: 1,612 landings. 30-day revert rate is 0.9% for tier 1 and 0.4% for tier 2. Median ready-to-landed time is 7 minutes. Human decisions across the org: 188, about 0.9 per engineer, with Priya at 11.

---

## 12. What to build first (6-week MVP) and what never to build

**Weeks 1–6.** The design partner is one 30–200-engineer repo on GitHub with an Nx or Bazel build graph.

| Week | Ship | Done when |
|---|---|---|
| 1 | Trailer convention (`Change-Id`, `Sponsor`, `Agent`, `Session`, `Assisted-by`); GitHub App ingest; Change store; `keel` CLI + MCP server (`claim`, `submit`, `status`, `why`) | Every agent push maps to a Change; `why file:line` returns the Change record and the session link |
| 2 | Impacted-target computation; Claims; **overlap** and **base-moved** events to Claude Code / Codex / generic webhooks | Notices go out within 30 s of the push; precision is tracked |
| 3 | Evidence: wrap the customer's Actions/Buildkite runs with base-checkout harness + TIA list + in-toto `test-result` attestations (Sigstore); freshness evaluator keyed on the impacted-input hash | Rebases with untouched impacted inputs reuse evidence |
| 4 | Policy engine (`.keel/policy.yaml` per directory, base-branch evaluation, tiers, shadow mode); Verdict as a required status check; reversibility rules | Two weeks of shadow-mode verdicts on real traffic, with disagreement measured |
| 5 | Lander: per-lane queue, server-side clean rebase, batched disjoint CAS, tree-equality invariant, sole bypass actor; hand-back payload; two-round cap; **no-PR path for tiers 0–1** | 0 tree mismatches across 10,000 simulated landings plus a week in production |
| 6 | Post-land milestone runs, flake-aware culprit finder, LUCI-guarded auto-revert with hand-back; ledger metrics; Slack decision digest and compare card | Metrics in section 6.3 visible; one real auto-revert with fix-forward completed |

**MVP success bar.** At least 60% of changes auto-land by policy, with a 30-day revert rate no worse than the repo's human-reviewed baseline. Median ready-to-landed time under 10 minutes. Zero landed-tree mismatches. Human decisions per engineer per day down by at least 3x.

For the Cloudflare competition, the same objects run with an Artifacts adapter in place of the GitHub one. Each Change is a Durable Object, evidence goes to R2, the index goes to D1 per repo, and the lander is one Durable Object per lane. The demo is the 11:15 scene: a clean textual merge that is semantically broken, caught by a post-land lane run, auto-reverted, handed back with the winner's intent, re-derived and re-landed. GitHub cannot do this today, and it needs no new storage engine.

**Never build:**
1. A git storage engine. Six funded teams are already building one, and git costs about $0 [12-econ, 06-forges].
2. An IDE, an agent harness, or an orchestrator UI. Those markets are owned by others or failing [17-orch].
3. A transcript store. Link to the vendor's, and keep at most 10 KB distilled [18-provenance].
4. LLM auto-merge of conflicting hunks that lands without re-proof [08-merge].
5. CRDT live co-editing of code. CRDTs guarantee convergence, not correctness [08-merge], and agent-era "multiplayer" means several people steering one agent [20-scenarios].
6. A learned taste model. Start with written principles and golden screenshots; a preference model is an injection surface [20-scenarios].
7. A "no review" global switch. Human approval stays a policy outcome per tier.
8. A per-push preview farm. Previews are on demand and recycled [12-econ].
9. A new CI runner fleet. Bring your own runners; Keel owns the *plan* and the *attestation*, not the machines. Revisit only if Scenario C (verification as the dominant cost) arrives and pricing per verified landing becomes the business.
10. Stars, followers, or a social graph. GitHub keeps network effects, and Keel should not compete for them.

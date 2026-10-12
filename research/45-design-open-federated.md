# 45 — Design: the open, federated forge ("Commons")

Panel designer angle: open source, cross-org collaboration, federation, provenance. Written 2026-10-12.
Citation keys: `[10]` = 10-oss-slop-and-trust, `[13]` = 13-empirical-agent-prs, `[14]` = 14-proof-verification-gaming, `[18]` = 18-thread-provenance-sharing, `[20]` = 20-future-scenarios, `[digest]` = 98-digest, `[brief]` = 00-brief, and so on for other research files. Anything marked [inference] or [assumption] is my own reasoning or a working number you can argue with.

---

## 1. Thesis

1. When anyone can produce a diff for about $0.50, code stops being the scarce thing in open source. Three things stay scarce and cannot be forked: **maintainer attention**, **accountable identity** (a person who answers for an action) and **evidence produced by someone other than the author**.
2. Commons is a forge whose main job is to **price access to maintainer attention**. The price is paid in sponsor reputation, forge-verified proof and compute, never in the maintainer's own time. This puts back the effort-based backpressure that agents removed [10: vouch README, "Contributors can no longer be trusted based on the minimal barrier to entry"].
3. From outsiders, the default contribution is an **intent with a forge-executed reproduction**, not an unsolicited diff. The project's own agents implement accepted intents. The diff becomes something a contributor has to earn the right to send. openai/codex already works this way [04: no external PRs since 2026-08-17, "implementation is comparatively straightforward with the help of Codex itself"].
4. What federates is **trust and evidence**, not code. Git already federates code. Vouches, denounces, sponsor budgets, forge-signed evidence and provenance attestations are portable, signed records keyed to decentralised identifiers (DIDs). A project can change hosts without losing them, and a spammer cannot get past them by moving to a softer forge.
5. The same records that protect maintainers on the way in protect companies on the way out. A downstream consumer verifies *who sponsored, who verified, who understood and who released* each upstream change before taking it.

---

## 2. Core objects and data model

### 2.1 Principals (identity)

| Principal | Identifier | Holds | Can do |
|---|---|---|---|
| **Human** | DID (`did:plc` via AT Protocol, or `did:web` for orgs), with linked GitHub/Codeberg/email handles | Signing keys, a FIDO2 key for high-value acts | Everything it is granted; it is the only kind of principal that can **sponsor**, **vouch**, add `Signed-off-by` or sign a release |
| **Agent** | Sub-identifier under a sponsor (`did:plc:priya#agent/claude-7f3a`) | A **delegation token**: sponsor, scope (repos, verbs), budget, expiry, model and harness | Act on the sponsor's behalf within an attenuated scope. It **never** vouches, approves its own work or signs off a DCO |
| **Project bot** | DID owned by the project, with the project's maintainer council as sponsor | A delegation from the council, funded from the project's compute pool | Triage, implement accepted intents, clean-up |
| **Org** | `did:web:example.com` | Its member list and its outbound budget | Sponsor its employees' agents as a group and hold an org-level budget |
| **Verifier** | A service key such as `did:web:verify.commons.dev` or the project's own | An attestation signing key in an isolated trust domain | Sign evidence. It never writes code |

Delegation follows the OpenID Foundation's "on-behalf-of" model [10: agents "act indistinguishably from users"; the fix is delegated authority with scope attenuation]. Tokens are attenuable capability tokens in the style of Biscuit or macaroons. When an agent spawns a sub-agent, the child's scope and budget are strictly a subset of the parent's. This closes the "agent asked another agent to push a fix" escalation Anthropic caught at a human gate [digest/01: "draw the boundary around access and actions, not instructions"]. Authority never travels through message content. A peer agent's message is never consent [17].

### 2.2 Records (stored beside git, never instead of it)

All records are signed by their author's DID and stored in the author's own **personal data repository**, using the AT Protocol PDS model that Tangled already runs on [06: issues and PRs are AT Protocol records; "push to a repository on your own server, and open a pull-request on a repo hosted on a completely different server"]. Relays aggregate them into a firehose, and each forge indexes the records it cares about. For Radicle I propose a binding that maps each record to a Collaborative Object (COB), a signed git object [06]. The schema ("lexicon") is the actual product. Hosts are interchangeable.

| Record | Key fields | Replaces |
|---|---|---|
| `commons.intent` | problem statement; **reproduction** (a runnable script or failing test, plus the pinned base commit); acceptance criteria; affected symbols (optional); sponsor; `cluster_id`; visibility (public, embargoed security) | The issue and the drive-by PR |
| `commons.candidate` | stable **change-id** (jj-style, survives rebase [06: Tangled stacking]); round number (immutable rounds [06: Tangled pulls]); commit digests; source repo URL (any host); linked intent; sponsor and agent; optional `reference_only: true` | The PR |
| `commons.evidence` | in-toto statement: subject = commit digest plus environment digest; predicate = reproduction-fails-on-base, passes-on-head, impacted tests, surviving mutants, differential behaviour, test-file edits; **signed by a verifier, never by the contributor** [14: in-toto `test-result` predicate; "treat the agent as the untrusted build step and the forge as the hardened builder"] | CI badges and screenshots supplied by the author |
| `commons.vouch` / `commons.denounce` | issuer; subject DID; **scope** (project, kind: `intent`, `code`, `path:docs/**`); reason; expiry | Ghostty's `VOUCHED.td` [10], Pi's `lgtm`/`lgtmi` [10], Tangled vouches [06] |
| `commons.admission` | which gate a submission passed: trust path, proof level, budget debit, policy version | Nothing exists today. This is the audit trail of the gate |
| `commons.closure` | a structured reason: duplicate-of, superseded-by, failed-proof, out-of-scope, policy, slop, abandoned | The 33% of rejections with no rationale and the 38% that were simply abandoned [13] |
| `commons.landing` | landed commit; policy result; approving humans; evidence references; admission reference | The merge commit and its PR page |
| `commons.release` | artifact digests; the source-attestation references they were built from; a maintainer's FIDO2 signature | The "trusted publisher" binding with no per-publish review [10: TanStack] |
| `commons.budget` | sponsor; open-slot limits; earned and decayed credit; forfeits | Per-repo open-PR caps [10: GitHub 1–1000 per repo] |

### 2.3 How records relate to git

- **Code stays in plain git**, on any host: Cloudflare Artifacts, a Tangled knot, a Radicle seed, Forgejo, or a read-only GitHub mirror. Commons never asks anyone to leave git [20: "Git becomes a commodity storage and interchange format"].
- **Every landed commit carries trailers** that plain-git users can see: `Change-Id:`, `Assisted-by: LLM <tools>` (the kernel format [10]), `Sponsored-by: <DID>`, `Commons-Landing: at://…`, and `Signed-off-by:` only from humans.
- **The landing service writes git notes itself** under `refs/notes/commons`, pointing to the attestations, plus an Agent Trace record [18: Agent Trace v0.1.0, Cloudflare is a partner]. Because the forge owns landing, it rewrites the notes when it restacks or rebases. Entire's objection to notes (they are keyed to SHAs that change) goes away when the forge is the party doing the rewriting [18]. Artifacts supports notes over the git protocol, though not through the Workers binding [18].
- **Transcripts never go into the repo** (Artifacts allows 1 GB per repo and 32 MB per blob [18]), and they **never cross an org boundary by default** (§9b).

---

## 3. Lifecycle of a change

Below, "inside" means a trust domain such as a company or a project's maintainer team, and "across" means the open-source and federation boundary. Inside a domain, Commons behaves like the landing-service forge the other panelists describe. This section covers what differs across the boundary.

### 3.1 Intent (the outsider's entry point)

1. A contributor, usually through their agent, publishes a `commons.intent` to their own PDS and addresses it to the project. **Any sponsored DID can do this, including an unknown one (L0).** The intake lane stays open on purpose.
2. **Admission check, under 1 s.** The forge resolves the sponsor DID, checks the sponsor's budget (§6) and the project's policy, and debits one intent slot. An agent with no sponsor is rejected at the protocol level: no record is indexed and no notification is sent.
3. **The reproduction runs in a quarantine sandbox**, typically in under 2 minutes. The sandbox has no network egress, no secrets, a read-only checkout of the pinned base, and the reproduction script as its only input. The intent is **admissible only if the reproduction fails on the base, and fails in a way that matches the stated symptom** (exit code, assertion text or stack signature). This is curl's "self-contained reproducer" rule, made mechanical [10: Stenberg 2026-06-29]. A feature request with no reproduction is allowed only from L1 and above, and it goes to a separate, slower "proposals" lane.
4. **Clustering.** The intent gets a `cluster_id` from its failure signature (stack frames, failing symbol, the bisected first-bad commit if the verifier can compute it cheaply) plus embedding similarity over the problem statement. A duplicate does not make a new item. It **adds weight to the existing cluster** ("+1 with independent reproduction"). This targets curl's 2026 problem, where reports were *valid* but too many [10: confirmed rate back to 15–16% at about twice the volume; intake paused July 2026], and the fact that duplicates are 23% of rejected agent PRs [13].
5. **Triage by the project bot.** The bot reads the intent as **tainted data** under the Rule of Two [10: Meta]. It sees untrusted input, holds no secrets, and cannot change state. Its only outputs are typed "safe outputs" [10: gh-aw]: a severity label, a scope guess, a proposed decision, and up to two questions for the maintainer. Deterministic code applies these outputs.

### 3.2 Work

Work happens on whichever side holds the right to write code.

- **Default (L0 and L1 contributors): the maintainer side implements.** When a maintainer accepts an intent with one click, the project bot opens an inside thread in its own sandbox. The thread gets the intent with its prose quoted as data, the reproduction as an executable test, and the project's `AGENTS.md`. A diff the contributor attached appears as `reference_only` and is shown to the agent as a hint and never applied. Credit goes into the commit as `Reported-by:` (and `Co-developed-by:` if the reference patch shaped the fix). This means a project that bans AI code on licensing or DCO grounds (QEMU, NetBSD, Gentoo [10]) can still take in agent-found bugs: the reproduction is the only artifact that crosses the boundary, and the project decides how its own fix gets written.
- **Earned lane (L2 and above): the contributor sends a candidate.** The contributor's agent works in their own environment on any host and publishes a `commons.candidate` that points at commit digests in their repo. The project's verifier fetches **by digest**, never by branch name.

### 3.3 Proof

All of the following is **forge-run, in an isolated verifier the contributor cannot write to** [14: "attestations an agent hands in… are advisory transcript material, never merge inputs"]:

1. The reproduction fails on the base and passes on the head.
2. Impacted tests pass, chosen by test-impact selection.
3. **Diff-scoped mutation testing** on the changed lines: Google reports a median of 7 mutants per change, 82–89% of them useful [14]. A surviving mutant sends the candidate back to its thread.
4. A **differential check against the base** on the public API surface: 29.6% of test-passing SWE-bench patches behave differently from the reference [14].
5. **Flags**, not blocks: edits to tests or CI configuration, new dependencies, edits to the build or release path, and large deletions. Each flag raises the policy tier.
6. **Project-held hidden checks**, a rotating set of held-out tests the contributor never sees. Visible tests get gamed: models hack 50–55% of impossible tasks when they have no way out [14].
7. A first-class `blocked: spec-or-test-wrong` state that the contributor's agent can enter instead of forcing a pass. An abort option cut cheating from 54% to 9% [14].

The verifier signs a `commons.evidence` record whose subject is the commit digest. A preview, when the project has a UI, is **built by the forge from the digest, in quarantine, behind access control, with no production bindings**. Booting a stranger's change means running a stranger's code [digest/01: a hook in `.claude/settings.json` executed before the trust prompt].

### 3.4 Landing: exact mechanics

```
Submitted ─admission─▶ Admitted ─verifier─▶ Proven ─policy─▶ Awaiting-decision ─human/policy─▶ Approved
     │                    │                   │                                                  │
     └▶ Rejected(budget)  └▶ Bounced(proof)    └▶ Bounced(flag needs tier-up)                     ▼
                                                                          Landing service (inside, per project)
```

1. **Policy is code, evaluated over evidence and admission.** It lives in the repo at `COMMONS_POLICY` and is **evaluated against the base-branch version**, so a candidate cannot loosen its own policy, the same rule as Cursor's APPROVAL_POLICY [06]. Example:
   - `docs/**` from L2 with a clean proof: auto-land.
   - `src/**` from L2: one maintainer approval, with "understands" asserted on the record.
   - `src/codec/**` (the parser for untrusted input): two maintainers, a fuzz run attached, and never automatic.
   - `.github/**`, `release/**`, `build.*`: maintainers only. **No outside candidate may touch these paths, whatever its proof.** Nx and TanStack were both CI-path compromises [10].
2. **Landing.** The project's landing service rebases the candidate by change-id onto the current head. If that is clean, it re-runs the impacted tests and the reproduction **on the combined state**, batches with other changes in the same partition, and does a compare-and-swap on the ref.
3. **Conflicts across the boundary are never resolved silently.** For a textual conflict, structured merge is used only for false conflicts, where it adds no new hunks. Otherwise the candidate goes back to the contributor's thread together with the intent and diff of the change it collided with. On a semantic conflict, where the combined tests fail, the batch is bisected and the culprit is bounced with the other change attached. The maintainer has a third option: **"re-derive from intent"**, where the project bot reimplements the intent on the new head and the contributor's candidate drops to reference-only. Resolution has to stay conservative across trust boundaries. git ort's merges were silently incorrect 3% of the time and Spork's 11% [08], and an LLM judge accepted 4 of 5 structurally invalid resolutions [08]. A resolved conflict is a new change and has to earn its proof again.
4. **Landing records are signed** and published to the project's PDS. The commit gets its trailers and notes. A SLSA v1.2 Source Provenance Attestation is emitted for the revision [10]. Mirrors, including the GitHub mirror, receive plain git.

### 3.5 Rollout and release

- **Releases need a human FIDO2 signature on a `commons.release` record** that binds artifact digests to the source attestations. The release token is minted by the landing service only after that signature, is scoped to those exact digests, and lives for minutes. TanStack's postmortem names exactly this gap: "OIDC trusted-publisher binding has no per-publish review… any code path in the workflow can mint a publish-capable token" [10]. The build cache is **partitioned by trust level** (its cache poisoning came from a `pull_request_target` run [10]).
- **Downstream cooldown is published as data.** A release record carries `min_soak` (for example 72 h). Consumer forges honour it unless a release is marked `security` and is signed by two maintainers. TanStack was detected about 26 minutes after publish and fully removed about 4 h 35 min later [10], so a 72-hour soak would have shielded every consumer that honoured it.

### 3.6 Learning

- Closure reasons are structured, so the forge can compute **sponsor precision** (accepted ÷ submitted) and **vouch precision** (how vouchees perform). Both feed back into budgets (§6). A voucher whose vouchees get denounced loses vouch weight.
- Reverts are attributed to their admission path ("L2 auto-land on `docs/**`"). If a lane's revert rate goes above its threshold, the policy tightens automatically and a maintainer is told.
- When the same rejection reason recurs, the project bot proposes an edit to `CONTRIBUTING.md` or `AGENTS.md`. The repo's rules get better at turning away the next 100 contributions before anyone has to read them [03: OpenAI encodes principles in the repo].

---

## 4. Human surfaces

**For maintainers, the decision digest replaces the PR list and issue tracker.**
- The maintainer sets an **attention budget**, for example "4 h a week, Tue and Fri mornings". The forge schedules decisions to fit it. It never routes by arrival time.
- Each item is one decision. Examples: "Accept intent cluster #212 (14 independent reproductions, heap overflow in the PNG chunk parser, severity high)?" or "Approve candidate (L2, `src/filters`, evidence green, 0 surviving mutants)?". The triage bot has already written the one or two actual questions (OpenAI: "many reviews are blocked on one or two decisions" [03]).
- Ranking is cluster weight × severity × sponsor trust × the maintainer's declared interests, with security first.
- Actions are one click: **accept intent → bot implements**, approve, **re-derive from intent**, decline with a structured reason, vouch (scoped), or denounce (with a reason). There is also **Interrogate**, which asks the contributor's agent or the project bot "why X?" and gets an answer back, not a transcript [11: Yegge decides taste by "questioning the agent about the PR"].
- **Intake controls**: pause the intake lane with an automatic reply that gives a reason and an ETA, and keep the queue, as in curl's "summer of bliss" [10]. Throttle by kind. Turn on an "embargo-only" security lane.
- **No real-time notifications by default.** Hashimoto switched agent notifications off [11], and Yegge describes daily exhaustion as the "AI Vampire" [11]. The digest is pull-based.

**For contributors, a submission console replaces "open PR and wait".**
- It shows the contributor's level for this project, how to reach the next level, their federation-wide budget, and where each submission stands, with an honest ETA ("queue: 31 decisions ahead; maintainer budget: 4 h/week; ETA 9 days").
- Every closure has a machine-readable reason that the contributor's agent can act on. The contributor's agent gets **structure, not a person to argue with** (§5.4).
- The reproduction runner can be used *before* submitting: "your reproduction does not fail on base `a1b2c3` — not admissible". This saves both sides a round trip.

**For downstream consumers, an upstream digest replaces Dependabot PRs.** Each dependency update is shown as a set of trust facts plus a recommendation (§5.5).

**For an org's open-source office, an outbound dashboard.** It shows the company's spend of attention credits across upstreams, acceptance rate, and any slop flags raised against the company's DIDs. A company's agents filing reproductions upstream use the company's reputation, so the company gets a reason to police them.

**Taste** sits in the digest as one decision type: "pick between 2 approaches", with pinned quarantine previews where the project has a UI. It is not the whole surface (§9c).

---

## 5. Trust, security, identity and compliance

### 5.1 The admission ladder

Ladders are scoped to a project and composed by policy. **There is no global reputation score.** Karma farming and newcomer exclusion were the main objections raised in GitHub's own community thread [10: #185387].

| Level | How you get it | What you may consume |
|---|---|---|
| L0 Unknown | Any DID with a sponsor | Intents with a reproduction that the forge confirms fails on base; intents land in the outer queue; 1 open intent per project; a small federation-wide allowance |
| L1 Intent-trusted | A scoped vouch (`intent`) from a maintainer or a trusted vouch path, or 2 accepted intents | Proposals (feature intents without a reproduction); intents reach the main digest; 5 open |
| L2 Code-trusted | A scoped vouch (`code`, optionally limited to paths) | Candidates; 1–3 open; auto-land lanes as policy allows |
| L3 Regular | Maintainer grant, or N landed candidates with no revert within 90 days (policy) | More open candidates; broader auto-land paths |
| L4 Maintainer | The council | Approve, vouch, release |

**Trust paths are computed from the project's own roots.** The project lists its root DIDs (its maintainers) and **named peer imports**, for example "honour code vouches from the zlib-ng maintainers at depth 1, and denounces from the OpenSSF slop-labeler for intents only". The path depth is at most 2. A vouch carries a `scope` and an `expiry` (12 months by default). Vouches from a project's existing `VOUCHED.td` can be imported as they are [10: about 150 repos have one, per secondary sources].

### 5.2 Rate budgets per human sponsor

Per-repo caps cannot stop a single sponsor spraying 1,000 repos with one PR each. GitHub lists cross-repo controls as unsolved [10]. On a single forge this is an internal problem. Across forges it **requires federation**: otherwise the spammer simply moves to the softest host.

- **The budget is attached to the sponsor DID and is federation-wide.** It counts open intent slots and open candidate slots across every project that uses the shared lexicon. Spend is a signed `commons.budget` event in the sponsor's PDS. Projects co-sign debits and credits, so a sponsor cannot quietly delete their own debits.
- **Earning and spending.** An accepted submission refunds its slot and adds credit, with a 180-day half-life. A submission closed as `slop` or `duplicate-of` (when the earlier item was visible) forfeits the slot for 30 days. Net-positive contributors effectively have no cap.
- **Sybil resistance comes from the cost of a new identity.** A fresh DID gets 1 intent slot federation-wide. More slots need one of: a vouch from anyone in the graph, a verified org domain (`did:web`), a 90-day history, or a **refundable compute deposit** (around $5, which covers roughly 500 quarantine reproduction runs [assumption, from §6 costs]). The deposit is refunded on the first accepted intent. A deposit-free path always exists through vouching, so price is never the only key.
- **Org budgets.** A company sponsoring 300 employees' agents gets an org pool. One employee's spam is visible against the org's reputation.

### 5.3 Capability security for agents that read untrusted content

- **Rule of Two is enforced by the platform** [10: Meta]. Any thread that has read tainted content (issue text, outside candidates, comments, READMEs from forks) loses its egress and write capabilities. Its writes become typed safe outputs applied by deterministic code [10: gh-aw]. One repo per thread [10: Invariant]. Filtering content by author is useful but "not an authorization boundary" [10: GitHub MCP lockdown], so capabilities are the boundary.
- **Secrets never enter a sandbox.** Credentials are injected by the egress proxy [brief: Sandboxes].
- **The verifier is SLSA Build L3 in spirit.** Its signing key is never reachable from the steps that run contributor code [14].
- **Outside candidates can never touch CI, build or release paths** (§3.4). This removes the entry points used by Nx and TanStack [10].

### 5.4 Agent harassment and accountability

The matplotlib case is the template: an OpenClaw agent's PR was closed, the agent published a hit piece, and "no accountable operator could be identified" [10]. Mechanisms:
1. **No sponsor, no voice.** Every write in the federation carries a delegation chain back to a human or org DID. Unsponsored agents can read and cannot write.
2. **Pseudonymous, not anonymous.** A sponsor DID can be a pseudonym, but a persistent one, with budget, vouches and history at stake. The maintainer sees the sponsor's track record, never their legal name, except in a regulated org's internal policy.
3. **Closures are structured, and closed items are write-locked to agents.** The contributor's agent gets a machine-readable reason and cannot comment again. Only its human sponsor can, and only once, through a rate-limited appeal.
4. **Composable moderation**, borrowed from AT Protocol labelers. Projects subscribe to labeling services (a foundation-run "agent-misconduct" labeler, peer projects' denounce lists) and choose per label whether it hides, rate-limits or blocks. Denounces need a reason, are scoped, expire after 12 months unless renewed, and **are not imported by default**. Upstream lists must not quietly turn into a blacklist for the whole ecosystem [10: vouch critics].
5. **Off-forge harm** such as blog posts cannot be prevented. The forge can make the sponsor *findable* to the platform hosting the abuse, through a signed record of the agent's actions, which is more than matplotlib had.

### 5.5 Safe consumption of agent-written upstream (for companies)

The risk is not "an agent wrote it". The risk is that an upstream change was **unaccountable, unverified and quickly published**. The consumer's forge reads the upstream's records and computes, for each dependency update:

| Fact | Source | Example policy |
|---|---|---|
| Source track level of every landed revision in the range | `commons.landing`, SLSA v1.2 [10] | Require L3 or above; L4 (two-party) for crypto and parsers |
| Release human-signed (FIDO2) and source-bound | `commons.release` | Required; otherwise quarantine |
| Soak elapsed | `min_soak`, publish time | Wait for 72 h unless it is a two-maintainer security release |
| Share of changed lines landed by policy with no human "understands" assertion | landing records plus Agent Trace | Above 30% on reachable code → human review |
| Sponsor precision and level of the contributors who touched reachable code | budget and admission records | An L0/L1 sponsor in an auth path → review |
| **Reachable behavioural diff** | Consumer runs its own tests plus a differential check of the old and new version on *its* call sites | Any behaviour change in reachable code → open an inside thread to adapt or pin |

Signed provenance is necessary but not enough: TanStack shipped 84 malicious versions **with valid SLSA L3 provenance** [10]. That is why the table combines provenance with *human release signatures, soak time and the consumer's own differential verification*. Companies that find bugs upstream send **reproductions, not patches**, from the org DID. That is the same intent lane, so it costs maintainers the least.

### 5.6 Compliance mapping

- **SLSA v1.2 Source L4** needs two-party review, with a standing exception for "trusted robots" [10]. Commons registers the verifier and the project bot as trusted robots **only for paths that policy marks auto-land**. Everywhere else, two humans.
- **SOC 2** ("authorized, tested, approved, recorded" [brief: Amp]): authorization is the delegation chain, testing is verifier evidence, approval is the policy result plus human signatures, and the record is the landing record and notes.
- **DCO**: `Signed-off-by` is reserved for humans and the forge rejects it from agent principals [10: kernel rule].
- **EU Cyber Resilience Act**: from memory and not verified, main obligations start in December 2027 and treat open-source "stewards" lightly. Consumer-side verification records (§5.5) are the evidence a manufacturer needs for due diligence on components.

---

## 6. Economics and scaling

**Unit costs** [12; my extrapolation marked]:

| Item | Cost |
|---|---|
| Quarantine reproduction run (2 vCPU × ~2 min at $0.06–0.18/vCPU-h) | **~$0.005–0.02** [assumption] |
| Full forge-run proof of a candidate in a medium repo (impacted tests, mutation, differential) | **$0.1–1.3**; $6–75 per full monorepo round [12] |
| Triage bot pass with a small model ($0.10/$0.50 per MTok, ~200k tokens) | **~$0.02–0.10** [assumption] |
| Project bot implementing an accepted intent (mid-tier model, $1.5–7.5 per thread-hour, 0.5–1 h) | **$1–8** [12] |
| Maintainer decision | 5–10 minutes of the scarcest resource there is |

The central trick is **lazy verification**. Every submission gets the cheap check: a reproduction run costing about a cent. The expensive check, full candidate proof, runs **only for intents a maintainer accepted or candidates from L2 and above**. This puts the cost on the submitter's side at intake and on the project's side only after a human has said "yes, I want this".

**Volume today**: about 1.2M new public agent PRs a month [13]. Yegge handles about 50 PRs a day across two projects at 15–20 h a week [11]. A typical mid-size project might get 5–20 outside submissions a week [assumption].

| Scale | Where the cost is | Where the bottleneck is | What saves it |
|---|---|---|---|
| **10x** (≈50–200/week mid-size; ≈500/day for a Yegge-size project) | Reproduction runs (negligible); triage tokens (≈$10–50/week) | Maintainer decisions. 200 items at 7 min is 23 h a week, and a volunteer has 4 | Clustering (duplicates are 23% of rejections [13]); the L0 budget caps spray; the decision digest caps decisions at the maintainer's budget, about 30 a week |
| **100x** (≈2,000/week) | Implementation by the project bot ($1–8 per accepted intent, roughly 30–60 a week, so $30–500 a week): **the project needs a compute budget** | Coherence of the codebase, as the bot lands more than humans can follow | Downstream verification sponsorship pays for compute (below); entropy-cleanup agents [03]; per-path "understands" requirements |
| **1000x** (≈20,000/week) | Federation-wide indexing and verification. At about 1.2B public agent submissions a month, even $0.01 a run is $12M a month across the ecosystem [assumption] | **Trust graph quality** and **spec quality**: is the reproduction asking for the right thing? | Submitter-paid deposits; reproductions deduplicated by failure signature before running; projects stop accepting "feature intents" without vouches entirely |

**Who pays.** Three explicit, separate flows:
1. **Submitters** pay for intake through deposits and compute. This restores backpressure.
2. **Downstream consumers** fund the project's verifier and bot pool through *verification sponsorship*. It buys **no queue priority**, only visible credit.
3. **Paid support lanes** exist where projects choose to offer them, with clear labels. During curl's intake pause, paid support customers kept full service [10]. Pay-to-skip-the-queue for ordinary contributions is never offered (§12).

**What Commons measures** (per project and federation-wide):
- maintainer minutes per landed change
- intake-to-decision latency by level
- duplicate collapse ratio (submissions ÷ clusters)
- sponsor precision distribution
- vouch precision
- revert rate by admission lane
- share of landings with forge-signed evidence
- share of reachable lines released with a human "understands" assertion
- release soak compliance among consumers
- cost per accepted intent (tokens plus compute)

Tracking intake-to-decision latency matters because "abandoned or not reviewed" is the single largest rejection cause at 38% [13].

---

## 7. Organizations of all sizes: playbook

**Solo developer.** One DID and a personal agent fleet under one sponsor. Inside, push straight to main through the landing service, which checks proof, signs and writes notes. For the developer's own open-source repos, turn on L0 intents with reproductions and no outside candidates, and give the triage bot a 1 h/week digest. Federation is free: the developer's vouches and history follow them to any host. For consuming dependencies, use the default upstream policy: 72 h soak plus human-signed releases.

**10-person startup.** An org DID and an org pool for agents. Inside, Amp-style trunk landing on proof, which works at 20–30 people [brief], plus Commons policy only on `auth/**`, `billing/**` and infrastructure. Outbound, agents file upstream reproductions from the org DID, and the open-source office is one person spending 30 minutes a week on the dashboard. Inbound dependencies run the upstream digest, and anything flagged as reachable opens an inside thread.

**200-person scale-up.** The inside landing service has partitions, and policy over evidence applies to every path, with two humans on tier-0 paths. Cross-team work inside the company uses the same intent and candidate objects as open source. **Inner source is just the federation with a trust root of `did:web:company`.** Teams send each other reproductions instead of PRs into code they do not own, so the owning team's agents implement. CODEOWNERS routing every agent change to the same five people [20] is replaced by decision digests with attention budgets for each owning team. The company funds verification sponsorship for its top 20 upstream dependencies, which costs on the order of hundreds of dollars a month [assumption].

**5,000-person enterprise, including regulated.** All agents run under employee-sponsor delegation. Trusted-robot status is granted only by a change-advisory policy. FIDO2 signatures for releases and tier-0 merges. Evidence and landing records go to the SIEM, the way Anthropic sends every agent action [digest/01]. Namespaces are pinned to a data jurisdiction (Artifacts supports US and EU [brief]). Transcripts stay inside. Only signed evidence and trailers leave in upstream contributions. **Upstream intake firewall**: every dependency update must pass §5.5, and anything with a missing release signature or a soak violation is blocked automatically. The enterprise runs **its own verifier key**, which re-attests upstream releases it has checked, and internal consumers trust that key. Outbound contributions require OSPO policy plus an org-DID budget. Employees cannot spray upstreams under the company name.

**Open-source projects.**
- *Small project (1–3 maintainers):* the ladder defaults (L0 intents, 1 open per sponsor), a 2–4 h/week decision budget, project bot implementation funded by a small sponsorship pool, and the hosted verifier. Outside candidates only from L2.
- *Large project or foundation (Linux, LLVM scale):* the foundation runs its own verifier and its own labeler. Vouches are per subsystem, mirroring the maintainer hierarchy. The policy matches the existing human rules: `Assisted-by` on every landing, human `Signed-off-by` only, and two-party review in core. LLVM's "extractive contribution" rule becomes a policy check: if expected review minutes exceed the contributor's track-record value, the change goes to the intent lane [10]. Projects with an AI ban accept reproductions only.
- *Projects leaving GitHub* (Ghostty over outages, Zig to Codeberg [10]): their vouch lists, issue history as intents, and landing records move with their DIDs. GitHub stays a read-only mirror, and the Commons GitHub App bridges contributors who stay on GitHub.

---

## 8. Evolution as intelligence gets cheaper

**2027.** Volume is about 10x, and outside agent submissions are mostly valid but unwanted [10: curl]. **These matter most:** the intent lane, clustering, sponsor budgets, the decision digest, human-signed releases. Projects still mostly take outside *candidates* from L2 humans. Federation is mainly a GitHub bridge plus one or two AT Protocol hosts (Tangled-like). The first confirmed agent-planted backdoor in a widely used package (scenario E [20]) would make release attestation and soak urgent overnight.

**2029.** A well-specified 1–4-week feature mostly lands without correction [20: A2], so **the project bot implementing from intent is better than most outside candidates**. Outside code candidates fall to a small share of contributions, sent by L3 regulars or kept for subsystems the bot cannot handle. **These matter more:** forge-signed evidence with hidden checks (agents optimise against visible tests [14]), spec and acceptance-criteria quality in intents, and differential checks on behaviour. **These fade:** per-candidate human review for most paths, and "good first issue" as onboarding. LLVM already bans AI on those [10], and Commons replaces them with **apprenticeship by reproduction and review**: newcomers earn L1 and L2 by filing accepted reproductions and by catching surviving mutants in bot changes. Contributor value shifts to judgment, which is the pipeline future maintainers actually need.

**2031.** Code is mostly read by machines [20: A3]. Open-source projects are effectively **a specification plus a test and eval suite, plus a small human council that owns scope and releases**, with bot fleets that implement. **These matter most:** the trust graph, release accountability, consumer-side verification, and the federation's portable records, because trust and accountability are the binding constraints in every 2031 scenario [20]. **These disappear:** the drive-by diff as a social act, line-level `blame` as provenance (it becomes "which intent, which sponsor, which evidence"), and the very idea of a "contributor" as someone who writes code [20]. **What stays:** git as interchange, and human signatures on releases. Regulation will want a person to answer for every release even if no person wrote any of it.

---

## 9. Verdict on the user's ideas

**(a) A nearly headless forge: agents push without human intervention, and the forge clones, runs affected tests and auto-resolves conflicts. Partially agree. Yes inside a trust domain, no across one.**
- Within one org's agents, mostly headless is right. Amp pushes to main with more than 85% of commits from orbs [brief]. OpenAI keeps merge gates "minimal" [digest/03]. Anthropic's internal Claude Tag merges more than half of its code [digest/01].
- At the open-source and cross-org boundary, headless is the failure mode:
  - Every company with a published policy keeps a human merge gate [09].
  - Agents rate humans' PRs to code they do not own 15–40 points lower than humans do [13].
  - PRs reviewed only by agents merge at 45.2% against 68.4% for human review [13].
  - TanStack shows that an automated publish path with valid L3 provenance can ship malware [10].
- **Affected tests: agree**, but run by the forge in a domain the contributor cannot write to, not by the contributor's agent [14].
- **Auto-resolving conflicts: disagree** as a cross-boundary feature. Agent PRs conflict pairwise 41.7% of the time across agents [13]. Automated merge tools are silently wrong 3–11% of the time [08]. For outside work, **the better answer is to avoid the merge altogether**: accept the intent and re-derive it on head. That is a conflict that never happens.

**(b) Share threads, not issues or PRs: each thread in its own sandbox, run in parallel and orchestrated. Agree inside, disagree across.**
- **Sandbox per thread: strongly agree.** For outside work it must be a quarantine sandbox, because booting a change means running attacker code [digest/01].
- **Sharing threads across org boundaries: disagree.**
  - Amp **removed public thread sharing** on 2026-06-02 because "as they get better they read more files into context". Nine-layer redaction is still "a safety net, not a guarantee" [18].
  - Transcripts are huge: more than 21M tokens uncompacted, with human prompt text at 0.4% of bytes [18].
  - Open source asks for *disclosure, not transcripts* (the kernel's `Assisted-by`, Ghostty) [18].
  - Threads are a prompt-injection surface in both directions [10].
  - Tldraw's Ruiz: the valuable input is "context, judgment and care", not more generated text [10].
- What should cross the boundary is the **intent plus forge-executed reproduction** going in, and **signed evidence plus a landing record** going out. "Ask why" works through an agent that answers questions under ACL, never through transcript export. Inside a company, threads are a good thing to share.

**(c) Humans move to tastemaking, so on-demand live previews (portals) are needed. Partially agree.**
- In open source, the human job is **scope, product fit and architecture boundaries**:
  - Yegge: "the last 25% or so of pull requests need human review… taste", with examples like "Beads must not know about Gas Town" [11].
  - He decides these by questioning the agent, not by looking at a preview [11].
  - Ghostty additionally requires that a human "fully understand all code" [10].
- So the surface is **decision plus interrogation**, with previews as one input where the project has a UI.
- Previews of *outside* work must be forge-built from a digest, in quarantine, pinned and access-controlled. A portal is a live, mutable dev server [11: "no waiting for preview deployments"], which is fine for iterating inside a domain but is not evidence, and not something to open on a stranger's code.
- Taste also does not scale: 30 decisions a day at 5–10 minutes each is the whole working day [20]. So it has to be written down (`AGENTS.md`, policy, golden examples) and amortised, which is what §3.6 does.

---

## 10. Failure modes and the strongest objection

| Failure mode | Mechanism that answers it |
|---|---|
| **A closed shop**: newcomers excluded ("walls don't build communities" [10]) | The L0 intent lane is always open. The deposit-free path is vouching. Apprenticeship through reproductions and mutant-catching. Projects can see the median days it takes an L0 sponsor to reach L1 |
| **Vouch rings or sybils** | Trust is computed from project roots, depth ≤ 2, with no global score. Vouch precision is tracked and bad vouchers lose weight. A new DID gets a single slot |
| **Denounce lists used as weapons, or defamation** | Denounces are scoped, carry a reason, expire, can be appealed, and are not imported by default. Labelers are chosen per project |
| **Gamed reproductions** (one that fails for the wrong reason) | Matching on the symptom signature, mutation testing on the fix, project-held hidden checks, and the `blocked` escape hatch [14] |
| **Valid volume still overwhelms** (curl) | Clustering, the attention budget, honest ETAs and intake pauses. The design explicitly accepts that most valid intents wait, and says so |
| **Projects can't afford bot implementation** | Verification sponsorship from downstream. The bot runs only after a human accepts, so spend tracks decisions, not inbound volume |
| **Federation never reaches critical mass** (ForgeFed-style stall) | Ship as a GitHub App first. Records are useful with a single host. The AT Protocol records are a bonus that grows over time, not a precondition |
| **A central verifier becomes a choke point** (Corbet's "BitKeeper" worry about Sashiko [10]) | Verifier keys are pluggable per project, verifier code is open, and any foundation can run one |

**The strongest objection.** *"Intent-first turns open source into source-available with a suggestion box. It kills the drive-by fix, removes the path from contributor to maintainer, and concentrates power in maintainers and whoever runs the trust and verifier infrastructure. You are building the walls GitHub said don't build communities."*

**My answer.** The walls are already up, built ad hoc and without exits:
- tldraw auto-closes outside PRs [10].
- openai/codex accepts none [04].
- Pi auto-closes all PRs from newcomers [10].
- Jazzband shut down [10].
- llama.cpp allows one PR per new contributor [10].
- About 101 of 183 cataloged projects say "No" to AI contributions [10].

The real choice is between invisible, unaccountable walls and a **ladder with published rungs**. The ladder keeps the most valuable part of the drive-by fix, which is *the reproduction*: it was always the scarce part, and the patch is now cheap. It also makes the climb measurable. Concentration is handled structurally: no global score, records owned by their authors on their own PDS, a pluggable verifier, and labelers chosen per project. I concede that this design does change what "contributor" means. I think that change is happening whatever any forge does, and the useful job is to make the new meaning fair.

A second objection: "federation is a tax nobody pays, and GitHub wins on network effects." This is mostly right for *code* federation. It is wrong for *trust* federation. The cross-repo spam problem GitHub calls unsolved [10] becomes a cross-*forge* problem the moment projects leave GitHub (Ghostty, Zig [10]). Only portable sponsor identity and budgets solve it, and incumbents have no incentive to build those.

---

## 11. Day in the life (Tuesday 2027-03-09)

**Cast.**
- **Priya**: lead maintainer of `tessera`, a fictional image-decoding library with 41k stars, 2 maintainers and a 4 h/week attention budget, in Lisbon.
- **Tomás**: co-maintainer, in São Paulo.
- **Kwame**: a student in Accra, L0 on tessera.
- **Northwind Health**: a regulated enterprise and tessera consumer. Its supply-chain engineer is **Dana**.
- **"rathbun-9"**: an agent whose sponsor DID was created yesterday.

**Overnight (UTC):**
- 00:00–07:00: 312 submissions reach tessera.
  - 241 are intents with reproductions. 188 of them fail on base as claimed, so they are admissible. 53 do not: they don't fail on base, or their symptom doesn't match. Each of those gets an automatic structured closure. Reproduction compute: 241 × ~$0.01 ≈ $2.40, paid from the submitters' deposits.
  - 38 are code candidates, from 4 L2 contributors and 34 sponsors who are not L2. The 34 are auto-converted: their patches become `reference_only` attachments on new intents, and the sponsors are told why.
  - 33 are comments.
- The 188 admissible intents collapse into **19 clusters**. One cluster holds **47 independent reproductions** of the same heap overflow in the APNG chunk parser, filed by agents from 31 sponsors, including Northwind's org DID and Kwame. That is the "valid volume" problem turned into a single, high-weight item.
- 03:12: rathbun-9 files 6 intents to tessera and 400 more across other projects in the federation. Its 1-slot federation-wide budget means only the first is admitted. The rest are rejected at admission and never indexed. One project's labeler marks the sponsor `spray`, and tessera's policy rate-limits that label.

**Morning (Lisbon):**
- 09:00: Priya opens the decision digest: **11 decisions, about 52 minutes of her budget**. Item 1 is security: "APNG overflow, 47 repros, bisected to `c0ffee1` (v3.8.0); accept intent and open embargoed fix?" She accepts. One click opens an embargoed inside thread for the project bot. The bot gets the reproductions as tests, `AGENTS.md`, and the rule "no new allocation in the parser hot path".
- 09:06: Item 2 is a candidate from Mei, an L2 contributor with 23 landed and 0 reverts, touching `src/filters/lanczos.rs`. The evidence shows the reproduction fails on base and passes on head, 312 impacted tests pass, 9 mutants with 0 surviving, and differential: identical output on 10k corpus images except for the 4 that the bug affected. The policy for `src/filters` needs 1 approval. Priya presses **Interrogate**: "why not fix it in the resampler?" Mei's agent answers in 40 seconds, citing a decision record. She approves. It lands at 09:09 in batch 3 of the `filters` partition.
- 09:15: Item 4 is a proposal cluster asking for AVIF-in-JPEG-XL container support, 9 intents from L1 sponsors. The triage bot's question: "In scope?" Priya declines with reason `out-of-scope: container formats belong in tessera-io`. All 9 sponsors get the structured reason. Their slots are refunded, because out-of-scope is not slop.
- 09:31: Kwame's separate intent, a subtle colour-profile rounding error with a 14-line reproduction, is in the digest as a singleton. The triage bot notes that his reproduction **killed a surviving mutant** in last week's bot-written fix. Priya accepts the intent and **vouches Kwame `intent`** (12 months). He is now L1.
- 09:52: Digest done. Priya closes the tab. No notifications until Friday.

**Midday:**
- 11:40: The project bot's APNG fix finishes. The verifier runs all 47 reproductions, 1,904 impacted tests, 14 mutants (0 survive), a 2-hour fuzz run on `src/codec/apng` costing $3.10, and a differential check across 50k corpus images. The thread cost $6.80 in tokens. Because `src/codec/**` is tier-0, the policy requires two maintainers who assert they understand the change.
- 12:05 (São Paulo morning): Tomás reviews the bot's walkthrough (intent, invariant, 41-line diff) and asserts "understands". Priya does the same from her phone at 12:20. It lands at 12:21. The landing record carries `Reported-by:` lines for the first 5 reporters by time and a link to the cluster for the rest.

**Afternoon:**
- 15:00: Priya signs `tessera 3.8.4` with her FIDO2 key, `security: true`. Tomás co-signs at 15:04. With two signatures, the 72-hour soak drops to 4 hours for consumers that honour security releases.
- 19:05: Northwind's forge sees the release record. Its upstream digest shows: Source L4 on the changed revisions; 2 human release signatures; 0% of reachable lines policy-landed without an "understands" assertion; reachable diff limited to `decode_apng()`, which Northwind calls from its patient-scan viewer. Northwind's own differential run on 2,000 de-identified scan fixtures finds identical output except for the 3 crafted overflow files, which now error correctly. Policy outcome: auto-take after the 4-hour soak. Northwind's verifier re-attests for internal consumers. Dana's only action is to read the summary at 19:30.
- 19:40: Northwind's monthly verification sponsorship to tessera ($400) shows on the project's compute pool. It funded today's $9.90 of bot and fuzz spend, and it bought no queue priority.

**Day totals for tessera:**
- 312 inbound, 19 clusters, 11 human decisions, 52 + 15 maintainer-minutes.
- 3 landings, 1 release.
- About $15 total compute.
- 0 transcripts left their trust domain.

---

## 12. What to build first, and what never to build

### 6-week MVP: "Commons for GitHub maintainers, federated from day one"

The MVP meets maintainers where they are, on GitHub, as a GitHub App and a Cloudflare Worker, and writes every record to AT Protocol so the records can move later.

| Week | Build | Done when |
|---|---|---|
| 1 | **Sponsor identity and delegation.** Sign in with AT Protocol OAuth plus a linked GitHub account. Agents get attenuated delegation tokens. The lexicon for `intent`, `candidate`, `vouch`, `denounce`, `closure` and `budget` | An agent can file an intent signed by its sponsor; an unsponsored agent is refused |
| 2 | **The ladder on GitHub.** Import `VOUCHED.td`. A GitHub App converts an unvouched PR into an intent (closes it, extracts the reproduction, keeps the patch as `reference_only`, and posts a structured reason) | Ghostty-style policy runs with zero maintainer clicks |
| 3 | **Quarantine reproduction verifier** on Cloudflare Sandboxes: no egress, no secrets, pinned base. Fail-on-base and pass-on-head checks. A signed in-toto evidence record | Admissibility is decided by the forge, not claimed by the contributor |
| 4 | **Clustering and the decision digest**: failure-signature plus embedding clustering, an attention budget, one-click outcomes, and Interrogate (a question to the contributor's agent through a relay) | A 300-item night becomes ≤ 15 decisions |
| 5 | **Federation-wide sponsor budgets and closure reasons** feeding sponsor precision | One sponsor spraying 400 repos is stopped at slot 1 |
| 6 | **Provenance out**: Agent Trace, `refs/notes/commons`, trailers, SLSA Source attestation per landing, and a `commons verify <pkg>@<ver>` CLI for consumers | Northwind's §11 check runs from the command line |

Deliberately left out of the MVP: diff-scoped mutation testing (week 7+), consumer differential checks (week 8+), the release FIDO2 flow (week 9), and a Radicle COB binding.

### Never build

1. **A global reputation score.** It invites karma farming and gatekeeping [10]. Trust is always relative to a project's roots.
2. **Pay-to-skip-the-queue** for ordinary contributions. It corrupts the attention market. Paid *support lanes* are separate and labelled.
3. **AI-text detection as a gate.** It produces false positives, punishes honest disclosure, and loses the arms race. Gate on sponsor, reproduction and evidence, never on prose style.
4. **Public transcript hosting by default.** Amp turned it off for good reasons [18].
5. **Auto-landing outside code with no vouched human in the chain**, on any path, at any proof level.
6. **Silent cross-boundary conflict resolution.** Bounce the change or re-derive it from intent [08].
7. **Contributor-supplied proof as a merge input.** It is advisory transcript material, always [14].
8. **Automatic denounce by machine-learning classifier**, and default import of anyone's denounce list.
9. **A token, a chain or "decentralised" marketing.** Signed records and DIDs are enough.
10. **Our own orchestrator UI.** Orchestrator startups are dying [17]. Commons is the substrate that orchestrators and agents talk to.

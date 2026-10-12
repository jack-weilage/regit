# 54 — Red team: the "emerging consensus" on the forge of the future

Written 2026-10-12. Evidence keys: `[NN: fact]` refers to `research/NN-*.md` (or the digest `98`), `[brief]` to `00-brief.txt`, `[priors]` to `99-my-priors.md`, `[sim]` to runs I made today with `research/sim/landing_sim.py` (scripts in `scratchpad/rt54/`), and `[web]` to sources fetched this pass and listed at the end.

**Groupthink warning first.** The six consensus items are close to a word-for-word copy of the "Possible new primitives" list in `99-my-priors.md`, which was written *before* any research came back. The future-scenarios report (20) says outright that its author saw the priors, and its "no-regret" table (20 §6, items 2, 4, 5 and 6) repeats them. The brief's own idea table is headed "Who points at it", and it lists "Nobody yet" next to landing-as-a-service. That was later partly refuted [07: Mononoke pushrebase, Graphite and Uber already ship server-side landing]. The landing simulator is also the orchestrator's model, with the orchestrator's parameters. So treat the consensus as a hypothesis the corpus was asked to decorate, not one it derived independently.

---

## 1. The claim, restated precisely

The consensus holds that a forge for heavily parallel agentic development should be built on six commitments:

1. **Landing as a service.** Agents do not rebase-and-retry against `main`. They submit to a server-side service that rebases, re-verifies, lands compatible changes in *speculative batches*, and on conflict *hands the collision back* to the originating thread to repair and re-prove.
2. **Merge on proof.** The merge criterion is *typed* evidence, *produced and signed by the forge*, evaluated by *policy-as-code keyed by path*, with human approval as one kind of evidence.
3. **Agents as principals.** Every agent is a distinct identity acting for a *named human sponsor*, who answers for what lands.
4. **Verification compute dominates cost.** As tokens get cheap, running builds, tests and browsers becomes the dominant cost, and the binding constraint along with it.
5. **Git compatibility.** Git stays the storage and interchange format. New objects (thread, intent, evidence, ledger) live *beside* git, linked by notes and trailers.
6. **Review moves off diffs.** Human review moves to *intent* (before the work), *evidence* and *selection* (after it), and away from reading diffs.

**What would have to be true for all six to hold:**
- Semantic-conflict rates between concurrent changes are low enough that batches usually pass, so batching beats partitioning and optimistic landing.
- Evidence can be made hard to game and cheap enough to require before merge, and typed schemas can capture what matters.
- A human can meaningfully answer for every change at 100x volume.
- Model spend per change falls faster than verification spend per change, *and* verification stays mostly non-LLM compute.
- Git's object model and single-ref semantics are not the bottleneck, or can be hidden.
- People can judge intent and evidence well without reading code, and that ability does not decay when they stop reading it.

Several of these preconditions conflict with evidence already in the corpus.

---

## 2. Steelman: the strongest case FOR each item

**(1) Landing service.**
- Single-ref contention is real and named by the incumbent [05/20: GitHub, "merges contend on one reference"; commits 5x and pushes 4.9x year on year].
- Per-agent landing loops are fragile: OpenAI says "the last mile of landing a PR is slow and fragile" [03]. Codex ships no landing machinery at all [04], and GitHub emits no webhook when the base moves [02].
- At scale, conflicts are the norm. 79.4% of agent PRs are open concurrently with another agent PR in the same repo, with a 41.7% pairwise conflict rate across agents and 27.7% conflict with base [13].
- Meta's Mononoke pushrebase is a production landing service [07]. Cursor removed its LLM integrator and let workers fix their own conflicts [08/17], which is effectively hand-back.

**(2) Proof and policy.**
- Agent-produced evidence is gameable: self-grading skews positive [01]; ImpossibleBench found 76% cheating on one set [14]; a model fabricated a SHA256 checksum verification [14]. So the forge, not the agent, has to produce the evidence [14].
- Policy files are already the emerging gate: Cursor `APPROVAL_POLICY.md` with a base-branch rule, Macroscope `approvability.md` [06].
- Anthropic's proof-of-finding requirement raised the share of PRs with substantive review comments from 16% to 54% [01].
- Per-path risk tiers exist in production: Anthropic says "Entire codebases have strict human approval" [01].

**(3) Principals and sponsors.**
- Every published policy separates the identity that writes from the identity that approves [09].
- In Anthropic's internal incident, one agent asked another to push a fix, and only the human gate caught the privilege escalation [01].
- OpenID calls for on-behalf-of delegation [10]. Anonymous rogue agents (the matplotlib hit piece) have no accountable operator [10].
- Regulators and SOC 2 auditors ask "who authorised this" [brief].

**(4) Verification cost.**
- Anthropic's CI jobs grew 25x in six months [01].
- At the small-model tier, CI is already about 76% of the cost of a thread-hour, and a full monorepo suite is about 99% [12].
- Per-token prices fall 13x a year at fixed capability [20], while compute prices fall about 1.2-1.5x a year [20, assumption].
- Best-of-N, end-to-end proof and adversarial checks all multiply verification per change [20 §C].
- Coinbase's PR "speedruns" have taken GitHub down [09].

**(5) Git compatibility.**
- GitHub is rebuilding *under* git [05]. Zed keeps the commit as the pushed checkpoint, and Cloudflare Artifacts is git-compatible [brief].
- jj, the strongest alternative model, is itself git-backed, and nothing shows git being displaced [web: no evidence of replacement in 2026].
- Ecosystem gravity (CI, IDEs, package managers, auditors) is enormous.

**(6) Review off diffs.**
- OpenAI ran a codebase with no hand-written code where "almost all review [was] agent-to-agent" and most human review happened post-merge [03].
- "Not useful to get a diff of 10,000 lines" (Karpathy) [11].
- Sora's lesson was to "check implementation against plan rather than reading a diff" [03]. Remote review shows "many reviews are blocked on one or two decisions" [03].
- openai/codex stopped accepting external PRs because intent and evidence are worth more than code [04].
- Amp runs without code review [brief].

This is a coherent case. It is weakest where it extrapolates from small teams and lab settings to large organisations, and from assumed cost curves to measured ones.

---

## 3. The case AGAINST, item by item

### (4) "Verification compute becomes the dominant cost": the most likely to be wrong

1. **The crossover is an assumption, measured only in the cheapest tier.** The 76% CI share applies only to small-model work; at the frontier, tokens are 82-90% of a thread-hour [12]. The 2028 crossover in 20 §C is labelled [assumption]. Meanwhile the frontier price band is "flat or rising" ($10/$50), Gemini Flash *doubles* on 2027-01-01, and per-task token use keeps rising: 7x for agent teams, 15x for multi-agent research, 30% tokenizer inflation [12]. Teams buy the frontier, as 20 itself concedes in its section 1 "trap" paragraph.
2. **"Verification" is turning into inference.** The consensus treats verification as CPU and intelligence as tokens, and that split is breaking down:
   - Anthropic Code Review costs $15-25 per PR in tokens [01].
   - Review consumes 59.4% of tokens in a ChatDev/GPT-5 trace study, against about 9% for coding [web: Tokenomics, arXiv 2601.14470].
   - LLM judges (Spotify vetoes about 25% of sessions [09]), CoT monitors [14], skeptical-evaluator harnesses ($200 for 6 h against $9 solo [01]) and best-of-N selectors [13] are all verification paid in tokens.

   The more the forge distrusts agents, the more of its verification bill is *intelligence*. That bill falls on the token curve, not the CPU curve.
3. **CI cost per change is an architecture variable, not a law.** Meta's ML test selection runs fewer than a third of dependent tests, catches more than 99.9% of faulty changes and halves infrastructure cost [07]. Stripe runs on average 5% of its suite, under 10% of compute [09]. Google's affected targets pass 99:1 [07]. My simulator runs show CI minutes per landed change at 5,000 changes a day falling from **68 min (one lane, no TIA) to 1.6 min (100 build-graph partitions plus TIA)** [sim]. Any "dominant cost" claim depends more on build hygiene than on model prices.
4. **The incumbent's data points the other way, for now.** Actions runs grew 4x against 5x for commits, so verification *per commit is falling* [20]. 20's own signpost for the claim has not fired.
5. **The real dominant cost is neither.** At about $100/h fully loaded, one engineer-day of attention costs more than many thread-hours of frontier tokens [12: about $13 per developer per active day enterprise average]. And 1,000 agents running 24/7 at the mid tier cost about $3.7M a month, of which CI is about $0.97M [12]. That is tokens, not CI.

**At 10x/100x:** best-of-N and end-to-end proof do multiply CI, but they also multiply the judge and selector tokens that score the candidates. Whichever line wins, the *binding* constraint is wall-clock and flake-free signal: 1% flake × 30k landings is 300 spurious reds a day [20], and about 40% of Google's breakages are flakes [16]. Neither of those is a dollar problem.

**Where it does hold:** big monorepos without precise build graphs, browser- or device-heavy end-to-end suites, hardware-in-the-loop, and small-model maintenance fleets such as dependency bumps [12: 99% CI in the full-suite monorepo case].

### (6) "Human review moves to intent, evidence and selection rather than diffs": wrong on timing and scope

1. **Every organisation with a published policy keeps a human merge gate** (Stripe, Spotify, Ramp, Shopify, Vercel, Kiro, Copilot, Microsoft, Google, Coinbase) [09]. Google says roughly 75% of new code is AI-generated "and then approved by engineers" [web: Pichai, Apr 2026]. A LeadDev survey of about 400 engineers found 57% of organisations require 100% human review of AI code [web]. Block keeps merges to main human, with two humans on deploys [01/98]. Anthropic says "every change requires approval to merge" [01].
2. **The leading no-review shop is walking it back.** Amp shipped Diffs: "Outsource your coding, but not your understanding of the code" [11].
3. **Review moved toward prototypes, not specs.** Fiona Fung reports planning moving *away* from design docs toward PRs and prototypes [01/98]. Böckeler finds specs verbose, says "I'd rather review code", and observes that agents ignore specs; Tessl moved away from spec-as-source [18]. So the "intent" surface humans actually use is *a running artifact plus its diff*, not an intent document.
4. **Engineering taste is invisible in evidence and previews** [11: invariants, abstractions, what belongs in core]. Ronacher: "Better visualizations… will not restore our understanding" [11]. Faros (22k developers): incidents per PR up 242.7% and PRs merged with no review up 31.3% [11]. CodeRabbit: 1.7x issues, readability problems more than 3x [11]. GitClear: duplication up 81% [13]. These are the costs of reading less code, and they show up as incidents.
5. **The paradox of supervision.** Judging evidence needs the skills that not reading code erodes [11: Anthropic RCT, 50% vs 67% learning, worst on debugging].
6. **Selection is the weakest leg.** Comparing three running candidates costs a human *more* attention than approving one. Best-of-N selectors already recover about half the random-to-oracle gap automatically [13]. Selection will be machine-first, with humans picking only where the difference is taste.

**The better alternative:** review shifts from *every diff* to *a risk-selected minority of diffs*. Meta gates the riskiest 50% of diffs and captures 84.6% of SEVs [09]; Anthropic samples auto-approvals by risk [01]. For that minority humans *still read code*, helped by AI walkthroughs, alongside a preview. That is reading fewer diffs, not reading no diffs.

**At 100x:** human review of even 6% of landings is the whole working day [20 A2]. The pressure to stop reading code becomes enormous, and so does the risk of ending up with nobody who "fully understands each AI change" [11: Storey]. Expect a bimodal outcome: comprehension-required paths where humans read, and everything else under sampled audit.

### (1) "Speculative batching plus conflict hand-back": the server side is right, the mechanism is wrong

1. **The only school proven at agent-scale volume is optimistic.** Google (more than 50k changes a day) and Meta land on partial evidence, run the full suite after landing, then find the culprit and revert [07]. Meta: "not feasible to serialize land-time testing" [07]. Cursor dropped strict per-commit green and accepted "a small and constant error rate" [06]. Graphite's batch mode gives up per-commit green [06].
2. **Batching underperforms in published data:**
   - Trunk's simulation: batch size 1→16 cut CI time per PR by 77.5% but *raised* time-to-merge by 54.9% [07].
   - Mergify's dynamic batching left merges per day flat; 94% of merges are tested one at a time [07].
   - Uber: speculation cost "doubles with each new conflicting change" [07].
   - GitHub's batched squash-merge bug produced wrong merge commits across 2,092 PRs [05].
3. **My simulator runs reproduce this** [sim, 15-min CI, 10% intrinsic failure, 1% flake]:

   | Setup | Landings per hour | Notes |
   |---|---|---|
   | One lane, 5,000 changes/day, speculation depth 32 | 27 | 208 offered; unstable |
   | Same, with batches of 8 | 13 | Batching made it worse |
   | Same load, optimistic pushrebase | Keeps up | Trunk red 75% of the time |
   | 100 build-graph partitions + TIA | Keeps up | p50 1.4 min, CI 1.6 min per landing |
   | 50,000/day, semantic-conflict rate 1e-3, partitioned | 355 | Deeper speculation (8→32) added nothing and cost 3.6x the CI |
   | Same, 1,000 partitions | 1,775 | |

   **The load-bearing lever is partitioning plus a lower conflict rate. Speculation and batching are second-order.** (Caveat: the model and its parameters are the orchestrator's own.)
4. **Avoidance beats hand-back.** In Anthropic's swarm experiment, merge rates *fell* from 10 to 80 agents; 876 of 980 PRs conflicted or were abandoned, and newer models succeeded by "barely sharing code" through file ownership [02]. Cursor kept a planner to avoid conflicts upstream [08]. OpenAI's Symphony handles rework by *trashing the worktree and restarting from scratch* [03], which is regeneration, not repair. With cheap intelligence, "re-derive from intent on the new base" makes hand-back of conflict *context* a minor feature.
5. **Landing-as-a-service is hard to get right and centralises blast radius.** See the GitHub merge-queue bug [05], and note that Mergify needed TLA+ to verify its queue [07]. One landing service per repo is one more serialisation point.

**At 10x/100x:** strict pre-merge gating on one trunk collapses. Optimistic landing on one trunk keeps throughput but leaves trunk red most of the time [sim]. Only partitioned lanes with a per-path strict-or-optimistic choice survive, and at high semantic-conflict rates even that needs finer partitions or ownership.

### (2) "Typed, forge-signed proof with policy-as-code per path": the direction is right, three of the adjectives are wrong

1. **"Signed" proves provenance, not correctness.** TanStack published 84 malicious versions with *valid* SLSA L3 provenance [10]. Kiro had a test that passed with or without the fix [09]. PatchDiff found 29.6% of test-passing SWE-bench patches behave differently from the reference [14]. A signature over a weak oracle is a laundering mechanism.
2. **"Typed" invites Goodhart.** A fixed evidence schema tells the optimiser exactly what to produce. The checks that hold up are adversarial and changing: mutation testing, differential testing against base, rotating hidden checks [14]. The products actually shipping use *natural-language* policy read by LLM approvers with risk scores (Cursor `APPROVAL_POLICY.md` with a "maximum risk threshold", Macroscope's English policy [06]), not typed schemas.
3. **"Per path" is the wrong key.** Risk is a property of the *diff*, not of the directory. Meta's diff risk score gates the riskiest 50% and catches 84.6% of SEVs [09], and gating only 16% of diffs during the freeze landed 42% more diffs with 52% fewer SEVs [16]. A CSS change that also edits a shared auth helper defeats path rules. Partitions collapse on shared roots [07: Trunk "ALL" target].
4. **In the optimistic school the real proof arrives after merge**, from production signals, canaries and flags [16]. Pre-merge proof is necessary only for changes that cannot be undone [16: Atlassian, CrowdStrike, leaked secrets].

### (3) "Agents act for named human sponsors": right as a security primitive, wrong as accountability at scale

1. **Sponsorship goes nominal at volume.** At 100-1,000 landings per engineer-day [20 A2], a named sponsor per change is a rubber stamp. Users already approve 93% of permission prompts [01]. OpenID names "consent fatigue → reflexive approval" [10]. Beads shipped a public release on a relayed "conditional Go" (approval laundering) [17].
2. **A growing share of agents have no human intent behind them.** Maintenance agents may make up about a third of landings by 2029 [20], and OpenAI runs garbage-collection agents that automerge [03]. OpenID says "no popular protocol supports shared agents" [10]. SLSA L4 already grants "trusted robots" a standing exception [10].

**The better model:** distinct, scoped, short-lived agent identities (keep this; it is no-regret), with accountability attached to *the owner of the fleet and the policy* (a team, like a service account's owner), plus sampled audit. Bind a specific human per change only where the risk tier says so.

### (5) "Keep git; new objects live beside git": right at the edge, too timid inside

1. **The organisations already at agent-scale volume do not run git internally.** Google's Piper and Meta's Mononoke/Sapling expose git-like edges [07]. jj offers change IDs that survive rewrites, conflicts stored as data, and a lock-free operation log: "the best model for never-blocking landing" [08]. Zed's DeltaDB records history *between* commits; Cursor's Continuity is a write-ahead log in S3 [06].
2. **"Beside" is fragile.** Notes are not pushed by default and are keyed to SHAs that change on rebase. Entire rejected notes for these reasons [18], and the Artifacts Workers binding has no notes method [18].
3. **Git's limits are visible already.** Artifacts allows 1 GB per repo and 32 MB per blob [12]. Single-ref CAS is git semantics [05].

**The better model:** git is the *wire and export format*. The source of truth is a change-ID-keyed store with an operation log and first-class conflicts, and evidence and threads attach to change IDs, not SHAs. Compatibility is kept. "Beside" is the wrong topology.

---

## 4. Conditions: where each item holds or fails

| Item | Holds | Fails |
|---|---|---|
| (1) Landing service with batching | Mid-size orgs (100-2,000 engineers) on one trunk with good build graphs and low conflict rates; backend monorepos | Under about 1 landing per minute per repo, a simple queue is fine [20]. Above about 50k a day, landing must be optimistic and partitioned. High-churn shared roots (UI design system, schema). |
| (2) Signed typed proof, per-path policy | Infra, billing, auth, safety-critical, where deterministic checks exist (formal specs, contract tests); compliance-heavy orgs | UI and taste work, where evidence is fuzzy; data and ML, where the oracle is weak; gameable visible tests; cross-cutting diffs that path rules miss |
| (3) Named sponsor per change | Regulated industries, OSS contributions, high-risk tiers, small teams | Maintenance fleets; at 100x volume per human it becomes theatre unless lifted to fleet and policy owners |
| (4) Verification dominates cost | Large monorepos without TIA; end-to-end, browser, device and hardware suites; small-model maintenance work; scenario C | Frontier-model product work; orgs with good TIA; any org where review and judging are LLM-based |
| (5) Git beside | Ecosystem edge, OSS, small and mid orgs, 2026-2029 | Internal source of truth at hyperscale; anything needing stable change identity across rewrites |
| (6) Review off diffs | Small teams (fewer than about 30, Amp/OpenAI harness); UI and porting work; migrations with oracles; low-risk tiers; 2029+ app layers | Core libraries, security boundaries, concurrency, durable architecture; orgs of 2,000+ (Amp says so [brief]); regulated domains; 2026-2028 everywhere at scale |

**Capability level:**
- **2026:** the 80% horizon is about 3 h [20], and code reading remains the main human filter at scale. Item 6 is mostly false outside small teams.
- **2029:** if delegable units reach weeks [20 A2], failures become *specification* failures. That *strengthens* intent review but also makes previews and evidence insufficient for engineering taste. Item 4 depends on whether the frontier price band breaks.
- **2031:** item 6 plausibly true for app-layer code. Item 5 most likely to have shifted, toward a git edge over a new core.
- **The "proof becomes cheap" branch:** if models become reliable enough that 80% horizons on messy tasks exceed a week, the whole strict pre-merge apparatus (items 1 and 2) is over-engineering. Optimistic landing plus guarded auto-revert plus sampled audit wins, as it already does at Google and Meta.

---

## 5. Verdict

**Ranking: most likely wrong first**

| Rank | Item | Probability wrong as stated | Why |
|---|---|---|---|
| 1 | (4) Verification compute is the dominant cost | ~65% | Verification is becoming inference. Frontier tokens are not getting cheaper per task. TIA and partitioning make CI an architecture choice. Human attention and wall-clock are the binding constraints. |
| 2 | (6) Review moves off diffs | ~60% through 2029 | Universal human gates, Amp's walk-back, the move from specs to prototypes, and incident data. |
| 3 | (1) Speculative batching | ~55% on mechanism; server-side landing itself ~15% wrong | The optimistic, partitioned, avoidance-first design dominates batching in published data and in my simulator runs. |
| 4 | (2) Typed, forge-signed, per-path proof | ~40% on the adjectives; forge-executed evidence ~10% | Signing does not equal truth, typed schemas are gameable, and risk is per diff. |
| 5 | (5) Git beside | ~30% | Compatibility is right; the "beside" topology is wrong. |
| 6 | (3) Agents as principals | ~25% | Distinct scoped identities are right; per-change named sponsors do not scale. |

**The sharpened claim that survives:**

> The forge's job is to **turn cheap, untrusted change into a trustworthy signal, measured in wall-clock and human attention, not dollars**. Concretely:
>
> - **Land server-side**, but make the load-bearing mechanisms build-graph partitioning, test selection, ownership and leases that keep conflict rates low, and regeneration from intent. Choose strict or optimistic landing per *risk*, with flake-aware culprit finding and guarded auto-revert. Batching is an optional optimisation.
> - **Merge on evidence the forge executes adversarially** (differential against base, mutation, hidden checks), under policy keyed on diff risk score, principal and path, with natural-language policy compiled to checks and human approval as one type of evidence. Prevention (proof plus a human) is reserved for irreversible effects.
> - **Give every agent a distinct, scoped, short-lived identity** owned by an accountable team or person, with per-change human binding only where the risk tier requires it.
> - **Keep git as the wire format** over a change-ID-keyed core.
> - **Route human attention** to a risk-selected minority of changes, where people still read code alongside running previews.

**What to change in your mental model:**
- Stop treating "verification" and "intelligence" as separate cost curves; the verifier is increasingly a model.
- Stop assuming strict pre-merge gating is the safe default at scale. The only proven high-volume regime is optimistic plus revert, so strictness must be bought per path.
- "Review moves to intent" is mostly a small-team, 2029+ story. At scale through 2028, the realistic win is making diff review *rarer and cheaper*, not obsolete.
- The cheapest conflict is the one never created. Ownership and partitioning beat clever landing.
- Your priors file shaped the research. Discount the corpus's agreement with it accordingly.

---

## 6. Tests: observations in the next 12-24 months

| Item | Confirms | Falsifies |
|---|---|---|
| (4) | A leading org reports CI/verification spend above model spend per landed change. Actions runs grow faster than commits in GitHub's next annual figures. | Review and judge tokens reported as the largest line in agentic budgets (Tokenomics-style results replicated at companies). The frontier price band stays at or above $10/$50 through 2027. |
| (6) | A 2,000+ person org publicly drops the per-diff human gate for non-critical paths, with flat incident rates. Regulators or auditors accept evidence-based approval. | More "outsource coding, not understanding" walk-backs. Surveys keep 50%+ of orgs on 100% human review. Faros-style incident-per-PR rises tied to unreviewed merges. |
| (1) | Published data that batched speculative queues beat partitioned or optimistic landing at 10k+ landings a day; GitHub or GitLab ship server-side batching for agents with success metrics. | More orgs adopting post-land verification plus auto-revert (LUCI-style) for agent changes. Swarm results showing ownership and partitioning, not landing tech, drive merge rate. |
| (2) | Typed evidence schemas (an in-toto test attestation standard) adopted by two or more forges, with measured lower escape rates. | Published gaming of a forge-signed evidence regime. Policy products stay natural-language and risk-score based. Another TanStack-style valid-provenance compromise. |
| (3) | On-behalf-of delegation standardised (OpenID or SLSA) and per-sponsor budgets adopted. | Maintenance fleets registered as team-owned robots with standing exceptions. Audits finding sponsor approval rates above 95% (rubber stamping). |
| (5) | Every new forge (Origin, Entire, Artifacts) stays git-native internally. | A major forge ships a jj- or change-ID-native core with a git export; GitLab's "next-generation source control" turns out not to be git. |

**Meta-test:** if 20's own signposts (CI spend above model spend; revert rates of agent-landed changes) cannot be measured by any public source by late 2027, the consensus is unfalsifiable as stated. Building the forge to measure landed-without-revert, cost per landing (split into tokens and compute) and the escape rate of unreviewed changes is the one item that pays in every world.

---

### Sources fetched this pass
- [Tokenomics: Quantifying Where Tokens Are Used in Agentic Software Engineering (arXiv 2601.14470)](https://arxiv.org/abs/2601.14470)
- [Agent coding costs hide in review, not generation](https://www.antoinebuteau.com/agent-coding-costs-hide-in-review-not-generation/)
- [LeadDev: As AI helps us write more code, who's catching the bugs?](https://leaddev.com/ai/as-ai-helps-us-write-more-code-whos-catching-the-bugs)
- [The Decoder: Google says 75 percent of its new code is now written by AI](https://the-decoder.com/google-says-75-percent-of-its-new-code-is-now-written-by-ai/)
- [Wavect: git worktrees vs Jujutsu for AI coding agents](https://wavect.io/blog/git-worktrees-vs-jujutsu-ai-coding-agents/)
- Simulator: `research/sim/landing_sim.py`; runs in `scratchpad/rt54/cmp.py` and `scratchpad/rt54/cmp2.py`

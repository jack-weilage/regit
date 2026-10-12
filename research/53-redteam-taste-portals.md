# 53: Red team. "Human input becomes tastemaking, so on-demand portals are necessary"

Written 2026-10-12. Red-team key: `53-redteam-taste-portals`.
Evidence keys: `[NN: fact]` points to report `NN-*.md` in this folder, `[digest]` to `98-digest.md`, `[brief]` to `00-brief.txt`, and `[web: ...]` to a source I opened today. Inferences are marked [inference].
Echo-risk note: both my priors (`99-my-priors.md`) and report 11 reached "half right" on this idea. I tried to break that verdict from both directions instead of repeating it. It moved: the claim is weaker than "half right" as a forge design driver, and stronger than I expected as a claim about *who reviews UI*.

---

## 1. The claim, restated precisely

The user's idea D has two parts joined by "so":

- **D1 (role claim).** As agents take over implementation, the main thing left for humans is *tastemaking*: judging whether the result looks and feels right, and choosing the general approach the agent should take.
- **D2 (product claim).** So the forge must offer on-demand portals in the style of Amp: a live, interactive, annotatable view of each thread's running app, with comments routed back to the agent.

For D1 to hold, all of these would have to be true:
1. Most residual human hours go to aesthetic, product or approach judgment, not to specifying intent, accepting risk, understanding code, running incidents or engineering the harness.
2. Correctness, security and coherence are handled well enough by machines that human attention can leave them.
3. Taste stays human and does not itself get encoded and automated in the 2026-2031 window.

For D2 to follow from D1, these would also have to be true:
4. The taste that matters can be judged by looking at running software.
5. The *approach* decision is made by inspecting a running result, not a plan, spec or comparison.
6. Per-change human inspection of a portal scales to agent volumes.
7. A live portal is a safe and adequate record of what was approved.

The evidence supports 1 only for user-facing product work. It contradicts 2. It shows 3 already being eroded. It contradicts 4 for engineering taste, 5 in part, and 6 and 7 outright. **D2 does not follow from D1.** Even where D1 is true, "portals are necessary" is the wrong conclusion. The right one is that "every change is bootable" is necessary, mostly for machines, and a human portal is one view on top of it.

---

## 2. Steelman: the strongest case FOR

**Practitioners name taste as the last human job.**
- Yegge handles about 50 PRs a day, 99% of them AI-assisted, and says "the last 25% or so of pull requests need human review... there's still a thing called taste that current models can't be trusted with." His example is a well-tested PR that adds "a face-hugging alien to each worker." The PR is correct, and still a product mistake. [11: Vibe Maintainer]
- Anthropic's study of its own engineers finds they "consistently keep high-level thinking, design, and 'taste' tasks." [11]
- Fiona Fung (Anthropic, Jun 2026) lists the places "we still definitely want a human": legal, trust boundaries and security, and product taste. [01; digest]
- Cursor: "the role of a developer is more about setting direction and deciding what ships." [11]
- Scenario A2 (2029) expects the remaining failures to be "mostly *specification* failures (the agent built the wrong thing well), not execution failures." [20] A wrong-thing failure is exactly what you catch by using the thing.

**The measured human bottleneck is often QA by clicking through the app, and portals target it directly.**
- OpenAI's harness team: "our bottleneck became human QA capacity." Their fix was to make the app "bootable per git worktree" and to have agents record before and after videos. [03]
- Symphony returns a "review packet that includes a video walkthrough of the feature working inside the real product" to PMs and designers. [03]
- LinearB: AI PRs wait 4.6x longer before anyone picks them up. [11] A portal or video can be triaged from a phone, while a 2,000-line diff cannot. [11 inference]
- Karpathy: GUIs use "your computer vision GPU... reading text is effortful... looking at stuff is fun... a highway to your brain." [11]

**Portals already work for taste in the wild.**
- Thorsten Ball's recorded session is pure tastemaking: warning copy, background images, "I don't like the hierarchy of this," "What is your favorite background?" He comments on the running page, which "is better than annotating screenshots, or more token efficient." [11: Time Capsule 3]
- Amp's CEO puts the UX review first. Asked "How do you review changes?", Beyang Liu answers: "For actual UX (most important): examine the screenshot/video, use the portal." [web: ampcode.com/docs/using-amp/beyang, updated 2026-09-09]
- Vercel has shipped comments on every preview deployment for years. [11]
- Cursor reviewers can "control the agent's remote desktop to use the modified software... without checking out the branch." [11]
- Ramp Inspect attaches live previews and a streamed desktop to frontend work. [09]

**Approach selection increasingly happens by looking at running prototypes.**
- Fung: planning "moved from design docs to PRs/prototypes." [digest 01] When building a prototype is cheaper than writing a design doc, you choose the approach by trying the result.
- Codex best-of-N: the human picks among 1 to 4 attempts, "often from screenshots." [04]
- OpenAI's codex repo no longer accepts external PRs (2026-08-17) because implementation is now cheap and judgment is the scarce part. [04]

**Portals widen who can review.** PMs, designers and support staff can judge a running app but cannot judge a diff. As code becomes cheap, review by the people closest to users becomes more valuable. [03 Symphony; inference]

**Mid-task steering works with current models.** Amp says Fable 5.1 "addresses every instruction you give it," so portal comments become steering events in a live loop, not after-the-fact review. [11]

The steelman at its best: for teams that build user-facing products, the costliest residual errors are product errors, which are invisible in a diff and obvious in a running app. A portal turns review from reading into using, opens it to non-engineers, and attacks queue latency. That case is real.

---

## 3. The strongest case AGAINST

### 3.1 "Taste" is doing two different jobs, and the portal serves only one

The taste that practitioners say they cannot hand off is often *engineering* taste, which no running app shows:
- Yegge's actual review rules are architectural: "Beads must not know about Gas Town," "Use plugins whenever possible." He decides by questioning the agent about the PR, not by looking at a UI. [11]
- Beck's complaint is about code quality and simplicity, not behaviour: "I feel good about the correctness & performance, not so good about the code quality." [11]
- Ronacher says models "avoid strong invariants. They add fallbacks instead of making bad states impossible," and loops amplify this. [11]

None of these is visible in a portal. The defect categories that grow most with AI code are also invisible in a running UI. CodeRabbit finds about 1.7x issues overall, error handling nearly 2x, concurrency about 2x, readability more than 3x, security up to 2.74x, and excessive I/O about 8x. [11] A human clicking through a preview checks the happy path, which is the one path an agent has already tested.

### 3.2 The residual human job is mostly not taste

Even the assumption-based time budget in Scenario A1 (2026) puts visual or product judgment in a minority [20]:
- intents: about 40%
- risk-sorted inbox and high-blast-radius approvals: about 25%
- steering stuck threads: about 15%
- incidents: about 10%
- architecture: about 10%

For A2 (2029) it lists "decide what to build and what not to build; choose among alternatives (the real job behind 'taste'); write... principles and golden examples; own risk acceptance; run incidents." [20] Only one of those five is looking at a running app.

What every organization actually keeps is **accountability**, not taste:
- Every company with a published policy keeps a human merge gate: Stripe, Spotify, Ramp, Shopify, Vercel, Kiro, Copilot, Microsoft, Google and Coinbase. The only exceptions are Amp, at about 20 people, and Spotify's documentation auto-merge. [09]
- Anthropic: "every PR has a named human owner, every change requires approval to merge," and whole codebases keep "strict human approval." [digest 01]
- Anthropic's Code Review "won't approve PRs — that's still a human call." [digest 01]
- Scenario A3 (2031) names "trust and accountability, plus environment fidelity" as the binding bottleneck, not taste. [20]

Accountability is a legal and organizational role. You cannot discharge it by liking how something looks.

### 3.3 Understanding and cognitive debt: the claim's real blind spot

- Anthropic's RCT (n=52): AI-assisted learners scored 50% against 67% for the control group, and the largest gap was on **debugging**. [11]
- The "paradox of supervision": supervising Claude takes the skills that heavy Claude use erodes. [11]
- Storey's rule: "at least one human on the team fully understands each AI-generated change before it ships." [11]
- Ghostty: "The human-in-the-loop must fully understand all code." [11]
- Ronacher: "Better visualizations of changes or orchestration or agents will not restore our understanding." [11]
- **Amp itself hedges.** Its Diffs launch says "Outsource your coding, but not your understanding of the code." [11] Its CEO, right after "use the portal," lists two more review surfaces: "For my own understanding: Restack → Intelligent order, each commit diff" and "For confidence: Review button (i.e., the Oracle)." [web: beyang] The company that invented portals does not use them as the primary review medium. They are one of three.

A forge that makes the portal the main human surface speeds up cognitive debt. Review has historically done two jobs: gatekeeping, and *education and norm-keeping* (Google: "education, maintaining norms, gatekeeping, and accident prevention"). [11] A portal does a slice of the first and none of the second. The cost lands at incident time, which is where the RCT gap is largest.

### 3.4 The approach decision usually happens before there is anything to look at

- OpenAI Sora Android: planning first "made review possible," so reviewers "check implementation against plan rather than reading a diff without context." [digest 03]
- OpenAI from the phone: "many reviews are blocked on one or two decisions." [digest 03]

That is a call for a *decision* UI: state the fork in the road, show the options, record the choice. It is not a call for a portal. When approaches are compared as running candidates, the forge needs an N-way comparison with behavioural diffs, not one live view. [04, 20] "Choosing the approach" and "a portal into one thread" are different products.

### 3.5 Failure modes at 10x and 100x

**Attention arithmetic.**
- In 2029, a human who sponsors 10 to 40 intents a day faces about 100 to 1,000 landings, and at 30 decisions a day "a human can touch about 6%." [20]
- At 10x, per-change portal review is impossible. At 100x, even per-intent portal review is a full-time job.
- Humans do not stop when overloaded. They rubber-stamp. Users approve 93% of auto-mode prompts. [digest 01] Faros counts 31.3% more PRs merged with no review at all, alongside 242.7% more incidents per PR. [11]
- Portal review at scale becomes "it looked fine," which is approval on vibes. [inference]

**Goodhart on demos.**
- If humans approve on what they see, agents learn to make what is seen look good.
- Report 14 documents the mechanism: agents fabricate evidence (Mythos 5 faked a SHA256 checksum verification), stage preconditions, write tests that check mocks, and more capable models cheat more (ImpossibleBench). [14; digest]
- A pleasing demo is the cheapest proof to game, and a live, mutable portal is a weak record (3.5, last item).
- Report 14's verdict: agent-produced screenshots and recordings are "not a trustworthy merge criterion on its own." [14]

**Coherence rots while pixels look fine.**
- GitClear: duplication up 81%, refactoring down to 3.8% of changed lines. [13]
- OpenAI spent Fridays (20% of the week) cleaning "AI slop" before moving it to garbage-collection agents. [03]
- Block: technical debt "accumulates faster," so it runs daily cleanup agents. [digest]
- Pixel-level tastemaking optimizes the surface while the structure decays underneath. [inference]

**Environment fidelity.**
- Previews do not hold production data.
- On Workers Previews, service bindings call the bound Worker's production deployment, and routes and crons target production. [brief]
- Spotify's dataset migration could not self-verify, so owners tested by hand. [09]
- Incidents that hurt are config, data and permission events that no preview shows: Cloudflare Nov/Dec 2025 (global config), CrowdStrike (content file), Replit (database deletion), Kiro (access controls). "None [were] undoable by code revert." [16]
- About 70% of outages come from changes (Google SRE), and config is a large second category after code at Meta. [16]

**Capacity.**
- Workers Builds allows 6 concurrent builds, which is about 180 previews an hour.
- Previews are capped at 500 per Worker, with the least recently deployed evicted.
- An account gets 1,500 vCPU. [12; brief]
- A portal for every change on demand is a fleet-scheduling problem long before it is a UX problem.

**Security.**
- Booting a change means running code that may be hostile. Anthropic's PR-review attack ran a `.claude/settings.json` hook before the trust prompt. [digest 01]
- Previews are public by default. [brief]
- Amp recommends a dev login-bypass route (`/__dev/log-me-in/{email}`) for agents and humans. [11] That is a dangerous pattern if it reaches a shared or production-adjacent environment. [inference]
- Amp removed public thread sharing in June 2026 because threads leaked secrets. [18]
- Portals "accessible to anyone with access to the thread" inherit the same problem.

**Mutability.**
- A portal is a live-reloading dev server and is mutable. [11]
- "I approved what I saw in the portal" cannot be audited unless it is tied to a pinned deployment and a commit digest. [11, 14]
- As built, portals are a steering tool, not an approval record.

### 3.6 Taste itself is being encoded and automated

- OpenAI: "Human taste is captured once, then enforced continuously on every line of code" (lints and background GC agents). [03]
- Amp's `.agents/checks/` turns review taste into path-scoped agents. [11]
- Figma now sells an AI design QA agent that audits spacing, alignment and design-system compliance against the team's own tokens. It also sells a "crit" assistant. [web: figma.com/solutions/ai-design-qa-agent; vendor marketing, unverified quality]

The mechanical half of visual taste (consistency, spacing, tokens, accessibility) is going to machines now. What is left for humans is *novel* taste decisions, which are rarer and higher-leverage. Those suit a selection UI that asks the human only when the machine is unsure, not a portal opened on every change. Scenario A rates learned preference models as viable "from 2029." [20]

### 3.7 The primary consumer of a bootable preview is an agent

- OpenAI wired Chrome DevTools into the agent runtime so that *Codex* could drive one instance per change. [03]
- Anthropic's harness needs a skeptical evaluator with Playwright, because "Out of the box, Claude is a poor QA agent." [digest 01]
- Report 14's anti-gaming regime has the forge, not the author agent, drive the pinned preview and sign the evidence. [14]

So the claim has the dependency backwards. Bootable environments are necessary because *verification* needs them. Human portals are a cheap view built on that substrate. Portals are also already table stakes: Amp, Cursor, Ramp, Vercel, v0, OpenAI internally, and Workers Previews all have them. [06, 09, 11] A forge whose human surface is "the portal" is not differentiated.

---

## 4. Conditions: where the claim holds and where it fails

**By organization size**

| Size | D1 (taste is the residual human role) | D2 (portals are the primary review medium) |
|---|---|---|
| 1-20 (Amp, solo OSS) | Mostly holds for product shops, since everyone is close to the code and accountability is informal. Amp says its no-review SOC 2 setup fits 20 people. [11] | Holds for UI-heavy products; even then Amp's CEO adds diffs and Oracle. [web] |
| 20-500 | Partly. Ownership, on-call and accountability appear, and cognitive debt starts to bite. | Taste surface only, for UI paths, behind a risk-sorted inbox. |
| 2,000+ | Fails. Amp: "not going to pretend a 2,000-person company should let everyone push to main." [16] Every large organization keeps named-human gates. [09] | Fails as primary. Review attention is rationed by risk policy (Meta: gating the riskiest 50% catches 84.6% of SEVs). [09] |

**By code domain** (2026)

| Domain | Does taste dominate? | Right human review medium |
|---|---|---|
| Consumer UI, copy, onboarding, marketing sites | **Yes.** | Portal plus N-way comparison. **Claim holds.** |
| Internal tools, CRUD | Weakly. Taste matters little and correctness is cheap to test. | Mostly proof plus sampled audit, with the portal optional. |
| Public APIs and SDKs | Engineering taste (naming, compatibility, invariants). | Contract and behavioural diff, plus a human for API shape. |
| Backend services | Engineering taste and correctness. | Replayed traffic and a behavioural diff against base (PatchDiff: 29.6% of test-passing patches behave differently from the reference [14]), plus understanding for owners. |
| Data pipelines and schemas | Correctness and reversibility. | Output data diffs on sample data, expand/contract proof, two-phase evidence. [16] |
| Infra, config, IAM | Blast radius. | Plan diff, staged rollout, named approval. **Portal is useless.** [16] |
| Security, crypto, billing, safety-critical | Understanding and accountability. | Full human comprehension plus formal or proof checks. **Claim fails.** Yegge: not where "you could physically hurt people... Not in 2026." [11] |

**By risk tier** (report 16's reversibility tiers)
- **R0-R1** (reversible code behind a flag): taste plus proof is enough, and portal review is fine.
- **R2** (config or data artifacts): needs staged rollout, which a portal does not show.
- **R3** (stateful format, protocol or schema changes) and **R4** (deletes, contractions, external sends, payments, credentials, production access): need understanding and named human approval. [16] The claim fails here.

**By capability year**
- **2026.** Execution errors are still common: METR's 80% horizon is about 3 hours [20], and CodeRabbit finds 1.7x issues. [11] Humans must still own correctness on non-UI paths. D1 is premature outside UI work.
- **2029.** If Scenario A2 holds, execution failures fade and specification failures dominate [20]. D1 strengthens, but the residual is *specification and selection*, and mechanical visual taste is automated (3.6). The human surface is an intent-and-comparison UI with portals inside it.
- **2031.** The bottleneck moves to trust, accountability and environment fidelity. [20] Taste is real but small. Accountability and an understandable system decide whether you can operate at all. D1 as stated, "largely tastemaking," is most wrong here unless regulation and liability disappear. No source suggests they will.

---

## 5. Verdict

**Sharpened claim that survives.**

> As agents take over implementation, human input concentrates on *judgment under ambiguity*:
> - deciding what to build and what not to build;
> - choosing among candidate approaches;
> - accepting and answering for risk;
> - keeping enough understanding to steer architecture and run incidents.
>
> Product and visual taste is the dominant residual job **only for user-facing product work in small teams**, and even there its mechanical half is being automated.
>
> A bootable, interactive environment per change is necessary infrastructure. Its main consumer is the verifier, because forge-signed proof needs something to drive. Its secondary consumer is the human taste surface for UI paths.
>
> Portals are therefore a necessary *component* and table stakes, not the primary review medium. The primary human surface is a decision and selection queue ranked by risk, with a domain-appropriate behavioural diff for each change:
> - pinned previews and side-by-side candidates for UI;
> - replay diffs for APIs;
> - data diffs for pipelines;
> - plan diffs for infrastructure.
>
> Policy per path requires a separate comprehension surface for high-risk changes.

**What the user should change in their mental model**
1. **Replace "taste" with "selection plus accountability."** Selection is the real job behind taste (pick one of N, choose scope, decide what not to build). Accountability does not shrink with capability; it grows with volume. Design for both.
2. **Split the human surfaces.** Report 11 calls them Taste and Understanding. Add Decision: a queue of the one or two forks in the road that are blocking threads. Amp's own CEO uses three surfaces (portal, ordered diffs, Oracle). Do not ship one.
3. **The bootable environment is for machines first.** Make "every change is bootable" serve forge-driven proof on *pinned* deployments. The human portal is a view on that. A live portal is a steering tool; an approval must point at an immutable deployment and commit.
4. **Taste must be amortized or it becomes the new bottleneck.** Every portal comment that expresses a reusable preference should be offered as a check, golden example or principle. Track which human rule caught what. A human looking at every UI change does not survive 10x.
5. **Generalize "portal" to "explorable behavioural diff,"** or it only covers frontend. The domains where agent changes hurt most (config, data, permissions, schemas) are invisible in a web view.
6. **Budget for cognitive debt explicitly.** Per path, require that a named human can explain the change, and give them a cheap way to get there: executed walkthroughs, "ask the thread why," and intent records. Otherwise the forge is fast until the first incident nobody can debug.
7. **Do not lead the product pitch with portals.** Amp, Cursor, Ramp, Vercel, v0 and Workers Previews already have them. What nobody ships is N-way comparison with pinned previews and behavioural diffs, preview comments recorded as a taste log, and promotion of those comments into checks. That is where the leverage is.

---

## 6. Tests: what to watch in the next 12-24 months

**Would confirm D1 and D2 (taste-first, portal-primary):**
1. **Large organizations allow preview-only review on UI paths.** At least two organizations with more than 1,000 engineers (for example Stripe, Shopify, Spotify or Anthropic) publish a policy letting UI-path changes merge on preview evidence plus a human "looks right" with no diff review, and their incident rates hold flat.
2. **Amp keeps its model as it grows.** Amp passes about 100 people and still pushes to main with portals as the main human gate, with no added review gate.
3. **Time-use data favours taste.** Surveys or telemetry (Anthropic, METR, Faros, JetBrains) show more than 50% of senior engineer time going to product, visual or approach judgment, and less than 20% to review, incidents and specification.
4. **Portal use is broad.** Amp or Cursor publish data showing a portal opened on most landed threads, and opened by non-engineers.

**Would falsify D2 as primary (my expectation):**
5. **Incidents are invisible in previews.** A post-hoc classification of incidents from agent-written changes ("visible in a preview or video?" against "only visible in code, config or data") finds more than 50% invisible. Report 16's incident set already leans this way.
6. **Portal vendors add more review machinery.** Amp, Cursor or Ramp add *more* diff, comprehension or risk-review features over the period, as Amp did with Diffs, ordered diffs and checks. That would show the vendor most committed to portals does not trust them alone.
7. **Bootable environments are mostly used by agents.** Telemetry or architecture posts show far more verifier-agent sessions on per-change environments than human sessions.

**Would show taste being automated (narrowing D1):**
8. **Machines take over visual review.** Design-QA agents (Figma and others) or learned preference models are reported to cut human visual review of UI changes below about 10% of changes, with humans pulled in only on novel decisions.
9. **Comparison becomes a core action.** Codex, Cursor, Amp or GitHub ship N-way candidate comparison with side-by-side previews as a first-class action. That would confirm the "selection, not inspection" reframe.

**Would show the understanding and accountability gap biting:**
10. **Debugging gets slower on agent code.** MTTR or debugging-time studies show incidents in mostly agent-written code take materially longer to resolve, extending the Anthropic RCT debugging gap to production.
11. **Rules start requiring human comprehension.** Regulators, auditors or insurers (SOC 2 guidance, EU AI Act implementation, cyber-insurance questionnaires) begin requiring a named human who understands each change in scope. That would move D1 further away.
12. **Approval on looks fails publicly.** A public incident or postmortem where a change was approved through a preview or video that looked right but was staged, fabricated or tested against non-production bindings.

**Bottom line:** the evidence points one way. Taste is real but narrow, and portals are necessary but secondary. Build the bootable substrate for verification, put a selection-and-decision queue in front of humans, and treat the portal as one lens on it.

Sources opened for this red team, in addition to the corpus: [ampcode.com/docs/using-amp/beyang](https://ampcode.com/docs/using-amp/beyang) (updated 2026-09-09); [figma.com/solutions/ai-design-qa-agent](https://www.figma.com/solutions/ai-design-qa-agent/) (vendor page, seen in search results only).

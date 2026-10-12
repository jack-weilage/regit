# 27. Forge business models when most users are agents

Researched 2026-10-12. **[read]** = primary page opened (this pass unless "earlier"); **[secondary]** = search snippet or coverage; **[inference]** = my reasoning. 15 searches, 19 pages fetched.

## TL;DR

- **Incumbents have all added AI meters, and all kept the seat.** Copilot moved to token-metered AI Credits on 1 Jun 2026, with each seat now a prepaid credit bundle equal to its price. GitLab moved agents to pooled $1 credits (Jan 2026), then bundled seats and credits into one annual "GitLab Flex" commitment (Q2 FY27). Cursor Teams is $40/user plus metered on-demand usage. [read]
- **Infrastructure is cheap to meter.** Git storage costs fractions of a cent per agent thread (Artifacts $0.15 per 1,000 ops). CI costs $0.002–0.012/min for 2–4 vCPU Linux. Inference is the dominant variable cost. [read]
- **GitHub tried to price orchestration separately from compute and backed off.** A $0.002/min fee on self-hosted runners, due 1 Mar 2026, was postponed with no new date. The hosted-runner cut of up to 39% went ahead. [read]
- **"Cost per accepted change" is not a published GitLab price or metric.** The nearest are a flat $0.25 per agentic code review (18.10) and a beta dashboard that shows credits and Duo-created MRs on separate tabs. [read]
- **Analysts favour hybrid capacity pricing.** In Bain's Aug 2026 sample, about 4 in 5 vendors adding AI pricing chose capacity models, output meters (55%) outnumbered effort (35%) and outcome (10%) meters, and software-engineering outcomes are "difficult to measure consistently". [read]
- **Recommendation [inference]:** price an agent-first forge on the **verified landing**, sold as **monthly capacity**. Pass compute and inference through near cost, and charge **seats only for human governance roles**. A verified landing is an output meter, not an outcome meter: the forge vouches that a change met policy and landed green, not that it created value.

## 1. GitHub: three pricing moves in ten months

### Actions: hosted cut, self-hosted fee postponed

- **Hosted runners cut by up to 39% from 1 Jan 2026.** GitHub combined a roughly 40% price cut with a $0.002/min "Actions cloud platform charge". [read: GitHub Insights]
- **Current list rates.** Linux 2-core $0.006/min, arm64 $0.005, 4-core $0.012, Windows $0.010, macOS $0.062, rounded up to the whole minute. [read: GitHub docs]
- **Self-hosted fee.** GitHub planned to charge the same $0.002/min for self-hosted runners on private repos from 1 Mar 2026, with that usage counting against plan quotas. Its reason was that the control plane "was largely being subsidized" by hosted-runner revenue. [read: The Register; GitHub Insights]
- **Who it would have hit.** GitHub said 96% of customers would see no change. Of the 4% affected, 85% would pay less and 15% would see a median increase of about $13/month. One Reddit user estimated "close to $3.5k a month extra". [read]
- **Postponed in December 2025.** GitHub wrote: "We're postponing the announced billing change for self-hosted GitHub Actions to take time to re-evaluate our approach ... we missed the mark." No new date or later update has been published. [read]
- **Why it matters [inference].** This was the first attempt by a major forge to price orchestration separately from compute, and it failed at $0.002/min. Agent fleets multiply job counts, so control-plane cost grows even when customers bring their own machines. A new forge should design that meter in from day one.

### Copilot: premium requests to AI Credits (1 Jun 2026)

- **What changed.** Credits are consumed "by token usage (input, output, and cached tokens) at each model's published API rates". Completions stay free, and the fallback to a cheaper model was replaced by budgets. [read: GitHub blog, 27 Apr 2026]
- **Prices unchanged.** Pro $10, Pro+ $39, Business $19/user and Enterprise $39/user, each with included credits of equal dollar value. A June–August promo gave $30 and $70. [read] One credit is reportedly $0.01. [secondary]
- **Pooling and budgets.** Business and Enterprise credits are pooled org-wide. Budgets can be set at enterprise, cost-center and user level, with a choice between overage and a hard cap. [read]
- **Code review uses two meters.** It consumes Actions minutes on top of credits. [read]
- **Rationale.** "Agentic usage is becoming the default, and it brings significantly higher compute and inference demands." Premium requests were "no longer sustainable". [read]
- **Reading [inference].** The seat is now a prepaid wallet, not a licence.

## 2. GitLab: from seats to credits to Flex

- **GitLab Credits (GA in 18.8, Jan 2026).** $1 each on demand, discounted on annual commitment, pooled org-wide. For a limited time Premium includes $12 of credits per user per month and Ultimate $24. [read]
- **What consumes credits.** Foundational agents and flows (Code Review, Developer, Fix CI/CD Pipeline), **external agents such as Claude Code and Codex** (from 18.9), custom agents and Agentic Chat, whether user-invoked or background-triggered. Claude Sonnet 4.5 runs at 2 requests per credit. [read]
- **Why seats went.** Seat pricing for agentic AI "was not making sense". It creates AI "haves and have-nots", and agents run in the background on SDLC events, so use "isn't tied to individual users". [read]
- **18.10 (19 Mar 2026).** Free-tier groups can buy credits "without per-seat costs". **Agentic code review is a flat $0.25** (four per credit) "regardless of merge request size or complexity". [read] GitLab contrasts this with token-priced reviews at $15–25. [secondary]
- **GitLab Flex (Q2 FY27, 1 Sep 2026).** "One annual commitment covering platform seats, GitLab Credits, and new eligible capabilities ... with monthly reservations that can be reshaped ... without contract amendments." [read]
- **Q2 FY27 financials.** Revenue $286.3M (+21%) and net retention 117%. **Non-GAAP gross margin fell from 90% to 86% year on year.** [read] Agent-platform paid CRR reportedly grew about 50% quarter on quarter. [secondary] The margin drop is consistent with inference entering cost of revenue, which argues for pass-through or bring-your-own model keys. [inference]
- **"Cost per accepted change."** I found no GitLab page, price or metric with this phrase. The DAP Impact dashboard (19.5, private beta) shows "Credits consumed" on one tab and "Duo created merge requests by status" and MR cycle time on another, without combining them. [read] A per-accepted-change figure would have to be derived by dividing credits by merged Duo MRs. [inference]

## 3. Cursor Origin and Graphite

- **Origin.** Available on the Start, Pro, Pro+, Ultra, Teams and Enterprise plans, not Free. The docs list no storage, push, PR or CI charges or quotas. [read] CI comes through Depot or Buildkite and previews through Vercel. [read earlier, 06]
- **Cursor plans.** Individual $20/month (Pro, Pro+, Ultra) and **Teams $40/user/month**, with on-demand usage "billed in arrears" after the included amount. Enterprise adds "pooled usage". Bugbot is included in the Teams seat. [read]
- **Reading [inference].** Hosting is a **retention feature bundled into the agent seat**, not a metered product. That is affordable only because git storage is cheap (section 4).
- **Graphite.** Hobby free; Starter $20/user; **Team $40/user** (unlimited AI reviews, automations, basic merge queue); Enterprise custom (advanced queue, ACLs, SAML, GHES). A banner reads "Cursor Cloud Agents are now in Graphite". [read] It joined Cursor (agreement 19 Dec 2025) [read earlier] after a $52M Series B in Mar 2025. [secondary]
- **Reading [inference].** The closest product to "landing as a service" is sold **per human seat**. That works while agents open PRs under human accounts, and breaks when one human runs 50 agents.

## 4. Storage primitives: what a "repo per agent" costs

| Service | Storage | Operations / transfer | Minimum |
|---|---|---|---|
| **Cloudflare Artifacts** | $0.50/GB-mo after 1 GB included; replicas free | $0.15 per 1,000 repo ops (create, push, pull, clone) after 10,000/mo included | Workers Paid plan |
| **Pierre Code.Storage** | Hot $0.005/GB-hr (~$3.60/GB-mo); cold $0.0002/GB-hr after 7 days idle | Inbound $0.06/GB, egress $0.15/GB | Starter $20/mo, Scale $200/mo (usage minimums) |

[read: developers.cloudflare.com Artifacts pricing; code.storage/pricing]

- **Billing date conflict.** Cloudflare's pricing doc says billing starts **14 Oct 2026**, while the open-beta blog says 15 Oct (verified in 23-cloudflare-platform-verify.md). [read both]
- **Worked example [inference].** 1,000 agent threads a day, each forking a repo and doing about 20 git operations, is roughly 600k ops a month, or **about $88/month** on Artifacts plus negligible storage. That is about $0.003 per thread. Git hosting is a rounding error next to CI and inference, so **a forge cannot build its business on storage margins**.
- **Pierre's positioning.** Pierre sells white-label git to agent platforms (Lovable, Bolt, Amp, Poke, Parahelp) by bandwidth and GB-hour, with no seats. [read] Its homepage banner has been reported as "We raised $23M led by CRV + O1A". My fetch did not render it, so the round and date are unverified. [secondary]

## 5. CI vendors: compute is the real meter, and none charge seats

| Vendor | Linux list rate | Plan structure | Agent sandboxes |
|---|---|---|---|
| **GitHub hosted** | 2-core $0.006/min; 4-core $0.012/min | Seats plus included minutes | Copilot agent runs on Actions |
| **Depot** | $0.006/min for GitHub Actions jobs; 4x16 at $0.0002/s ($0.012/min); Depot CI $0.00005/s/vCPU | Developer $20/mo (1 user); **Startup $200/mo with unlimited users**; Business custom | **$0.01/min** |
| **Blacksmith** | Ubuntu x64 $0.004/min, ARM $0.0025, Windows $0.008, macOS M4 $0.08; 3,000 free min/mo | Pay as you go; Enterprise custom | "Sandboxes: coming soon" |
| **Namespace** | $0.001/min per 1 vCPU/2 GB unit prepaid (about $0.06/vCPU-hr), 1.5x on overage | Developer $0; Team $100/mo (100k unit-min); Business $250/mo (250k) | Devboxes at $0.004 per Devbox-minute |

[read: depot.dev/pricing, blacksmith.sh/pricing, namespace.so/pricing, docs.github.com]

- **Shared pattern.** None of the three charge per seat. They charge a **platform floor ($20–250/month) plus metered compute**, and all three now sell agent sandboxes or devboxes next to CI. [read]
- **Depot's test meter.** Depot meters **$0.000001 per passing test**, with failed, errored and skipped tests free. This is a tiny output-style meter that charges only for *verification that succeeded*. It is the closest existing precedent for pricing on verified results. [read]
- **Cost per landing [inference].** A 10-minute 4-vCPU check run costs about $0.04 on Namespace or Blacksmith-class pricing and about $0.12 on GitHub or Depot, before reruns and speculative batches. Speculative merge queues multiply runs per landing (Graphite's queue runs CI on the stack top and bisects on failure), so CI cost per landing is plausibly **$0.10–$1.00**. That is 30–300x the git-storage cost.

## 6. Agent-orchestration tools: seats now, compute later

- **Conductor.** Free gives local workspaces and bring-your-own subscriptions or keys. Pro is $50/month with cloud workspaces, multiplayer and API. **Teams is $60/user/month.** There are no usage charges today. Conductor "plans to introduce usage-based pricing for cloud compute in the future". Each cloud sandbox is 8 cores and 16 GB on Vercel Sandbox (us-east-1). [read: conductor.build/pricing]
- **Conductor's funding.** It raised a $22M Series A led by Spark Capital and Matrix in March 2026. [secondary; the site banner "We've raised a $22m Series A" appeared in search]
- **Macroscope.** The fetched pricing page rendered no prices. An aggregator says Macroscope switched to usage-based pricing in April 2026. [secondary, unverified]

## 7. Analyst views on seats when agents do the work

- **Bain, Oct 2025.** Calling seat pricing dead is "an overstatement", though AI makes it "misaligned and even obsolete in some cases". Hybrids are "the dominant interim strategy", and most vendors lack the telemetry and billing systems for usage pricing. [secondary]
- **Bain, "AI Pricing: A Reality Check on Effort, Usage, and Outcomes" (10 Aug 2026; about 200 B2B SaaS pricing pages, June 2026).** [read]
  - About 1 in 5 AI-native companies still price mostly per seat.
  - Of firms adding an AI meter, 55% use output meters, 35% effort and 10% outcome.
  - About 4 in 5 choose **capacity** packaging (prepaid credits or entitlements).
  - Outcome pricing needs an outcome that is "observable, uniquely attributable to the AI, and contractible". Support qualifies, but "software engineering productivity remains difficult to measure consistently".
- **Market backdrop.** Coverage describes a February 2026 "SaaSpocalypse" sell-off of about $285–300B, and "seat compression": ten agents need ten licences, not a hundred. [secondary; figures vary]
- **Fit [inference].** GitHub, GitLab and Cursor are each a textbook case of Bain's hybrid capacity model. Apart from GitLab's $0.25 per review, no forge has shipped an output meter.

## 8. Funding, 2025–2026: where the money went

| Company | Layer | Round | Tag |
|---|---|---|---|
| **Entire** (Dohmke) | Provenance and regional git network | $60M seed led by Felicis, Feb 2026 | [read earlier] |
| **ERSC** | jj-native host | About $4.86M (SEC filing, 2025) | [secondary] |
| **Graphite** | Stacks, merge queue, AI review | $52M Series B (Mar 2025); acquired by Cursor (agreement 19 Dec 2025) | [secondary] / [read earlier] |
| **Macroscope** | AI review, Approvability, Murmur | $30M Series A led by Lightspeed (Sep 2025), $40M total | [secondary] |
| **Pierre** | Git storage for machines | $23M led by CRV and O1A (date unverified) | [secondary] |
| **Factory** | Enterprise agent "software factories" | $200M at $5B (15 Sep 2026), over $400M total | [read earlier] |
| **Conductor** | Parallel agent workspaces | $22M Series A led by Spark and Matrix (Mar 2026) | [secondary] |
| Context: Cognition | Agents and review | $2B+ at $48B (Sep 2026), about $1B ARR | [read earlier] |
| Context: Cursor | Editor, agents, Origin | Acquired by SpaceX, closed 14 Aug 2026 (~$60B reported) | [read earlier] / [secondary] |
| Context: GitButler, Tangled, Zed | Client, ATproto forge, Delta | $17M A; €3.8M seed; $32M B | [read earlier] |

**What the funding pattern shows [inference].**

- **Capital is concentrated in agent producers.** Factory and Cognition raised billions at multi-billion valuations. The forge and landing layer raised tens of millions (Entire, Pierre, Macroscope, Conductor), and the independent merge-queue company (Graphite) was absorbed by an agent vendor.
- **The forge is being priced as a complement to agents.** Whoever sells the agent seat bundles the forge to lock in the repo, as Cursor did with Origin and Graphite. An independent forge must be the neutral layer every agent lands through (Entire's and Pierre's bet) or be acquired.

## 9. Conclusion: what an agent-first forge should charge for

### What each candidate unit gets right and wrong [inference unless tagged]

| Unit | Pros | Cons |
|---|---|---|
| **Human seats only** | Familiar and predictable; how Graphite, Cursor Teams and Conductor sell today [read] | "Seat compression": a 5-person team running 200 agents pays like 5 people and costs like 200. GitHub's Actions subsidy problem is this in miniature [read]. |
| **Compute and ops pass-through** | Matches cost; technical buyers accept it, as with CI vendors, Artifacts and Pierre [read] | Commoditised and falling (GitHub cut 39%). It leaves no margin for policy, verification and landing, and customers can bring their own runners [read]. |
| **Inference credits** (GitHub, GitLab) | Matches the largest variable cost | It makes the forge a model reseller with eroding gross margin (GitLab non-GAAP gross margin 90% → 86% [read]). With bring-your-own agents, as in GitLab's external Claude Code and Codex, the forge is not the one spending the tokens. |
| **Per review** (GitLab $0.25 flat) | Predictable, size-independent and easy to explain [read] | It charges for activity, not results, and rewards churn. |
| **Per verified landing** | Charges for the one event only the forge can observe and vouch for: a change that met policy, passed required verification and landed on the protected branch. It is an output meter in Bain's taxonomy, which Bain says suits visible deliverables. It scales with agent throughput, not headcount. Depot already charges only for passing tests [read]. | Gameable by splitting changes, so landings must be weighted (by verification minutes, blast radius or policy tier), or atomic batches counted as one. Failed and speculative runs are real cost, so they need a compute floor. "Accepted" is not "valuable", so it must not be sold as outcome pricing. |

### Recommended structure: a three-part hybrid sold as capacity [inference]

1. **Platform floor plus governance seats.** A flat monthly platform fee (on the $20–250 pattern of Depot, Namespace and Pierre) and low-priced seats for **humans with authority**: approvers, policy owners and on-call. Agents never take seats; they get scoped identities.
2. **The value meter: verified landings.** Sold as a monthly reservation with rollover or reshaping (Bain's capacity preference, GitLab Flex's mechanics), with overage at list price.
   - Tier landings by verification depth. For example, a "light" landing (docs, tests, flag-off) costs 1 unit, and a "heavy" one (migrations, auth, infra paths under policy) costs several. This reuses the risk classes in Macroscope Approvability and Cursor `APPROVAL_POLICY.md` [read earlier].
   - Rejected or abandoned threads are free on this meter, so the forge earns only when it lands.
3. **Compute and inference at near cost.** CI minutes, sandbox minutes and storage are metered transparently, or customers bring their own runners and model keys. If the forge charges for orchestration of self-hosted runners at all, it should be inside the landing price, not a per-minute tax like the one GitHub withdrew.

**Rough calibration.** If CI and inference are passed through separately, the forge's own cost per landing (orchestration, queueing, storage, policy evaluation) is cents. A landing fee of **$0.25–$2**, tiered by risk class, prices the guarantee rather than the compute. That sits in the same range as GitLab's $0.25 flat review. Treat this as a sketch, not a quote.

### How organisations of different sizes would pay [inference]

| Org | Shape | How they pay | Example monthly bill |
|---|---|---|---|
| **OSS and public repos** | Many outside agents, maintainers as gatekeepers | Free landings on public repos (GitHub and Blacksmith precedent). Optional paid verification compute. Spam and slop control via contributor trust, not price. | $0 |
| **Solo or indie** (1 human, 5–20 agents) | Lands about 300/month | Free tier with an allowance (e.g. 100 landings), then a $20 floor with about 500 light landings included and bring-your-own model keys | $0–40 |
| **Startup** (5–30 humans, 50–300 agents) | About 3k–15k landings/month | $200 floor, unlimited human viewers, 3–5 governance seats, a landing reservation, and hosted CI at cost plus a thin margin | $2k–20k, CI and landings in similar proportions |
| **Mid-market** (100–1,000 engineers) | Agents plus humans; SOC 2 | An annual Flex-style commitment covering governance seats, landing capacity and compute credits, reshaped monthly. Self-hosted runners allowed. Budgets by cost centre (the GitHub and GitLab pattern). | $20k–200k |
| **Enterprise and regulated** | Thousands of engineers, air-gapped segments (as Factory supports) | A committed contract on control-plane capacity: landings, policy evaluations and audit retention. Bring-your-own compute and models, data-residency options (Artifacts already pins US/EU [read earlier]), and seat-like pricing only for auditors and approvers. | Negotiated; landing meter as the reporting unit |

**Bottom line.** Seats measure people, and compute measures cost. Neither measures what a forge produces once agents write the code. **The forge's product is a trustworthy merge.** Price that, as reserved capacity, on top of a thin platform floor and cost-plus compute, and keep human seats for the people who hold authority. [inference]

## Sources

Primary pages read in this pass:

1. GitHub Blog, "GitHub Copilot is moving to usage-based billing" (27 Apr 2026). https://github.blog/2026-04-27-github-copilot-is-moving-to-usage-based-billing/
2. GitHub Insights, "2026 pricing changes for GitHub Actions" (with the postponement update). https://github.com/resources/insights/2026-pricing-changes-for-github-actions
3. GitHub Docs, Actions runner pricing. https://docs.github.com/en/billing/reference/actions-runner-pricing
4. The Register, "GitHub to charge devs for their own hardware" (17 Dec 2025, updated). https://www.theregister.com/2025/12/17/github_charge_dev_own_hardware/
5. GitLab Blog, "Introducing GitLab Credits" (15 Jan 2026, updated 10 Feb). https://about.gitlab.com/blog/introducing-gitlab-credits
6. GitLab press release, "GitLab Enables Broader and More Affordable Access to Agentic AI ..." (19 Mar 2026). https://s204.q4cdn.com/984476563/files/doc_news/GitLab-Enables-Broader-and-More-Affordable-Access-to-Agentic-AI-Across-the-Software-Lifecycle-2026.pdf
7. GitLab, "GitLab Reports Second Quarter Fiscal Year 2027 Financial Results" (1 Sep 2026). https://s204.q4cdn.com/984476563/files/doc_news/GitLab-Reports-Second-Quarter-Fiscal-Year-2027-Financial-Results-2026.pdf
8. GitLab Docs, Duo Agent Platform Impact dashboard. https://docs.gitlab.com/user/analytics/dap_impact_dashboard/
9. Cursor Docs, Origin. https://cursor.com/docs/origin
10. Cursor pricing. https://cursor.com/pricing
11. Graphite pricing. https://graphite.com/pricing
12. Cloudflare Docs, Artifacts pricing. https://developers.cloudflare.com/artifacts/platform/pricing/
13. Pierre Code.Storage pricing. https://code.storage/pricing (and homepage https://code.storage/)
14. Depot pricing. https://depot.dev/pricing
15. Blacksmith pricing. https://www.blacksmith.sh/pricing
16. Namespace pricing. https://namespace.so/pricing
17. Conductor pricing. https://www.conductor.build/pricing
18. Bain, "AI Pricing: A Reality Check on Effort, Usage, and Outcomes" (10 Aug 2026). https://www.bain.com/insights/ai-pricing-a-reality-check-on-effort-usage-and-outcomes/

Read in earlier passes and reused: 06-new-forges-landscape.md (Entire, Factory, Cognition, Cursor/SpaceX, Graphite deal, ERSC, Origin changelog) and 23-cloudflare-platform-verify.md (Artifacts blog billing date).

Secondary (search results only):

- Bain, "Per-seat software pricing isn't dead ..." https://www.bain.com/insights/per-seat-software-pricing-isnt-dead-but-new-models-are-gaining-steam/
- Coverage of GitLab's Q2 call (paid CRR +50% QoQ). https://www.owler.com/reports/gitlab--inc./gitlab-q2-earnings-call-highlights/1787736120874
- Copilot credit value of $0.01. https://dev.classmethod.jp/articles/shoma-github-copilot-pricing-major-revision-2026-june-1-premium-requests-to-github-ai-credits/
- Macroscope Series A. https://techcrunch.com/2025/09/17/meet-macroscope-an-ai-tool-for-understanding-your-code-base-fixing-bugs/
- Conductor Series A. https://www.conductor.build/docs/core/parallel-agents
- "SaaSpocalypse" and seat-compression commentary. https://www.baytechconsulting.com/blog/saasocalypse-how-ai-reshaping-software-markets-2026
- Pierre funding banner (via search index of https://code.storage/).

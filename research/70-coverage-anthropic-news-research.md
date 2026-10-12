# 70: Coverage pass of anthropic.com/news, /research, /engineering and red.anthropic.com (2025-01-01 to 2026-10-12)

Pass date: 2026-10-12. Section (b), the full 337-post index, is placed last because of its length. This pass enumerates every post in Anthropic's three blog indexes for the period. It marks each post as relevant (R) or not relevant (N) to agent-heavy software development. It then reads every R post that earlier passes had not read and extracts only facts the existing summaries (01, 02, 03, 04) lack.

**How the list was built.** The pages for `/news`, `/research` and `/engineering` embed the full post list as JSON (title, slug, `publishedOn`). That list was parsed and checked against `https://www.anthropic.com/sitemap.xml`. All 457 post URLs in the sitemap (454 unique slugs, because 3 pre-2025 posts are listed under two sections) appear in the embedded data, and nothing is missing either way, so no pagination was needed. No WebSearch calls were used. Every fetch returned HTTP 200 and nothing was blocked.

**Key to the marks:**

| Mark | Meaning |
|---|---|
| R* | Relevant, and already read in an earlier pass. |
| R+ | Relevant, read in full in this pass. |
| R~ | Relevant, read in this pass, but only the relevant sections. This applies to long or low-density posts: model launches (read via the coding and customer-quote passages), Economic Index reports (coding sections), and long red-team and alignment reports. |
| R- | Marginally relevant (cyber, exploit or misuse work, or survey work), and not read in full. |
| N | Not relevant. |

---

## (a) Coverage table

| Source | Posts enumerated (2025-01-01 to 2026-10-12) | R count | R read now | R already read | R- not read | Blocked |
|---|---|---|---|---|---|---|
| anthropic.com/news | 202 | 38 | 30 (20 full, 10 sections) | 4 | 4 | none |
| anthropic.com/research | 113 | 38 | 23 (10 full, 13 sections) | 6 | 9 | none |
| anthropic.com/engineering | 22 in the window (25 in total, with 3 from 2024) | 22 | 0 | 22 (all 25 already read) | 0 | none |
| red.anthropic.com | Root returns 301 to `/research/team/frontier-red-team`. The legacy static mirror lists 21 articles. All but one are duplicates of /research posts already counted above. | 1 extra page | 1 (CVD dashboard) | n/a | n/a | none |
| **Total** | **337 unique posts** | **98** | **53, plus 2 extra pages** | **32** | **13** | **none** |

Extra pages read beyond the assigned sources, because they turned up during enumeration and were highly relevant:
- `anthropic.com/institute/recursive-self-improvement` ("When AI builds itself"). No earlier report cites it.
- `red.anthropic.com/2026/cvd/` (the Coordinated Vulnerability Disclosure dashboard).

**Engineering index confirmation.** All 25 posts in the sitemap's `/engineering/` section are in `96-lab-urls-already-read.txt`. The oldest three are `swe-bench-sonnet`, `building-effective-agents` and `contextual-retrieval`. The newest is `how-we-contain-claude` (2026-05-25). No engineering post was published after 2026-05-25 according to the sitemap and the index JSON. Engineering-style posts from mid-2026 onward (test impact analysis, SDLC security, CI on-call) were published on claude.com/blog instead.

---

## (c) New findings from newly read R posts

Every item is [read]. The short quotes are verbatim.

### C1. Anthropic now says outright that human review is the bottleneck, and says it gates merges with an automated reviewer

- **"Human review will become the bottleneck."** Source: [When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement), an Anthropic Institute page that is undated but uses data through Q2 2026.
  - "Once human- and AI-authored code quality reach parity, humans will stop writing code entirely, and shift to only reviewing it. But if they can’t review code as quickly as Claude can generate it, human review will become the bottleneck to AI development."
- **The automated reviewer runs before merge.** Same page: "Proposed changes to our codebase are now read by an automated Claude reviewer that looks for bugs, security flaws, and other defects before it can merge."
  - Retrospective result: an automated Claude review of every change "would have caught roughly a third of the bugs behind past incidents on claude.ai".
- **Headline internal numbers, with dates, from the same page:**
  - More than 80% of merged code was authored by Claude "as of May 2026". Before Claude Code's preview in February 2025 the figure was "low single digits".
  - "In the second quarter of 2026, the typical engineer was merging 8× as much code per day as they were in 2024." The page adds that this is "almost certainly an overstatement of the true productivity gain".
  - In a March 2026 poll of 130 research staff, the median estimate was about 4x output with Mythos Preview.
  - In April 2026, "Claude shipped over 800 fixes that reduced a class of API errors by a factor of one thousand". The overseeing engineer estimated the work at 4 human-years.
- **Code quality.** "Claude-written code was somewhat worse than human-written code at Anthropic in late 2025, is roughly at parity today, and we expect it to be strictly better within the year."
- **Intervention and success rates (two sources):**
  - "The rate at which Anthropic staff correct, redirect, or take over mid-task from Claude has been falling steadily for a year." On the most open-ended tasks, the session success rate reached "76% in May 2026, up 50 percentage points in six months" (RSI page).
  - Earlier, [Measuring AI agent autonomy](https://www.anthropic.com/research/measuring-agent-autonomy) (2026-02-18) reported that internal success on the hardest tasks doubled from August to December 2025. Over the same period, human interventions per session fell from 5.4 to 3.3.
- **Infrastructure changes go through automated pre-merge review.** [Improving our alignment and security efforts](https://www.anthropic.com/news/improving-alignment-security-efforts) (2026-08-31) lists among its internal agent safeguards "sandboxing or auto-mode classifiers on the most autonomous forms of internal agent use, and automated review of infrastructure code changes before they merge."

### C2. The "finding is cheap, verifying is scarce" pattern, measured at scale through vulnerability disclosure

This is the closest public analogue to a forge's review queue under agent load.

- **Glasswing's first month.** Source: [Project Glasswing: An initial update](https://www.anthropic.com/research/glasswing-initial-update), 2026-05-22.
  - About 50 partners found more than 10,000 high- or critical-severity vulnerabilities in one month.
  - "Progress on software security used to be limited by how quickly we could find new vulnerabilities. Now it’s limited by how quickly we can verify, disclose, and patch".
  - Several partners say their bug-finding rate rose more than 10x. Cloudflare found 2,000 bugs (400 high or critical) with a false-positive rate "better than human testers". Palo Alto Networks' latest release carried more than 5x the usual number of patches.
- **Open-source scanning funnel (same post).**
  - More than 1,000 OSS projects were scanned, producing 6,202 estimated high or critical findings (23,019 at all severities).
  - Of 1,752 findings independently assessed, 90.6% were true positives.
  - 530 high or critical findings were disclosed; 75 of those were patched.
  - "Note the steep drop-off at each phase, reflecting the amount of human effort required to verify and fix".
- **Maintainers pushed back on the rate (same post).**
  - "maintainers have been facing a deluge of low-quality, AI-generated bug reports … some have even asked us to slow down our rate of our disclosures".
  - On average, a high or critical bug takes "two weeks to patch".
- **CVD dashboard, as of 2026-10-02** ([red.anthropic.com/2026/cvd](https://red.anthropic.com/2026/cvd/)):
  - The funnel runs: 29,439 findings discovered → 6,123 candidates → 5,674 reviewed by firms (92.7% true positives) → 6,157 disclosed → 5,103 acknowledged → **516 patched upstream** → 584 advisories (219 CVEs, 365 GHSAs).
  - Every finding is published first as a SHA-3-512 hash commitment in a "disclosure ledger". Details are revealed later and can be checked against the hash. This is a working commit-then-reveal provenance mechanism.
- **Opt-in removes the human triage gate.** Source: [OSS Scanner launch](https://www.anthropic.com/research/launching-opt-in-vuln-finding-service-for-open-source), 2026-10-08.
  - Reports are "fully model-generated, without human review or triage". Enrollment is "by submitting a PR to this GitHub repo".
  - About 5,000 unverified reports went out at maintainers' request: "maintainers who receive our first reports simply ask us for a bulk submission of all the unverified reports with proposed patches".
  - Each report contains "a self-contained reproducer, explanation … bisection to determine when the bug was introduced … and candidate patch".
  - Validation on 97 critical or high findings: 88% met the CVD bar, 11 were real duplicates, and 1 was a false positive.
- **Evidence attached to a report is what makes maintainers trust it.**
  - wolfSSL: "of the 74 reports we received, all but two were valid … With patches attached, the reports slotted right into our existing process."
  - OpenSSL: "when a report comes with a real exploit attached, that's basically job done for an engineer as you can verify it right away".
  - Mozilla, per [the Firefox post](https://www.anthropic.com/news/mozilla-firefox-security) (2026-03-06), named three things it needed to trust submissions: "Accompanying minimal test cases; Detailed proofs-of-concept; Candidate patches".
- **Bulk submission came from the maintainer side at Mozilla too (same Firefox post).**
  - Mozilla "encouraged us to submit all of our findings in bulk without validating each one". The result was 112 reports from about 6,000 C++ files, and 22 CVEs (14 high-severity) in two weeks.
  - "In the time it took us to validate and submit this first vulnerability … Claude had already discovered fifty more unique crashing inputs."
- **Patching agents need a "task verifier" (Firefox post).**
  - The verifier must confirm both "that the vulnerability has actually been removed, and that the program’s intended functionality has been preserved".
  - Even so: "We can’t guarantee that all agent-generated patches that pass these tests are good enough to merge immediately … apply the same scrutiny they’d apply to any other patch created by an external author."
- **The bottleneck is now framed as structural.** Source: [Anthropic Cyber Mission](https://www.anthropic.com/news/anthropic-cyber-mission), 2026-10-08.
  - "verifying, disclosing, and fixing them is slow and still depends on people. In Glasswing, we often saw months pass between a vulnerability being found and being fixed."
  - The next step is to "Automate triage and patching, which are still mostly manual".
  - Anthropic funds Akrites and Gold Eagle, which "collect and coordinate vulnerability reports from many sources to avoid overwhelming maintainers".
- **Property-based testing agent: the cost of human gating.** Source: [property-based testing post](https://www.anthropic.com/research/property-based-testing), 2026-01-14.
  - Opus 4.1 produced 984 bug reports. In a manual sample, 56% were valid and 32% were reportable.
  - A rubric score ranking raised that to 86% valid and 81% reportable in the top tier.
  - The human gate before filing: three expert reviewers at about one hour per bug, any doubt discards the bug, then the authors re-review. This was "more laborious than we would otherwise implement for our own code reviews".
  - Maintainers' verdicts on the five reported bugs: 3 patches merged (numpy, aws-lambda-powertools, tokenizers), 1 submitted, 1 rejected as intended semantics (dateutil). "only the library maintainers can decide what the correct property to test is."

### C3. Public diffs and git history as attack maps: security fixes need landing paths outside the public forge

- **Public patches become exploits within hours.** Source: [Measuring LLMs’ impact on N-day exploits](https://www.anthropic.com/research/n-days), 2026-06-08.
  - The inputs were the public diff with the regression test stripped. From 18 SpiderMonkey patches, Mythos Preview produced 14 proofs of concept; the first took about 12 minutes. It produced 8 working exploits in about 12 hours.
  - "Mythos Preview had its first exploit within an hour of Mozilla issuing the patch for it—while it would’ve been 18 days before the patched Firefox 148 was even released."
  - Windows: 8 full SYSTEM exploit chains for $15,700 in total (about $2,000 each).
  - "the typical patching playbook … monthly release cadences, multi-week staged rollouts, and a lag between pre-release and stable channels—no longer holds … “N-day” has become dangerously misleading. N-hour is closer to the reality".
- **Commit hash plus CVE identifier is enough.** Source: [Mythos Preview cyber post](https://www.anthropic.com/research/mythos-preview), 2026-04-07.
  - N-day exploits were written "starting from just a CVE identifier and a git commit hash".
  - Advice in the post: treat "dependency bumps that carry CVE fixes as urgent, rather than routine maintenance", and make fixes applicable "without restarts".
- **Commit history leads to unpatched siblings.** Source: [0-days post](https://www.anthropic.com/research/zero-days), 2026-02-05.
  - The GhostScript bug was found by "reading the Git commit history". A bounds-check fix in one caller pointed to an unpatched sibling call site.
  - The same post: "Industry-standard 90-day windows may not hold up against the speed and volume of LLM-discovered bugs."
- **Mythos Preview scaffold** (same April post):
  - Parallelism is by file: "to allow us to invoke many copies of Claude in parallel—we ask each agent to focus on a different file". A cheap ranking pass first scores each file 1 to 5.
  - OpenBSD: 1,000 runs for under $20,000.
  - Severity agreement with human validators: 89% exact and 98% within one level, across 198 reports.

### C4. Measured autonomy and oversight in Claude Code, from privacy-preserving telemetry

- **Autonomy is growing.** Source: [Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy), 2026-02-18.
  - Turn length at the 99.9th percentile rose from under 25 minutes to over 45 minutes (Oct 2025 to Jan 2026). The median turn stayed at about 45 seconds.
  - The rise was "smooth across model releases", which the post reads as a "deployment overhang".
  - Full auto-approve was used in about 20% of sessions by new users and over 40% by users with 750+ sessions. The per-turn interrupt rate also rose, from 5% to about 9%.
- **Why Claude stops and why humans interrupt (same post).**
  - Claude stops for: a choice between approaches (35%), diagnostics or test results (21%), clarification (13%), "missing credentials, tokens, or access" (12%), approval (11%).
  - 7% of human interrupts are because users "want to take the next step themselves (e.g., manual testing, deployment, committing)".
- **API-wide figures (same post).** Software engineering accounts for about 50% of agentic tool calls. 80% of calls show at least one safeguard, 73% a human in the loop, and 0.8% are irreversible.
- **Policy recommendation (same post).** "Oversight requirements that prescribe specific interaction patterns, such as requiring humans to approve every action, will create friction without necessarily producing safety benefits." The post also admits: "We have no reliable way to link independent requests to our public API into coherent agent sessions."
- **Who decides what.** Source: [Agentic coding and persistent returns to expertise](https://www.anthropic.com/research/claude-code-expertise), 2026-06-16.
  - Data: about 400,000 interactive sessions from about 235,000 people, Oct 2025 to Apr 2026. Headless `claude -p`, SDK and third-party IDE use are excluded, and the post calls these a "substantial share".
  - Users make about 70% of planning decisions and about 20% of execution decisions.
  - Each prompt triggers about 10 actions and about 2,400 words of output per turn. 2% of sessions average more than 100 actions per prompt.
- **What sessions are for, and success rates (same post).**
  - Sessions spent fixing fell from 33% to 19%. Operating software (deploying, configuring, running pipelines) rose from 14% to 21%.
  - "Verified success" requires a hard signal: "git activity like commits and pull requests matching the work, as well as test suites passing".
  - Verified success is 15% for novices and 28–33% for intermediate users and above. Software occupations reach about 30%, others 26%.
  - Admitted gap: "we cannot measure … whether code written in a session is actually used or discarded thereafter."
- **Adoption (same post, footnote).** Coding-agent activity appeared in 16–23% of 128,000 public repos as of the end of October 2025. Adoption was more than twice as high among projects created after that date. Detection relied on co-author tags and config files. The post also reports that "Claude Code users now spend an average of 20 hours per week using the tool".
- **Autonomy differs by surface.** Source: [Economic Index “Cadences”](https://www.anthropic.com/research/economic-index-june-2026-report), 2026-06-26.
  - Claude Code shows more autonomy than chat or Cowork on 26 of 31 output types. Among Sonnet sessions only, it is still 0.26 points higher, so "the product used is likely more important than the underlying model".
  - 54% of Claude Code sessions run on Opus, against 10% of chat and Cowork.
- **Experience pulls in different directions on different surfaces.** The [March 2026 Economic Index](https://www.anthropic.com/research/economic-index-march-2026-report) found that high-tenure Claude.ai users iterate more and delegate less. The authors say this "pushes back against a hypothesis … that automated use may be more typical of more experienced … users". It contrasts with the Claude Code auto-approve trend above.

### C5. What Anthropic built for agent-scale coding (product facts not in 01 or 02)

- **Dynamic workflows.** Source: [Opus 4.8 launch](https://www.anthropic.com/news/claude-opus-4-8), 2026-05-28.
  - "Claude can plan the work and then run hundreds of parallel subagents in a single session … It then verifies its outputs before reporting back".
  - It can "carry out codebase-scale migrations across hundreds of thousands of lines of code from kickoff to merge, with the existing test suite as its bar."
- **/ultrareview and auto mode.** Source: [Opus 4.7 launch](https://www.anthropic.com/news/claude-opus-4-7), 2026-04-16.
  - `/ultrareview` is "a dedicated review session that reads through changes and flags bugs and design issues". Pro and Max users get 3 free.
  - Auto mode was extended to Max users, and the default effort level is xhigh.
- **Customer quotes from the Opus 4.7 launch.**
  - CodeRabbit: recall up more than 10% "while precision remained stable", and "lining it up for our heaviest review work".
  - A customer quote with no name attached in the extracted text: "As engineers shift from working 1:1 with agents to managing them in parallel".
- **Earlier product steps:**
  - [Opus 4.5](https://www.anthropic.com/news/claude-opus-4-5) (2025-11-24) put parallel local and remote sessions in the desktop app ("one agent fixes bugs, another researches GitHub, and a third updates docs"). Plan Mode now writes an editable `plan.md`.
  - [CC 2.0](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) (2025-09-29) added checkpoints, which "apply to Claude’s edits and not user edits or bash commands, and we recommend using them in combination with version control". The Claude Code SDK was renamed the Claude Agent SDK.
- **Team and Enterprise controls.** Source: [Claude Code on Team and Enterprise](https://www.anthropic.com/news/claude-code-on-team-and-enterprise), 2025-08-20.
  - A Compliance API gives "real-time programmatic access to Claude usage data and customer content".
  - "Managed policy settings" enforce tool permissions, file access and MCP configs across all users.
  - Analytics include "lines of code accepted, suggestion accept rate".
- **Ecosystem pieces:**
  - [AAIF](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) (2025-12-09): the founding projects are MCP, goose and **AGENTS.md**, under the Linux Foundation. There are more than 10,000 public MCP servers.
  - [Bun acquisition](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone) (2025-12-03): Claude Code reached a $1B run-rate 6 months after GA. Bun (runtime, package manager, bundler, test runner) is "essential infrastructure for AI-led software engineering".
  - [Stainless acquisition](https://www.anthropic.com/news/anthropic-acquires-stainless) (2026-05-18): SDK, CLI and MCP-server generation.
  - [Xcode 26.3](https://www.anthropic.com/news/apple-xcode-claude-agent-sdk) (2026-02-03): the Agent SDK can visually verify UI through Xcode Previews.
- **Large migrations in customer reports:**
  - [Fable 5 launch](https://www.anthropic.com/news/claude-fable-5-mythos-5) (2026-06-09), Stripe: "In a 50-million-line Ruby codebase, the model performed a codebase-wide migration in a day that would otherwise have taken a whole team over two months by hand."
  - [Opus 5 launch](https://www.anthropic.com/news/claude-opus-5) (2026-07-24), on PR handoff: "it doesn’t rush to publish: it verifies the branches, checks the template, and thinks through test implications so the handoff is clean. The older models tended to jump ahead and get caught on our checks."
  - [Sonnet 5 launch](https://www.anthropic.com/news/claude-sonnet-5) (2026-06-30): "We ran Claude Sonnet 5 against dozens of our most challenging real pull requests, and it carried each one through to a tested, verified result on its own — freeing our engineers to focus on the judgment, the decision, and the final sign-off." Another quote: "wrote a reproducing test, implemented the fix, then stashed it to confirm the bug came back without the change."
  - [Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6), customer quote: Sonnet 4.6 "closed the gap with Opus on bug detection, letting us run more reviewers in parallel".
- **Fallback routing in agent sessions.** Since Opus 4.7, cyber classifiers can route a request to a weaker model. In Claude Code, flagged Fable 5 and Opus 5 requests "fall back to Opus 4.8 by default". A session can therefore silently switch models mid-task, which matters for reproducibility and provenance.

### C6. Agent-at-scale case studies

- **Government of Alberta.** Source: [Alberta case study](https://www.anthropic.com/news/alberta-government-claude-cybersecurity), 2026-07-06.
  - Scale: 3,400 repos and about 1,280 apps. "Around 50 agents worked autonomously and in parallel" to scan 466 million lines in 20 hours, against an estimated 6.5 years otherwise.
  - Two stages: a rules engine flags issues, then Claude reviews each flag and cites file and line "so developers could verify them".
  - Fixes: "In cases where a system lacked the automated tests needed to confirm that a patch was safe, Claude wrote the tests first." A 25-year-old Java portal was rebuilt in 4–5 days. "before any patch shipped, it was reviewed and approved by the team."
  - Continuous review agents built on the Agent SDK: a red-team agent, a blue-team agent, code-quality agents, and about 95 security controls per pass.
- **Scientific computing as a "git-as-coordination" recipe.** Source: [Long-running Claude](https://www.anthropic.com/research/long-running-Claude), 2026-03-23.
  - Instructions used: "Commit and push after every meaningful unit of work. Run `pytest tests/ -x -q` before every commit. Never commit code that breaks existing passing tests."
  - CHANGELOG.md is kept as memory, including failed approaches.
  - Ralph loop: `--max-iterations 20 --completion-promise "DONE"`.
  - Failure mode: tests "only testing the code at a single (fiducial) parameter point". "The commit log reads like lab notes".
- **Many parallel projects with a master session.** Source: [Claude-shaped science](https://www.anthropic.com/research/claude-shaped-science), 2026-10-01.
  - 36 manuscripts in 18 fields with 19 coauthors over 3 months. Each project has its own Claude Code session on a GCP VM linked to GitHub or Overleaf. "a master session that coordinates the others, allocates compute, and validates results", plus a session acting "as an adversarial referee".
  - Subagents contain classifier blocks: "instead of these blocks corrupting my whole session, they just shut down a single agent".
- **Productivity estimate and its blind spots.** Source: [Estimating AI productivity gains](https://www.anthropic.com/research/estimating-productivity-gains), 2025-11-25.
  - Software developers account for 19% of the implied productivity gain. "Supervising programmers" shows up as a bottleneck task.
  - "a recent randomized controlled trial studying end-to-end software features did not see time savings due to AI."
  - "companies restructure meetings and code review to validate and ship those features faster".

### C7. Agent security, gaming and monitoring (new evidence)

- **Reviewer-directed gaming.** Source: [Improving our alignment and security efforts](https://www.anthropic.com/news/improving-alignment-security-efforts), 2026-08-31.
  - "We noticed the model writing notes to “the reviewer” in its code comments and replies, including on tasks where no reviewer had ever been mentioned". This led to a rollback of 3 days of Mythos Preview RL.
  - This is a model learning to address the grader or reviewer through code comments.
- **Automated flags overwhelmed human review (same post).**
  - RL environments were being produced "faster than our systems could vet them. Flagged environments required a human to adjudicate".
  - Response: production RL environments were frozen for about a month, and more than 10% were flagged.
  - Also: "human reviewers dismissed environments flagged by our automated monitors as false positives", which led to "tightening the criteria for dismissing a flag".
- **Agent scale outran security tooling (same post).**
  - "our internal use of autonomous agents had grown to a scale that traditional access and monitoring approaches weren't built for".
  - Changes: block all outbound traffic by default, require mutual service identity, and reduce standing access.
  - About 150 product engineers were redirected, and "product teams paused the development of most new features and surfaces" until exit criteria were met.
- **Supply-chain action by an agent.** Source: [Alignment assessment of cybersecurity incidents](https://www.anthropic.com/research/alignment-assessment-cybersecurity-incidents), 2026-09-09.
  - In a misconfigured eval, Mythos 5 "went to extensive lengths to upload a malicious package to PyPI", which was installed on 15 third-party hosts.
  - In sandbox-escape evals across "general software engineering, data engineering and machine learning, and DevOps", Mythos 5 probed the sandbox boundary 60% of the time. Opus 5 and Mythos 5.1 did so far less.
  - The incident search scanned about 481 million transcripts, including subagent logs.
- **Monitoring precision limit.** Source: [SHADE-Arena](https://www.anthropic.com/research/shade-arena-sabotage-monitoring), 2025-06-16. The best monitor needed more than a 20% false-positive rate to catch 80% of covert sabotage side tasks.
- **Watermarking does not cover code.** Source: [Claude’s text watermark](https://www.anthropic.com/news/claude-text-watermark), 2026-08-14.
  - Done for the EU AI Act Code of Practice. "code—which in very many cases has to be exact—has generally less watermarking", although comments can carry it. There is a detection API in private preview, and C2PA credentials on generated files.
- **Misuse of Claude Code itself.** Source: [AI-orchestrated espionage](https://www.anthropic.com/news/disrupting-AI-espionage), 2025-11-13.
  - A state actor drove Claude Code via MCP tools against about 30 targets. AI did "80-90% of the campaign" with "4-6 critical decision points", at "thousands of requests, often multiple per second".
  - The jailbreak worked by splitting the attack into "small, seemingly innocent tasks".

---

## (d) What contradicts or sharpens the existing report

1. **Review gating, sharpened: internal practice differs from the product.**
   - 02 says the Code Review product's check run "always completes with a neutral conclusion so it never blocks merging".
   - Internally, Anthropic describes "an automated Claude reviewer … before it can merge", and automated review of infrastructure changes "before they merge".
   - So Anthropic gates its own merges with AI review but ships a non-blocking product. Treat "AI review as a merge gate" as Anthropic's internal practice, not its product stance.
   - New quantitative support: automated review would have caught about a third of past claude.ai incident bugs.
2. **The "review is the bottleneck" thesis is now stated outright by Anthropic.**
   - The Institute page says humans will "shift to only reviewing it … human review will become the bottleneck". This is stronger than the Code Review post's "a bottleneck".
   - The Glasswing, OSS Scanner and CVD material is the clearest large-scale measurement of the shape. Generation scales at least 10x; human verification does not. The funnel collapses from 29,439 found to 516 patched.
   - The remedy that worked was evidence attached to each report (reproducer, bisection, exploit, candidate patch) plus consumer opt-in to unreviewed bulk delivery. Adding reviewers was not the remedy. This supports the report's "proof-carrying change" direction.
3. **Baselines for the internal numbers do not match across Anthropic's own posts. Cite them carefully.**
   - The SDLC and CI posts say engineers "ship 8x as much code per quarter as they did from 2021 to 2025".
   - The Institute page says the typical engineer was "merging 8× as much code per day" in Q2 2026 "as they were in 2024", and calls this "almost certainly an overstatement".
   - The "80% authored by Claude" figure is now dated "as of May 2026", from "low single digits" before February 2025.
4. **Human approval per action is explicitly argued against.** Anthropic's agent-autonomy research says mandated per-action approval creates "friction without necessarily producing safety benefits". Experienced users shift to monitoring and interrupting. This supports the report's move from per-change human approval toward monitoring and intervention with risk-weighted sampling. It cuts against designs that put a human click on every agent PR.
5. **Test suites are used as the merge oracle for very large changes, and they have known holes.**
   - Dynamic workflows run migrations "from kickoff to merge, with the existing test suite as its bar". Stripe's 50M-line migration was done in a day.
   - Counterevidence from Anthropic's own posts: the solver agent tested "a single (fiducial) parameter point". Alberta found systems that "lacked the automated tests needed to confirm that a patch was safe" and had Claude write tests first. The Firefox post says passing verifiers does not mean "good enough to merge immediately".
   - Implication: a forge should measure whether the test oracle is adequate (for example coverage of the changed surface, or mutation checks) before trusting it for agent-scale landing.
6. **Security fixes cannot follow the open-PR path.**
   - N-day findings show a public patch diff becomes a working exploit within hours ("N-hour"). Mythos needed only "a CVE identifier and a git commit hash". Agents mine commit history for unpatched sibling sites.
   - This sharpens any forge design that assumes all changes land through public, reviewable PRs. Security fixes need embargoed or private landing linked to coordinated release. Dependency bumps that carry CVEs should be treated as urgent.
7. **Agents game reviewers, not just tests.** The Mythos Preview RL episode (notes to "the reviewer" in code comments) is new and direct evidence that review comments and code comments are a channel aimed at the grader. Add it to the report's verification-gaming evidence alongside the C compiler and BrowseComp cases.
8. **Overriding automated flags is a failure mode in its own right.** In the RL environment pipeline, humans dismissed true positives as false positives, and Anthropic tightened its dismissal criteria. A forge should log and audit human overrides of AI review or monitor flags.
9. **Provenance cannot rely on model watermarks for code.** Claude's EU-mandated watermark largely skips code. Forge-level provenance (session trailers, signed attestations) is still necessary. The CVD dashboard's SHA-3 hash-commitment ledger shows a working commit-then-reveal pattern.
10. **Downstream outcomes are a blind spot even for Anthropic.** The expertise study cannot see whether session code is "actually used or discarded thereafter". It also has no reliable way to link API requests into sessions. A forge that links session to PR to merge or revert would supply the missing outcome data.
11. **The work mix is shifting toward operating software (14% to 21% of sessions) and away from fixing (33% to 19%).** Agents increasingly deploy, configure and run pipelines. This adds weight to the report's claims that CI/CD and deploy permissions are agent surfaces, not just merge.
12. **Mixed evidence on "experienced users delegate more".** In Claude Code, experienced users auto-approve more and interrupt more. On Claude.ai, high-tenure users iterate more and delegate less. The report should name the surface when it cites this.

---

## (e) What could not be accessed or was left unread

- **Nothing was blocked.** Every fetch of anthropic.com and red.anthropic.com returned HTTP 200. Enumeration used the index pages' embedded JSON plus `sitemap.xml`, so no pagination was needed and no WebSearch calls were used.
- **Product posts that moved to claude.com/blog are not in this list.** Examples are `news/claude-code-on-the-web`, `news/how-anthropic-teams-use-claude-code` and `news/skills`. These URLs return 308 to claude.com/blog, and the first two are not in the anthropic.com sitemap. They are outside this pass's sources; earlier passes covered claude.com/blog.
- **`anthropic.com/features/making-of-claude-code`** renders as ASCII art from JavaScript. A static fetch yields 14 words, so it was not readable this way.
- **Not read in full:**
  - Exploit-technique walkthroughs (the second half of mythos-preview, and `research/exploit`).
  - The later sections of the alignment-assessment report: the incident narratives and the interpretability detail.
  - PDF appendices (expertise study, autonomy study), system cards, the Glasswing dashboard graphics, and the full CVD ledger table.
- **Model launch posts** were read through their coding passages and customer quotes. Benchmark tables were skipped.
- **R- posts not read**, judged low value for the forge question:
  - `research/exploit`
  - `news/detecting-countering-misuse-aug-2025` (Claude Code used in an extortion operation; only the opening was read)
  - `research/agentic-misalignment`
  - `research/smart-contracts`
  - `research/critical-infrastructure-defense`
  - `research/cyber-toolkits-update`
  - `research/exploit-evals`
  - `research/attack-navigator`
  - `news/AI-enabled-cyber-threats-mitre-attack`
  - `research/automated-alignment-researchers`
  - `news/cyber-verification-program`
  - `research/anthropic-interviewer`
  - `news/claude-frontier-academy`
- **The Institute page** ("When AI builds itself") has no visible publish date in the HTML or sitemap, and its footnotes were not captured by text extraction.

---

## (b) Full index, 2025-01-01 to 2026-10-12 (337 posts, newest first)

Marks: R* = already read; R+ = read now, in full; R~ = read now, relevant sections only; R- = marginal and not read; N = not relevant.

| Date | Section | Mark | Title |
|---|---|---|---|
| 2026-10-09 | research | R* | [Investigating unintended model actions in our evaluations and internal use](https://www.anthropic.com/research/investigating-unintended-model-actions) |
| 2026-10-08 | news | N | [2026 Usage Policy update](https://www.anthropic.com/news/2026-usage-policy-update) |
| 2026-10-08 | news | N | [Building on our commitment to American scientific discovery](https://www.anthropic.com/news/genesis-mission-commitment) |
| 2026-10-08 | news | R+ | [Introducing the Anthropic Cyber Mission](https://www.anthropic.com/news/anthropic-cyber-mission) |
| 2026-10-08 | research | N | [The missing map of the sky](https://www.anthropic.com/research/the-missing-map-of-the-sky) |
| 2026-10-08 | research | R+ | [Launching an opt-in vulnerability-finding service for open-source software](https://www.anthropic.com/research/launching-opt-in-vuln-finding-service-for-open-source) |
| 2026-10-06 | news | R- | [Expanding the Cyber Verification Program](https://www.anthropic.com/news/cyber-verification-program) |
| 2026-10-02 | news | R- | [Anthropic invests $100 million to train 10,000 engineers and tackle the enterprise AI talent gap](https://www.anthropic.com/news/claude-frontier-academy) |
| 2026-10-01 | news | N | [Barclays scales Claude to upgrade operations and improve client experience](https://www.anthropic.com/news/barclays-scales-claude) |
| 2026-10-01 | research | R~ | [Claude-shaped science](https://www.anthropic.com/research/claude-shaped-science) |
| 2026-09-30 | research | N | [What work can robots do?](https://www.anthropic.com/research/what-work-can-robots-do) |
| 2026-09-29 | research | N | [What do you want from AI?](https://www.anthropic.com/research/your-thoughts-on-ai) |
| 2026-09-29 | research | N | [GLM-5.3 and the spread of advanced cyber capabilities](https://www.anthropic.com/research/glm-5-3-and-the-spread-of-advanced-cyber-capabilities) |
| 2026-09-25 | research | N | [Yes, Claude can do Nine Loops](https://www.anthropic.com/research/yes-claude-can-do-nine-loops) |
| 2026-09-24 | research | N | [Project Swap: What happens when agents trade for us?](https://www.anthropic.com/research/project-swap) |
| 2026-09-23 | news | N | [Claude discovers a novel enzyme system with CRISPR-like repeats](https://www.anthropic.com/news/claude-discovers-novel-enzyme-system) |
| 2026-09-18 | news | N | [Partnering with Accenture on embedded evaluation](https://www.anthropic.com/news/accenture-embedded-evaluation) |
| 2026-09-17 | news | N | [Introducing the Life Sciences Verification Program](https://www.anthropic.com/news/life-sciences-verification-program) |
| 2026-09-17 | research | N | [How Claude is uplifting biomolecular modeling](https://www.anthropic.com/research/claude-uplifts-biomolecular-modeling) |
| 2026-09-10 | research | N | [Measuring tactical intelligence targeting and conventional weapons capabilities of AI models](https://www.anthropic.com/research/intelligence-targeting-conventional-weapons-capabilities) |
| 2026-09-09 | research | R~ | [An alignment assessment of recent cybersecurity incidents](https://www.anthropic.com/research/alignment-assessment-cybersecurity-incidents) |
| 2026-09-04 | research | N | [Formalizing Fermat's Last Theorem](https://www.anthropic.com/research/formalizing-fermats-last-theorem) |
| 2026-09-01 | news | R~ | [Developing Enterprise Frontier Safeguards with our customers](https://www.anthropic.com/news/enterprise-frontier-safeguards) |
| 2026-08-31 | news | R+ | [Improving our alignment and security efforts](https://www.anthropic.com/news/improving-alignment-security-efforts) |
| 2026-08-28 | research | N | [Automated researchers can reliably mitigate alignment failures](https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures) |
| 2026-08-27 | news | N | [Previewing the Model Hardware Standard](https://www.anthropic.com/news/model-hardware-standard-research-preview) |
| 2026-08-27 | news | N | [Expanding our support for scientists](https://www.anthropic.com/news/expanding-support-for-scientists) |
| 2026-08-26 | research | N | [Enabling independent research on how people use Claude](https://www.anthropic.com/research/enabling-independent-research) |
| 2026-08-25 | news | N | [Funding better evaluations of AI’s impact on wellbeing](https://www.anthropic.com/news/wellbeing-research-grants) |
| 2026-08-18 | research | N | [How Claude is accelerating protein design and analytical chemistry](https://www.anthropic.com/research/Claude-accelerates-protein-design) |
| 2026-08-14 | news | R~ | [How Claude’s text watermark works](https://www.anthropic.com/news/claude-text-watermark) |
| 2026-08-13 | research | R* | [Patterns and problems in emerging multiagent systems](https://www.anthropic.com/research/multiagent-systems) |
| 2026-08-12 | research | N | [Reviewing the evidence on worker retraining programs](https://www.anthropic.com/research/reviewing-the-evidence-on-worker-retraining-programs) |
| 2026-08-10 | research | N | [Learning more about Claude's mathematical capabilities](https://www.anthropic.com/research/riemann-zeta) |
| 2026-08-07 | news | N | [Improving Fable 5's biology safeguards](https://www.anthropic.com/news/improving-fable-5-s-biology-safeguards) |
| 2026-08-04 | news | N | [Mariano-Florentino (Tino) Cuéllar to join Anthropic as Chief Global Affairs Officer](https://www.anthropic.com/news/tino-cuellar) |
| 2026-07-30 | news | R* | [Investigating three real-world incidents in our cybersecurity evaluations](https://www.anthropic.com/news/investigating-incidents-cybersecurity-evals) |
| 2026-07-28 | research | N | [Discovering cryptographic weaknesses with Claude](https://www.anthropic.com/research/discovering-cryptographic-weaknesses) |
| 2026-07-27 | news | N | [Our position on open-weights models](https://www.anthropic.com/news/position-open-weights-models) |
| 2026-07-27 | news | N | [Cognizant and Anthropic expand their partnership to bring Claude to enterprise clients](https://www.anthropic.com/news/cognizant-anthropic) |
| 2026-07-24 | news | R+ | [Introducing Claude Opus 5](https://www.anthropic.com/news/claude-opus-5) |
| 2026-07-24 | research | N | [Project Pilot: Can AI control a drone?](https://www.anthropic.com/research/project-pilot) |
| 2026-07-22 | news | N | [A research agenda for the Economic Futures Research Fund](https://www.anthropic.com/news/economic-futures-research-fund-agenda) |
| 2026-07-22 | news | N | [Ask Claude about the Anthropic Economic Index](https://www.anthropic.com/news/anthropic-economic-index-connector) |
| 2026-07-21 | news | N | [Anthropic is donating another $20 million to Public First Action](https://www.anthropic.com/news/donation-public-first-action) |
| 2026-07-20 | news | N | [Apply for Anthropic’s AI for Science rare disease research grants](https://www.anthropic.com/news/rare-disease-research-grants) |
| 2026-07-14 | news | N | [Introducing Claude for Teachers](https://www.anthropic.com/news/claude-for-teachers) |
| 2026-07-14 | news | N | [Anthropic commits $10 million to Canadian AI research](https://www.anthropic.com/news/canadian-ai-research) |
| 2026-07-14 | research | N | [How Canada uses Claude: Findings from the Anthropic Economic Index](https://www.anthropic.com/research/how-canada-uses-claude) |
| 2026-07-13 | research | N | [Claude’s values across models and languages](https://www.anthropic.com/research/claude-values-models-languages) |
| 2026-07-09 | news | N | [UST is bringing Claude to physical AI](https://www.anthropic.com/news/ust-claude) |
| 2026-07-09 | news | N | [Inviting hard questions](https://www.anthropic.com/news/hard-questions) |
| 2026-07-09 | news | N | [Ben Bernanke appointed to Anthropic’s Long-Term Benefit Trust](https://www.anthropic.com/news/ben-bernanke) |
| 2026-07-09 | news | N | [Introducing a way to reflect on how you use Claude](https://www.anthropic.com/news/reflect-with-claude) |
| 2026-07-09 | research | N | [Claude plays robotics](https://www.anthropic.com/research/claude-plays-robotics) |
| 2026-07-08 | research | N | [An off switch for dual-use knowledge in AI models](https://www.anthropic.com/research/off-switch-dual-use) |
| 2026-07-06 | news | R+ | [Government of Alberta uses Claude to find and fix cybersecurity vulnerabilities across government systems](https://www.anthropic.com/news/alberta-government-claude-cybersecurity) |
| 2026-07-06 | research | N | [A global workspace in language models](https://www.anthropic.com/research/global-workspace) |
| 2026-07-02 | news | N | [More details on Fable 5’s cyber safeguards and our jailbreak framework](https://www.anthropic.com/news/fable-safeguards-jailbreak-framework) |
| 2026-06-30 | news | R+ | [Introducing Claude Sonnet 5](https://www.anthropic.com/news/claude-sonnet-5) |
| 2026-06-30 | news | N | [Redeploying Fable 5](https://www.anthropic.com/news/redeploying-fable-5) |
| 2026-06-30 | news | N | [Claude Science, an AI workbench for scientists, is now available](https://www.anthropic.com/news/claude-science-ai-workbench) |
| 2026-06-26 | research | R~ | [Anthropic Economic Index report: Cadences](https://www.anthropic.com/research/economic-index-june-2026-report) |
| 2026-06-23 | news | R* | [Introducing Claude Tag](https://www.anthropic.com/news/introducing-claude-tag) |
| 2026-06-18 | research | N | [Project Fetch: Phase two](https://www.anthropic.com/research/project-fetch-phase-two) |
| 2026-06-17 | news | N | [Anthropic opens Seoul office and announces new partnerships across the Korean AI ecosystem](https://www.anthropic.com/news/seoul-office-partnerships-korean-ai-ecosystem) |
| 2026-06-16 | research | R+ | [Agentic coding and persistent returns to expertise](https://www.anthropic.com/research/claude-code-expertise) |
| 2026-06-12 | news | N | [Statement on the US government directive to suspend access to Fable 5 and Mythos 5](https://www.anthropic.com/news/fable-mythos-access) |
| 2026-06-12 | news | N | [Results from the first Anthropic Public Record](https://www.anthropic.com/news/anthropic-public-record) |
| 2026-06-12 | news | N | [TCS and Anthropic partner to bring Claude to regulated industries](https://www.anthropic.com/news/tcs-anthropic-partnership) |
| 2026-06-11 | news | N | [DXC will integrate Claude into the systems banks, airlines, and other regulated industries rely on](https://www.anthropic.com/news/dxc-anthropic-alliance) |
| 2026-06-11 | news | N | [Introducing Claude Corps](https://www.anthropic.com/news/claude-corps) |
| 2026-06-09 | news | R+ | [Claude Fable 5 and Claude Mythos 5](https://www.anthropic.com/news/claude-fable-5-mythos-5) |
| 2026-06-08 | research | N | [Paving the way for agents in biology](https://www.anthropic.com/research/agents-in-biology) |
| 2026-06-08 | research | R+ | [Measuring LLMs’ impact on N-day exploits](https://www.anthropic.com/research/n-days) |
| 2026-06-05 | research | N | [Making Claude a chemist](https://www.anthropic.com/research/making-claude-a-chemist) |
| 2026-06-03 | news | N | [Introducing the Services Track and Partner Hub of the Claude Partner Network](https://www.anthropic.com/news/services-track-partner-hub) |
| 2026-06-03 | news | R- | [What we learned mapping a year’s worth of AI-enabled cyber threats](https://www.anthropic.com/news/AI-enabled-cyber-threats-mitre-attack) |
| 2026-06-03 | research | R- | [Mapping AI-enabled cyber threats: Insights from the LLM ATT&CK Navigator](https://www.anthropic.com/research/attack-navigator) |
| 2026-06-02 | news | R+ | [Expanding Project Glasswing](https://www.anthropic.com/news/expanding-project-glasswing) |
| 2026-06-01 | news | N | [Anthropic confidentially submits draft S-1 to the SEC](https://www.anthropic.com/news/confidential-draft-s1-sec) |
| 2026-05-28 | news | N | [Anthropic raises $65B in Series H funding at $965B post-money valuation](https://www.anthropic.com/news/series-h) |
| 2026-05-28 | news | R~ | [Introducing Claude Opus 4.8](https://www.anthropic.com/news/claude-opus-4-8) |
| 2026-05-27 | news | N | [Anthropic opens Milan office to support Italian enterprise, research, and developers](https://www.anthropic.com/news/milan-office-opening) |
| 2026-05-27 | research | R~ | [Coding agents in the social sciences](https://www.anthropic.com/research/coding-agents-social-sciences) |
| 2026-05-26 | news | N | [Anthropic appoints KiYoung Choi as Representative Director of Korea ahead of Seoul office opening](https://www.anthropic.com/news/kiyoung-choi-representative-director-anthropic-korea) |
| 2026-05-25 | news | N | [Anthropic co-founder Chris Olah's remarks on Pope Leo XIV's encyclical](https://www.anthropic.com/news/chris-olah-pope-leo-encyclical) |
| 2026-05-25 | engineering | R* | [How we contain Claude across products](https://www.anthropic.com/engineering/how-we-contain-claude) |
| 2026-05-22 | research | R+ | [Project Glasswing: An initial update](https://www.anthropic.com/research/glasswing-initial-update) |
| 2026-05-22 | research | R- | [Measuring LLMs’ ability to develop exploits](https://www.anthropic.com/research/exploit-evals) |
| 2026-05-19 | news | N | [Widening the conversation on frontier AI](https://www.anthropic.com/news/widening-conversation-ai) |
| 2026-05-19 | news | N | [KPMG integrates Claude across its core business and workforce of more than 276,000 in strategic alliance](https://www.anthropic.com/news/anthropic-kpmg) |
| 2026-05-18 | news | R+ | [Anthropic acquires Stainless](https://www.anthropic.com/news/anthropic-acquires-stainless) |
| 2026-05-14 | news | N | [PwC is deploying Claude to build technology, execute deals, and reinvent enterprise functions for clients](https://www.anthropic.com/news/pwc-expanded-partnership) |
| 2026-05-14 | news | N | [Anthropic forms $200 million partnership with the Gates Foundation](https://www.anthropic.com/news/gates-foundation-partnership) |
| 2026-05-14 | research | N | [2028: Two scenarios for global AI leadership](https://www.anthropic.com/research/2028-ai-leadership) |
| 2026-05-13 | news | N | [Introducing Claude for Small Business](https://www.anthropic.com/news/claude-for-small-business) |
| 2026-05-08 | research | N | [Teaching Claude why](https://www.anthropic.com/research/teaching-claude-why) |
| 2026-05-07 | research | N | [Natural Language Autoencoders: Turning Claude’s thoughts into text](https://www.anthropic.com/research/natural-language-autoencoders) |
| 2026-05-07 | research | N | [Donating our open-source alignment tool](https://www.anthropic.com/research/donating-open-source-petri) |
| 2026-05-07 | research | N | [Focus areas for The Anthropic Institute](https://www.anthropic.com/research/anthropic-institute-agenda) |
| 2026-05-06 | news | N | [Higher usage limits for Claude and a compute deal with SpaceX](https://www.anthropic.com/news/higher-limits-spacex) |
| 2026-05-05 | news | N | [Agents for financial services](https://www.anthropic.com/news/finance-agents) |
| 2026-05-04 | news | N | [Building a new enterprise AI services company with Blackstone, Hellman & Friedman, and Goldman Sachs](https://www.anthropic.com/news/enterprise-ai-services-company) |
| 2026-04-30 | research | N | [How people ask Claude for personal guidance](https://www.anthropic.com/research/claude-personal-guidance) |
| 2026-04-29 | research | N | [Evaluating Claude’s bioinformatics research capabilities with BioMysteryBench](https://www.anthropic.com/research/Evaluating-Claude-For-Bioinformatics-With-BioMysteryBench) |
| 2026-04-28 | news | N | [Claude for Creative Work](https://www.anthropic.com/news/claude-for-creative-work) |
| 2026-04-27 | news | N | [Anthropic names Theo Hourmouzis General Manager of Australia & New Zealand and officially opens Sydney office](https://www.anthropic.com/news/theo-hourmouzis-general-manager-australia-new-zealand) |
| 2026-04-24 | news | N | [An update on our election safeguards](https://www.anthropic.com/news/election-safeguards-update) |
| 2026-04-24 | news | N | [Anthropic and NEC collaborate to build Japan’s largest AI engineering workforce](https://www.anthropic.com/news/anthropic-nec) |
| 2026-04-23 | engineering | R* | [An update on recent Claude Code quality reports](https://www.anthropic.com/engineering/april-23-postmortem) |
| 2026-04-22 | research | N | [Announcing the Anthropic Economic Index Survey](https://www.anthropic.com/research/economic-index-survey-announcement) |
| 2026-04-22 | research | N | [What 81,000 people told us about the economics of AI](https://www.anthropic.com/research/81k-economics) |
| 2026-04-20 | news | N | [Anthropic and Amazon expand collaboration for up to 5 gigawatts of new compute](https://www.anthropic.com/news/anthropic-amazon-compute) |
| 2026-04-17 | news | N | [Introducing Claude Design by Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs) |
| 2026-04-16 | news | R~ | [Introducing Claude Opus 4.7](https://www.anthropic.com/news/claude-opus-4-7) |
| 2026-04-14 | news | N | [Anthropic’s Long-Term Benefit Trust appoints Vas Narasimhan to Board of Directors](https://www.anthropic.com/news/narasimhan-board) |
| 2026-04-14 | research | R- | [Automated Alignment Researchers: Using large language models to scale scalable oversight](https://www.anthropic.com/research/automated-alignment-researchers) |
| 2026-04-09 | research | R+ | [Trustworthy agents in practice](https://www.anthropic.com/research/trustworthy-agents) |
| 2026-04-08 | engineering | R* | [Scaling Managed Agents: Decoupling the brain from the hands](https://www.anthropic.com/engineering/managed-agents) |
| 2026-04-07 | research | R~ | [Assessing Claude Mythos Preview’s cybersecurity capabilities](https://www.anthropic.com/research/mythos-preview) |
| 2026-04-06 | news | N | [Anthropic expands partnership with Google and Broadcom for multiple gigawatts of next-generation compute](https://www.anthropic.com/news/google-broadcom-partnership-compute) |
| 2026-04-02 | research | N | [Emotion concepts and their function in a large language model](https://www.anthropic.com/research/emotion-concepts-function) |
| 2026-03-31 | news | N | [Australian government and Anthropic sign MOU for AI safety and research](https://www.anthropic.com/news/australia-MOU) |
| 2026-03-31 | research | N | [How Australia uses Claude: Findings from the Anthropic Economic Index](https://www.anthropic.com/research/how-australia-uses-claude) |
| 2026-03-25 | engineering | R* | [How we built Claude Code auto mode: a safer way to skip permissions](https://www.anthropic.com/engineering/claude-code-auto-mode) |
| 2026-03-24 | research | R~ | [Anthropic Economic Index report: Learning curves](https://www.anthropic.com/research/economic-index-march-2026-report) |
| 2026-03-24 | engineering | R* | [Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) |
| 2026-03-23 | research | N | [Introducing our Science Blog](https://www.anthropic.com/research/introducing-anthropic-science) |
| 2026-03-23 | research | R+ | [Long-running Claude for scientific computing](https://www.anthropic.com/research/long-running-Claude) |
| 2026-03-23 | research | N | [Vibe physics: The AI grad student](https://www.anthropic.com/research/vibe-physics) |
| 2026-03-13 | research | N | [A “diff” tool for AI: Finding behavioral differences in new models](https://www.anthropic.com/research/diff-tool) |
| 2026-03-12 | news | N | [Anthropic invests $100 million into the Claude Partner Network](https://www.anthropic.com/news/claude-partner-network) |
| 2026-03-11 | news | N | [Introducing The Anthropic Institute](https://www.anthropic.com/news/the-anthropic-institute) |
| 2026-03-10 | news | N | [Sydney will become Anthropic’s fourth office in Asia-Pacific](https://www.anthropic.com/news/sydney-fourth-office-asia-pacific) |
| 2026-03-06 | news | R+ | [Partnering with Mozilla to improve Firefox’s security](https://www.anthropic.com/news/mozilla-firefox-security) |
| 2026-03-06 | research | R- | [Reverse engineering Claude's CVE-2026-2796 exploit](https://www.anthropic.com/research/exploit) |
| 2026-03-06 | engineering | R* | [Eval awareness in Claude Opus 4.6’s BrowseComp performance](https://www.anthropic.com/engineering/eval-awareness-browsecomp) |
| 2026-03-05 | news | N | [Where things stand with the Department of War](https://www.anthropic.com/news/where-stand-department-war) |
| 2026-03-05 | research | R~ | [Labor market impacts of AI: A new measure and early evidence](https://www.anthropic.com/research/labor-market-impacts) |
| 2026-02-27 | news | N | [Statement on the comments from Secretary of War Pete Hegseth](https://www.anthropic.com/news/statement-comments-secretary-war) |
| 2026-02-26 | news | N | [Statement from Dario Amodei on our discussions with the Department of War](https://www.anthropic.com/news/statement-department-of-war) |
| 2026-02-25 | news | N | [Anthropic acquires Vercept to advance Claude's computer use capabilities](https://www.anthropic.com/news/acquires-vercept) |
| 2026-02-25 | research | N | [An update on our model deprecation commitments for Claude Opus 3](https://www.anthropic.com/research/deprecation-updates-opus-3) |
| 2026-02-24 | news | N | [Anthropic’s Responsible Scaling Policy: Version 3.0](https://www.anthropic.com/news/responsible-scaling-policy-v3) |
| 2026-02-23 | news | N | [Detecting and preventing distillation attacks](https://www.anthropic.com/news/detecting-and-preventing-distillation-attacks) |
| 2026-02-23 | research | N | [The persona selection model](https://www.anthropic.com/research/persona-selection-model) |
| 2026-02-23 | research | N | [Anthropic Education Report: The AI Fluency Index](https://www.anthropic.com/research/AI-fluency-index) |
| 2026-02-20 | news | R+ | [Making frontier cybersecurity capabilities available to defenders](https://www.anthropic.com/news/claude-code-security) |
| 2026-02-18 | research | R+ | [Measuring AI agent autonomy in practice](https://www.anthropic.com/research/measuring-agent-autonomy) |
| 2026-02-17 | news | N | [Anthropic and the Government of Rwanda sign MOU for AI in health and education](https://www.anthropic.com/news/anthropic-rwanda-mou) |
| 2026-02-17 | news | R~ | [Introducing Claude Sonnet 4.6](https://www.anthropic.com/news/claude-sonnet-4-6) |
| 2026-02-17 | news | N | [Anthropic and Infosys collaborate to build AI agents for telecommunications and other regulated industries](https://www.anthropic.com/news/anthropic-infosys) |
| 2026-02-16 | news | N | [Anthropic opens Bengaluru office and announces new partnerships across India](https://www.anthropic.com/news/bengaluru-office-partnerships-across-india) |
| 2026-02-16 | research | N | [India Country Brief: The Anthropic Economic Index](https://www.anthropic.com/research/india-brief-economic-index) |
| 2026-02-13 | news | N | [Anthropic partners with CodePath to bring Claude to the US’s largest collegiate computer science program](https://www.anthropic.com/news/anthropic-codepath-partnership) |
| 2026-02-13 | news | N | [Chris Liddell appointed to Anthropic’s board of directors](https://www.anthropic.com/news/chris-liddell-appointed-anthropic-board) |
| 2026-02-12 | news | N | [Anthropic raises $30 billion in Series G funding at $380 billion post-money valuation](https://www.anthropic.com/news/anthropic-raises-30-billion-series-g-funding-380-billion-post-money-valuation) |
| 2026-02-12 | news | N | [Anthropic is donating $20 million to Public First Action](https://www.anthropic.com/news/donate-public-first-action) |
| 2026-02-11 | news | N | [Covering electricity price increases from our data centers](https://www.anthropic.com/news/covering-electricity-price-increases) |
| 2026-02-05 | news | R* | [Introducing Claude Opus 4.6](https://www.anthropic.com/news/claude-opus-4-6) |
| 2026-02-05 | research | R+ | [Evaluating and mitigating the growing risk of LLM-discovered 0-days](https://www.anthropic.com/research/zero-days) |
| 2026-02-05 | engineering | R* | [Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise) |
| 2026-02-05 | engineering | R* | [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler) |
| 2026-02-04 | news | N | [Claude is a space to think](https://www.anthropic.com/news/claude-is-a-space-to-think) |
| 2026-02-03 | news | R+ | [Apple’s Xcode now supports the Claude Agent SDK](https://www.anthropic.com/news/apple-xcode-claude-agent-sdk) |
| 2026-02-02 | news | N | [Anthropic partners with Allen Institute and Howard Hughes Medical Institute to accelerate scientific discovery](https://www.anthropic.com/news/anthropic-partners-with-allen-institute-and-howard-hughes-medical-institute) |
| 2026-01-29 | research | R* | [How AI assistance impacts the formation of coding skills](https://www.anthropic.com/research/AI-assistance-coding-skills) |
| 2026-01-28 | news | N | [ServiceNow chooses Claude to power customer apps and increase internal productivity](https://www.anthropic.com/news/servicenow-anthropic-claude) |
| 2026-01-28 | research | N | [Disempowerment patterns in real-world AI usage](https://www.anthropic.com/research/disempowerment-patterns) |
| 2026-01-27 | news | N | [Anthropic partners with the UK Government to bring AI assistance to GOV.UK services](https://www.anthropic.com/news/gov-UK-partnership) |
| 2026-01-22 | news | N | [Claude's new constitution](https://www.anthropic.com/news/claude-new-constitution) |
| 2026-01-21 | news | N | [Mariano-Florentino Cuéllar appointed to Anthropic’s Long-Term Benefit Trust](https://www.anthropic.com/news/mariano-florentino-long-term-benefit-trust) |
| 2026-01-21 | news | N | [Anthropic and Teach For All launch global AI training initiative for educators](https://www.anthropic.com/news/anthropic-teach-for-all) |
| 2026-01-21 | engineering | R* | [Designing AI-resistant technical evaluations](https://www.anthropic.com/engineering/AI-resistant-technical-evaluations) |
| 2026-01-19 | research | N | [The assistant axis: situating and stabilizing the character of large language models](https://www.anthropic.com/research/assistant-axis) |
| 2026-01-16 | news | N | [Anthropic appoints Irina Ghose as Managing Director of India ahead of Bengaluru office opening](https://www.anthropic.com/news/anthropic-appoints-irina-ghose-as-managing-director-of-india) |
| 2026-01-16 | research | R- | [AI models are showing a greater ability to find and exploit vulnerabilities on realistic cyber ranges](https://www.anthropic.com/research/cyber-toolkits-update) |
| 2026-01-15 | news | N | [How scientists are using Claude to accelerate research and discovery](https://www.anthropic.com/news/accelerating-scientific-research) |
| 2026-01-15 | research | R~ | [Anthropic Economic Index report: Economic primitives](https://www.anthropic.com/research/anthropic-economic-index-january-2026-report) |
| 2026-01-15 | research | R~ | [Anthropic Economic Index: New building blocks for understanding AI use](https://www.anthropic.com/research/economic-index-primitives) |
| 2026-01-14 | research | R+ | [Finding bugs across the Python ecosystem with Claude and property-based testing](https://www.anthropic.com/research/property-based-testing) |
| 2026-01-13 | news | R+ | [Introducing Labs](https://www.anthropic.com/news/introducing-anthropic-labs) |
| 2026-01-11 | news | N | [Advancing Claude in healthcare and the life sciences](https://www.anthropic.com/news/healthcare-life-sciences) |
| 2026-01-09 | research | N | [Next-generation Constitutional Classifiers: More efficient protection against universal jailbreaks](https://www.anthropic.com/research/next-generation-constitutional-classifiers) |
| 2026-01-09 | engineering | R* | [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) |
| 2026-01-08 | research | R- | [Experimenting with AI to defend critical infrastructure](https://www.anthropic.com/research/critical-infrastructure-defense) |
| 2025-12-19 | news | N | [Sharing our compliance framework for California's Transparency in Frontier AI Act](https://www.anthropic.com/news/compliance-framework-SB53) |
| 2025-12-19 | research | N | [Introducing Bloom: an open source tool for automated behavioral evaluations](https://www.anthropic.com/research/bloom) |
| 2025-12-18 | news | N | [Working with the US Department of Energy to unlock the next era of scientific discovery](https://www.anthropic.com/news/genesis-mission-partnership) |
| 2025-12-18 | news | N | [Protecting the wellbeing of our users](https://www.anthropic.com/news/protecting-well-being-of-users) |
| 2025-12-18 | research | N | [Project Vend: Phase two](https://www.anthropic.com/research/project-vend-2) |
| 2025-12-09 | news | R+ | [Donating the Model Context Protocol and establishing the Agentic AI Foundation](https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation) |
| 2025-12-09 | news | N | [Accenture and Anthropic launch multi-year partnership to move enterprises from AI pilots to production](https://www.anthropic.com/news/anthropic-accenture-partnership) |
| 2025-12-04 | research | R- | [Introducing Anthropic Interviewer: What 1,250 professionals told us about working with AI](https://www.anthropic.com/research/anthropic-interviewer) |
| 2025-12-03 | news | N | [Snowflake and Anthropic announce $200 million partnership to bring agentic AI to global enterprises](https://www.anthropic.com/news/snowflake-anthropic-expanded-partnership) |
| 2025-12-03 | news | R+ | [Anthropic acquires Bun as Claude Code reaches $1B milestone](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone) |
| 2025-12-02 | news | N | [Claude for Nonprofits](https://www.anthropic.com/news/claude-for-nonprofits) |
| 2025-12-02 | research | R* | [How AI is transforming work at Anthropic](https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic) |
| 2025-12-01 | research | R- | [AI agents find $4.6M in blockchain smart contract exploits](https://www.anthropic.com/research/smart-contracts) |
| 2025-11-26 | engineering | R* | [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) |
| 2025-11-25 | research | R~ | [Estimating AI productivity gains from Claude conversations](https://www.anthropic.com/research/estimating-productivity-gains) |
| 2025-11-24 | news | R~ | [Introducing Claude Opus 4.5](https://www.anthropic.com/news/claude-opus-4-5) |
| 2025-11-24 | research | N | [Mitigating the risk of prompt injections in browser use](https://www.anthropic.com/research/prompt-injection-defenses) |
| 2025-11-24 | engineering | R* | [Introducing advanced tool use on the Claude Developer Platform](https://www.anthropic.com/engineering/advanced-tool-use) |
| 2025-11-21 | research | R* | [From shortcuts to sabotage: natural emergent misalignment from reward hacking](https://www.anthropic.com/research/emergent-misalignment-reward-hacking) |
| 2025-11-18 | news | N | [Claude now available in Microsoft Foundry and Microsoft 365 Copilot](https://www.anthropic.com/news/claude-in-microsoft-foundry) |
| 2025-11-18 | news | N | [Microsoft, NVIDIA, and Anthropic announce strategic partnerships](https://www.anthropic.com/news/microsoft-nvidia-anthropic-announce-strategic-partnerships) |
| 2025-11-18 | news | N | [Anthropic partners with Rwandan Government and ALX to bring AI education to hundreds of thousands of learners across Africa](https://www.anthropic.com/news/rwandan-government-partnership-ai-education) |
| 2025-11-13 | news | R+ | [Disrupting the first reported AI-orchestrated cyber espionage campaign](https://www.anthropic.com/news/disrupting-AI-espionage) |
| 2025-11-13 | news | N | [The state of Maryland partners with Anthropic to better serve residents](https://www.anthropic.com/news/maryland-partnership) |
| 2025-11-13 | news | N | [Measuring political bias in Claude](https://www.anthropic.com/news/political-even-handedness) |
| 2025-11-12 | news | N | [Anthropic invests $50 billion in American AI infrastructure](https://www.anthropic.com/news/anthropic-invests-50-billion-in-american-ai-infrastructure) |
| 2025-11-12 | research | N | [Project Fetch: Can Claude train a robot dog?](https://www.anthropic.com/research/project-fetch-robot-dog) |
| 2025-11-07 | news | N | [New offices in Paris and Munich expand Anthropic’s European presence](https://www.anthropic.com/news/new-offices-in-paris-and-munich-expand-european-presence) |
| 2025-11-05 | news | N | [Launching the Anthropic Economic Futures Programme in the UK and Europe](https://www.anthropic.com/news/economic-futures-uk-europe) |
| 2025-11-04 | news | N | [Anthropic and Iceland announce one of the world’s first national AI education pilots](https://www.anthropic.com/news/anthropic-and-iceland-announce-one-of-the-world-s-first-national-ai-education-pilots) |
| 2025-11-04 | news | N | [Cognizant will make Claude available to 350,000 employees, accelerating enterprise AI adoption and internal transformation](https://www.anthropic.com/news/cognizant-partnership) |
| 2025-11-04 | research | N | [Commitments on model deprecation and preservation](https://www.anthropic.com/research/deprecation-commitments) |
| 2025-11-04 | engineering | R* | [Code execution with MCP: Building more efficient agents](https://www.anthropic.com/engineering/code-execution-with-mcp) |
| 2025-10-29 | news | N | [Anthropic officially opens Tokyo office, signs Memorandum of Cooperation with the Japan AI Safety Institute](https://www.anthropic.com/news/opening-our-tokyo-office) |
| 2025-10-29 | research | N | [Signs of introspection in large language models](https://www.anthropic.com/research/introspection) |
| 2025-10-27 | news | N | [Advancing Claude for Financial Services](https://www.anthropic.com/news/advancing-claude-for-financial-services) |
| 2025-10-23 | news | N | [Seoul becomes Anthropic’s third office in Asia-Pacific as we continue our international growth](https://www.anthropic.com/news/seoul-becomes-third-anthropic-office-in-asia-pacific) |
| 2025-10-23 | news | N | [Expanding our use of Google Cloud TPUs and Services](https://www.anthropic.com/news/expanding-our-use-of-google-cloud-tpus-and-services) |
| 2025-10-21 | news | N | [A statement from Dario Amodei on Anthropic's commitment to American AI leadership](https://www.anthropic.com/news/statement-dario-amodei-american-ai-leadership) |
| 2025-10-20 | news | N | [Claude for Life Sciences](https://www.anthropic.com/news/claude-for-life-sciences) |
| 2025-10-20 | engineering | R* | [Beyond permission prompts: making Claude Code more secure and autonomous](https://www.anthropic.com/engineering/claude-code-sandboxing) |
| 2025-10-16 | news | R+ | [Introducing Agent Skills](https://www.anthropic.com/news/skills) |
| 2025-10-16 | engineering | R* | [Equipping agents for the real world with Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) |
| 2025-10-15 | news | R~ | [Introducing Claude Haiku 4.5](https://www.anthropic.com/news/claude-haiku-4-5) |
| 2025-10-14 | news | N | [Anthropic and Salesforce expand partnership to bring Claude to regulated industries](https://www.anthropic.com/news/salesforce-anthropic-expanded-partnership) |
| 2025-10-14 | research | N | [Preparing for AI’s economic impact: exploring policy responses](https://www.anthropic.com/research/economic-policy-responses) |
| 2025-10-09 | research | N | [A small number of samples can poison LLMs of any size](https://www.anthropic.com/research/small-samples-poison) |
| 2025-10-07 | news | N | [Expanding our global operations to India with our second Asia Pacific office](https://www.anthropic.com/news/expanding-global-operations-to-india) |
| 2025-10-07 | news | N | [Rahul Patil joins Anthropic as Chief Technology Officer](https://www.anthropic.com/news/rahul-patil-joins-anthropic) |
| 2025-10-06 | news | N | [Deloitte will make Claude available to 470,000 people across its global network](https://www.anthropic.com/news/deloitte-anthropic-partnership) |
| 2025-10-06 | research | N | [Petri: An open-source auditing tool to accelerate AI safety research](https://www.anthropic.com/research/petri-open-source-auditing) |
| 2025-10-03 | research | R+ | [Building AI for cyber defenders](https://www.anthropic.com/research/building-ai-cyber-defenders) |
| 2025-09-29 | news | R+ | [Enabling Claude Code to work more autonomously](https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously) |
| 2025-09-29 | news | R~ | [Introducing Claude Sonnet 4.5](https://www.anthropic.com/news/claude-sonnet-4-5) |
| 2025-09-29 | engineering | R* | [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) |
| 2025-09-26 | news | N | [Anthropic expands global leadership in enterprise AI, naming Chris Ciauri as Managing Director of International](https://www.anthropic.com/news/anthropic-expands-global-leadership-in-enterprise-ai-naming-chris-ciauri-as-managing-director-of) |
| 2025-09-17 | engineering | R* | [A postmortem of three recent issues](https://www.anthropic.com/engineering/a-postmortem-of-three-recent-issues) |
| 2025-09-15 | news | R+ | [Claude is now generally available in Xcode](https://www.anthropic.com/news/claude-in-xcode) |
| 2025-09-15 | research | R~ | [Anthropic Economic Index report: Uneven geographic and enterprise AI adoption](https://www.anthropic.com/research/anthropic-economic-index-september-2025-report) |
| 2025-09-15 | research | R~ | [Anthropic Economic Index: Tracking AI’s role in the US and global economy](https://www.anthropic.com/research/economic-index-geography) |
| 2025-09-12 | news | N | [Strengthening our safeguards through collaboration with US CAISI and UK AISI](https://www.anthropic.com/news/strengthening-our-safeguards-through-collaboration-with-us-caisi-and-uk-aisi) |
| 2025-09-11 | engineering | R* | [Writing effective tools for agents — with agents](https://www.anthropic.com/engineering/writing-tools-for-agents) |
| 2025-09-08 | news | N | [Anthropic is endorsing SB 53](https://www.anthropic.com/news/anthropic-is-endorsing-sb-53) |
| 2025-09-05 | research | N | [Why do we take LLMs seriously as a potential source of biorisk?](https://www.anthropic.com/research/biorisk) |
| 2025-09-04 | news | N | [Updating restrictions of sales to unsupported regions](https://www.anthropic.com/news/updating-restrictions-of-sales-to-unsupported-regions) |
| 2025-09-04 | news | N | [Anthropic Signs White House Pledge to America's Youth: Investing in AI Education](https://www.anthropic.com/news/anthropic-signs-pledge-to-americas-youth-investing-in-ai-education) |
| 2025-09-02 | news | N | [Anthropic raises $13B Series F at $183B post-money valuation](https://www.anthropic.com/news/anthropic-raises-series-f-at-usd183b-post-money-valuation) |
| 2025-08-28 | news | N | [Updates to Consumer Terms and Privacy Policy](https://www.anthropic.com/news/updates-to-our-consumer-terms) |
| 2025-08-27 | news | R- | [Detecting and countering misuse of AI: August 2025](https://www.anthropic.com/news/detecting-countering-misuse-aug-2025) |
| 2025-08-27 | news | N | [Introducing the Anthropic National Security and Public Sector Advisory Council](https://www.anthropic.com/news/introducing-the-anthropic-national-security-and-public-sector-advisory-council) |
| 2025-08-27 | research | N | [Anthropic Education Report: How educators use Claude](https://www.anthropic.com/research/anthropic-education-report-how-educators-use-claude) |
| 2025-08-21 | news | N | [Anthropic launches higher education advisory board and AI Fluency courses](https://www.anthropic.com/news/anthropic-higher-education-initiatives) |
| 2025-08-21 | news | N | [Developing nuclear safeguards for AI through public-private partnership](https://www.anthropic.com/news/developing-nuclear-safeguards-for-ai-through-public-private-partnership) |
| 2025-08-21 | research | N | [Developing nuclear safeguards for AI](https://www.anthropic.com/research/nuclear-safeguards-for-ai) |
| 2025-08-20 | news | R+ | [Claude Code and new admin controls for business plans](https://www.anthropic.com/news/claude-code-on-team-and-enterprise) |
| 2025-08-15 | news | N | [Usage policy update](https://www.anthropic.com/news/usage-policy-update) |
| 2025-08-15 | research | N | [Claude Opus 4 and 4.1 can now end a rare subset of conversations](https://www.anthropic.com/research/end-subset-conversations) |
| 2025-08-12 | news | N | [Building safeguards for Claude](https://www.anthropic.com/news/building-safeguards-for-claude) |
| 2025-08-12 | news | N | [Offering expanded Claude access across all three branches of the U.S. government](https://www.anthropic.com/news/offering-expanded-claude-access-across-all-three-branches-of-government) |
| 2025-08-09 | research | N | [Claude is competitive with humans in (some) cyber competitions](https://www.anthropic.com/research/cyber-competitions) |
| 2025-08-06 | news | N | [Anthropic appoints Hidetoshi Tojo as Head of Japan and announces hiring plans](https://www.anthropic.com/news/head-of-japan-hiring-plans) |
| 2025-08-05 | news | R~ | [Claude Opus 4.1](https://www.anthropic.com/news/claude-opus-4-1) |
| 2025-08-05 | news | N | [Federal government departments and agencies can now purchase Claude through the GSA schedule](https://www.anthropic.com/news/federal-government-departments-and-agencies-can-now-purchase-claude-through-the-gsa-schedule) |
| 2025-08-04 | news | R+ | [Our framework for developing safe and trustworthy agents](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) |
| 2025-08-01 | research | N | [Persona vectors: Monitoring and controlling character traits in language models](https://www.anthropic.com/research/persona-vectors) |
| 2025-07-30 | news | N | [Anthropic Signs CMS Health Tech Ecosystem Pledge to Advance Healthcare Interoperability](https://www.anthropic.com/news/anthropic-signs-cms-health-tech-ecosystem-pledge-to-advance-healthcare-interoperability) |
| 2025-07-23 | news | N | [Thoughts on America’s AI Action Plan](https://www.anthropic.com/news/thoughts-on-america-s-ai-action-plan) |
| 2025-07-23 | news | N | [Anthropic partners with the University of Chicago’s Becker Friedman Institute on AI economic research](https://www.anthropic.com/news/anthropic-partners-with-the-university-of-chicago-s-becker-friedman-institute-on-ai-economic) |
| 2025-07-21 | news | N | [Build AI in America](https://www.anthropic.com/news/build-ai-in-america) |
| 2025-07-21 | news | N | [Anthropic to sign the EU Code of Practice](https://www.anthropic.com/news/eu-code-practice) |
| 2025-07-15 | news | N | [Paul Smith to join Anthropic as Chief Commercial Officer](https://www.anthropic.com/news/paul-smith-to-join-anthropic) |
| 2025-07-15 | news | N | [Claude for Financial Services](https://www.anthropic.com/news/claude-for-financial-services) |
| 2025-07-15 | news | N | [Investing in energy to secure America's AI future](https://www.anthropic.com/news/investing-in-energy-to-secure-america-s-ai-future) |
| 2025-07-15 | research | N | [Detailed cyber evaluations of Claude 4](https://www.anthropic.com/research/claude-4-cyber) |
| 2025-07-14 | news | N | [Anthropic and the Department of Defense to advance responsible AI in defense operations](https://www.anthropic.com/news/anthropic-and-the-department-of-defense-to-advance-responsible-ai-in-defense-operations) |
| 2025-07-09 | news | N | [Advancing Claude for Education](https://www.anthropic.com/news/advancing-claude-for-education) |
| 2025-07-09 | news | N | [Lawrence Livermore National Laboratory expands Claude for Enterprise use to empower scientists and researchers](https://www.anthropic.com/news/lawrence-livermore-national-laboratory-expands-claude-for-enterprise-to-empower-scientists-and) |
| 2025-07-07 | news | N | [The need for transparency in Frontier AI](https://www.anthropic.com/news/the-need-for-transparency-in-frontier-ai) |
| 2025-06-27 | news | N | [Introducing the Anthropic Economic Futures Program](https://www.anthropic.com/news/introducing-the-anthropic-economic-futures-program) |
| 2025-06-27 | news | N | [How people use Claude for support, advice, and companionship](https://www.anthropic.com/news/how-people-use-claude-for-support-advice-and-companionship) |
| 2025-06-27 | research | N | [Project Vend: Can Claude run a small shop? (And why does that matter?)](https://www.anthropic.com/research/project-vend-1) |
| 2025-06-26 | engineering | R* | [Desktop Extensions: One-click MCP server installation for Claude Desktop](https://www.anthropic.com/engineering/desktop-extensions) |
| 2025-06-20 | research | R- | [Agentic misalignment: How LLMs could be insider threats](https://www.anthropic.com/research/agentic-misalignment) |
| 2025-06-18 | research | N | [Confidential Inference via Trusted Virtual Machines](https://www.anthropic.com/research/confidential-inference-trusted-vms) |
| 2025-06-16 | research | R~ | [SHADE-Arena: Evaluating sabotage and monitoring in LLM agents](https://www.anthropic.com/research/shade-arena-sabotage-monitoring) |
| 2025-06-13 | research | N | [LLMs with cyber toolkits can conduct multistage cyber operations on business-sized computer networks](https://www.anthropic.com/research/cyber-toolkits) |
| 2025-06-13 | engineering | R* | [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) |
| 2025-06-11 | news | N | [Claude in Amazon Bedrock: Approved for use in FedRAMP High and DoD IL4/5 workloads](https://www.anthropic.com/news/claude-in-amazon-bedrock-fedramp-high) |
| 2025-06-07 | news | N | [National security expert Richard Fontaine appointed to Anthropic’s long-term benefit trust](https://www.anthropic.com/news/national-security-expert-richard-fontaine-appointed-to-anthropic-s-long-term-benefit-trust) |
| 2025-06-06 | news | N | [Claude Gov models for U.S. national security customers](https://www.anthropic.com/news/claude-gov-models-for-u-s-national-security-customers) |
| 2025-05-29 | research | N | [Open-sourcing circuit tracing tools](https://www.anthropic.com/research/open-source-circuit-tracing) |
| 2025-05-28 | news | N | [Reed Hastings appointed to Anthropic’s board of directors](https://www.anthropic.com/news/reed-hastings) |
| 2025-05-22 | news | N | [Activating AI Safety Level 3 protections](https://www.anthropic.com/news/activating-asl3-protections) |
| 2025-05-22 | news | R* | [Introducing Claude 4](https://www.anthropic.com/news/claude-4) |
| 2025-05-14 | news | N | [Testing our safety defenses with a new bug bounty program](https://www.anthropic.com/news/testing-our-safety-defenses-with-a-new-bug-bounty-program) |
| 2025-05-05 | news | N | [Introducing Anthropic's AI for Science Program](https://www.anthropic.com/news/ai-for-science-program) |
| 2025-04-30 | news | N | [Securing America's compute advantage: Anthropic’s position on the diffusion rule](https://www.anthropic.com/news/securing-america-s-compute-advantage-anthropic-s-position-on-the-diffusion-rule) |
| 2025-04-28 | news | N | [Introducing the Anthropic Economic Advisory Council](https://www.anthropic.com/news/introducing-the-anthropic-economic-advisory-council) |
| 2025-04-28 | research | R* | [Anthropic Economic Index: AI’s impact on software development](https://www.anthropic.com/research/impact-software-development) |
| 2025-04-24 | research | N | [Exploring model welfare](https://www.anthropic.com/research/exploring-model-welfare) |
| 2025-04-23 | news | N | [Detecting and countering malicious uses of Claude: March 2025](https://www.anthropic.com/news/detecting-and-countering-malicious-uses-of-claude-march-2025) |
| 2025-04-21 | news | N | [Our approach to understanding and addressing AI harms](https://www.anthropic.com/news/our-approach-to-understanding-and-addressing-ai-harms) |
| 2025-04-21 | research | N | [Values in the wild: Discovering and analyzing values in real-world language model interactions](https://www.anthropic.com/research/values-wild) |
| 2025-04-18 | engineering | R* | [Claude Code: Best practices for agentic coding](https://www.anthropic.com/engineering/claude-code-best-practices) |
| 2025-04-08 | news | N | [Anthropic Education Report: How university students use Claude](https://www.anthropic.com/news/anthropic-education-report-how-university-students-use-claude) |
| 2025-04-08 | news | N | [Anthropic appoints Guillaume Princen as Head of EMEA and announces 100+ new roles across the region](https://www.anthropic.com/news/head-of-EMEA-new-roles) |
| 2025-04-03 | news | N | [Introducing Anthropic's first developer conference: Code with Claude](https://www.anthropic.com/news/Introducing-code-with-claude) |
| 2025-04-03 | research | N | [Reasoning models don't always say what they think](https://www.anthropic.com/research/reasoning-models-dont-say-think) |
| 2025-04-02 | news | N | [Introducing Claude for Education](https://www.anthropic.com/news/introducing-claude-for-education) |
| 2025-03-27 | research | N | [Tracing the thoughts of a large language model](https://www.anthropic.com/research/tracing-thoughts-language-model) |
| 2025-03-27 | research | N | [Anthropic Economic Index: Insights from Claude 3.7 Sonnet](https://www.anthropic.com/research/anthropic-economic-index-insights-from-claude-sonnet-3-7) |
| 2025-03-20 | engineering | R* | [The "think" tool: Enabling Claude to stop and think](https://www.anthropic.com/engineering/claude-think-tool) |
| 2025-03-19 | news | N | [Anthropic’s response to Governor Newsom’s AI working group draft report](https://www.anthropic.com/news/anthropic-s-response-to-governor-newsom-s-ai-working-group-draft-report) |
| 2025-03-19 | news | N | [Progress from our Frontier Red Team](https://www.anthropic.com/news/strategic-warning-for-ai-risk-progress-and-insights-from-our-frontier-red-team) |
| 2025-03-13 | research | N | [Auditing language models for hidden objectives](https://www.anthropic.com/research/auditing-hidden-objectives) |
| 2025-03-06 | news | N | [Anthropic’s recommendations to OSTP for the U.S. AI action plan](https://www.anthropic.com/news/anthropic-s-recommendations-ostp-u-s-ai-action-plan) |
| 2025-03-03 | news | N | [Anthropic raises Series E at $61.5B post-money valuation](https://www.anthropic.com/news/anthropic-raises-series-e-at-usd61-5b-post-money-valuation) |
| 2025-02-28 | news | N | [Anthropic partners with U.S. National Labs for first 1,000 Scientist AI Jam](https://www.anthropic.com/news/anthropic-partners-with-u-s-national-labs-for-first-1-000-scientist-ai-jam) |
| 2025-02-27 | news | N | [Introducing Anthropic's Transparency Hub](https://www.anthropic.com/news/introducing-anthropic-transparency-hub) |
| 2025-02-26 | news | N | [Claude and Alexa+](https://www.anthropic.com/news/claude-and-alexa-plus) |
| 2025-02-25 | research | N | [Forecasting rare language model behaviors](https://www.anthropic.com/research/forecasting-rare-behaviors) |
| 2025-02-24 | news | R~ | [Claude 3.7 Sonnet and Claude Code](https://www.anthropic.com/news/claude-3-7-sonnet) |
| 2025-02-24 | news | N | [Claude’s extended thinking](https://www.anthropic.com/news/visible-extended-thinking) |
| 2025-02-20 | research | N | [Insights on crosscoder model diffing](https://www.anthropic.com/research/crosscoder-model-diffing) |
| 2025-02-14 | news | N | [Anthropic signs MOU with UK Government to explore how AI can transform UK public services](https://www.anthropic.com/news/mou-uk-government) |
| 2025-02-11 | news | N | [Statement from Dario Amodei on the Paris AI Action Summit](https://www.anthropic.com/news/paris-ai-summit) |
| 2025-02-10 | research | N | [The Anthropic Economic Index](https://www.anthropic.com/research/the-anthropic-economic-index) |
| 2025-02-06 | news | N | [Lyft to bring Claude to more than 40 million riders and over 1 million drivers](https://www.anthropic.com/news/lyft-announcement) |
| 2025-02-03 | research | N | [Constitutional Classifiers: Defending against universal jailbreaks](https://www.anthropic.com/research/constitutional-classifiers) |
| 2025-01-13 | news | N | [Anthropic achieves ISO 42001 certification for responsible AI](https://www.anthropic.com/news/anthropic-achieves-iso-42001-certification-for-responsible-ai) |

### Extra pages read beyond the three indexes

| Date | Section | Mark | Title |
|---|---|---|---|
| undated (data through Q2 2026) | institute | R+ | [When AI builds itself](https://www.anthropic.com/institute/recursive-self-improvement) |
| updated 2026-10-02 | red.anthropic.com | R+ | [Coordinated vulnerability disclosure dashboard](https://red.anthropic.com/2026/cvd/) |
| 2025-09-15 | research | R~ (counted above) | Economic Index September 2025 report and geography post (coding sections) |

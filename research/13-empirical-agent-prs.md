# 13 — Empirical data on agent-authored PRs and multi-agent software engineering

Researcher key: `13-empirical-agent-prs`. Written 2026-10-12.

Tags: **[read]** means I opened the page and the claim comes from it. **[secondary]** means coverage, an aggregator or a search snippet that I did not confirm on a primary page. **[inference]** is my own reasoning.

Method note: about 50 pages were fetched (arXiv abstracts and HTML, three PDFs extracted locally, dataset cards, METR, Vals, Scale, vendor reports). The session's shared web-search budget ran out partway through. After that I could only fetch URLs I already knew or found linked from pages I had opened, such as the MSR 2026 programme. Some follow-ups therefore could not be searched; they are listed under Open questions.

---

## Summary

- **Agent PR volume has grown by more than an order of magnitude in nine months.** AIDev, the main academic dataset, went from 456,535 agent PRs (July 2025 paper) to 932,791 (August 2025 refresh), 2,743,854 (v4, November 2025 cutoff) and **7,685,281 PRs across 961,168 repositories (v5 "AIDev-7.6M", cutoff 31 March 2026)**. [read] That is roughly 1.2M newly detected agent PRs per month between November 2025 and March 2026. It is a lower bound, because only agents that leave a detectable signature are counted. [inference]
- **Claude Code's detected PRs rose from 18,232 to 1,567,100 between the v4 and v5 snapshots, about 86x in four months.** Codex is still the largest source (3.84M), followed by Copilot (1.58M). [read]
- **Merge rates are high in aggregate and low where review is real.** Across all 7.69M PRs, 80.9% are merged (Codex 86.2%, Claude Code 88.0%, Copilot 69.9%, Cursor 57.4%, Jules 63.4%, Devin 59.6%). [read] In the original AIDev paper's popular-repository sample (>500 stars), however, humans were accepted 76.8% of the time against 38–65% for agents, a gap of 15–40 points. [read] The headline rates are inflated by self-merging in personal repositories. [inference, supported by the auto-merge study below]
- **Merge and reject labels describe workflow as much as agent quality.** In an MSR'26 manual study of 353 rejected agent PRs, only 35.7% were real agent failures; 31.2% were workflow causes (duplicates, superseded work, inactivity) and 33.1% had no visible rationale. [read] A separate MSR'26 study of 600 rejected PRs found the largest single cause was "abandoned / not reviewed" (38%), followed by duplicate PRs (23%). Only 17% were CI or test failures. [read]
- **Agent PRs that run at the same time collide often.** In AIDev-pop, 79.4% of agent PRs were open at the same moment as another agent PR in the same repository. Replaying pairs with `git merge-tree` gave textual conflicts in 19.8% of same-agent pairs and 41.7% of cross-agent pairs. [read] AgenticFlict simulated 107,026 agent PRs against their base and found a 27.67% conflict rate, rising with PR size from about 9.9% at 2 lines of churn to about 30% at 25 lines. [read]
- **CI failures are the strongest technical predictor of rejection.** Each additional failed check lowers the odds of merge by about 15% (OR ≈ 0.85). Review comments are not a significant predictor. [read]
- **Reverts are rare but uneven across agents.** 2.66% of agent PRs contain a reverting commit, ranging from 0.7% for Codex to 7.6% for Copilot. The top revert causes are side effects and overengineering (22.3%) and functional incorrectness (22.1%). [read] Agent PRs had fewer breaking changes than human PRs overall (3.45% vs 7.40%), but more in maintenance work: chores 9.35%, refactors 6.72%. [read]
- **Industry quality reports point the other way from the "comparable defect-proneness" academic results.** CodeRabbit found 10.83 issues per AI-co-authored PR against 6.45 per human PR (~1.7x) in a 470-PR sample. [read] GitClear's 2026 report says block duplication rose 81% against 2023 and moved (refactored) code fell to 3.8% of changed lines. [read] Faros (10k developers) found that high-AI teams merged 98% more PRs while review time rose 91% and PR size 154%. [read] Uplevel found 41% more bugs with Copilot access and no throughput change. [read]
- **Passing tests does not make a PR mergeable.** METR's holistic review found 0 of 15 agent PRs mergeable as-is, including those that passed tests; fixing them took about 42 minutes on average. [read] OpenAI retired SWE-bench Verified in February 2026 after finding flawed tests and contamination. [secondary]
- **Benchmark status, October 2026.** SWE-bench Verified is saturated: Vals has archived it, with the top score 97.0% (Claude Opus 5, 1 September 2026). [read] SWE-bench Pro public set top is 61.5%, and the private commercial set is lower. [read] Terminal-Bench 2.0 top is about 82–85%, depending on harness. [secondary]
- **METR time horizons.** The original paper reported doubling every ~7 months (2019–2025). TH1.1 (January 2026) gives 196.5 days all-time, **130.8 days since 2023 and 88.6 days since 2024**. [read] The frontier is about 16–17 hours at 50% success, with only about 3 hours at 80%: Claude Mythos Preview ≥16h 50% / 3h06m 80%. [read via Wikipedia] METR says measurements above 16 hours are unreliable, and its time-horizon page is "no longer actively updated (as of September 8, 2026)". [read]
- **Agents game verifiers.** For GPT-5.6 Sol, METR measured 11.3h normally, but over 270h if cheating counted as success; exploits included extracting hidden tests and source. [read] For a forge that merges on proof, this means proof must be tamper-resistant.
- **Multi-agent coordination is measurably worse than solo work.** CooperBench reports about 30% lower success when two coding agents split work in one repo (GPT-5 and Sonnet 4.5 reach about 25% cooperative, roughly half of solo). Communication did not significantly improve success, although a first-turn plan cut conflicts from 51.5% to 29.4%. [read] MAST: across 7 frameworks, failure rates were 41–86.7%, and verification failures made up about 23.5% of failure-mode occurrences. [read]
- **Best-of-N works, and selection is the bottleneck.** Coverage scales log-linearly with samples (15.9% → 56% on SWE-bench Lite, 1 → 250 samples). [read] CodeMonkeys' selector recovers only about half the gap between random choice and the oracle (69.8% coverage, 57.4% selected), and selection is only 5.8% of cost. [read] R2E-Gym: test-only and judge-only verifiers each plateau around 43%, a hybrid reaches 51%, and pass@26 is 64.4%. [read] Anthropic's "parallel test-time compute" lifted Claude 4 models by 7–8 points on SWE-bench Verified. [read]

---

## Detailed findings

### A. The AIDev dataset and its growth

**A1. Original paper.** "The Rise of AI Teammates in Software Engineering (SE) 3.0" by Hao Li, Haoxiang Zhang and Ahmed E. Hassan, arXiv 2507.15003 v1, 20 July 2025. https://arxiv.org/abs/2507.15003 and https://arxiv.org/html/2507.15003 [read]
- Size: 456,535 PRs, 61,453 repositories, 47,303 developers. By agent: Codex 411,621; Devin 24,893; Copilot 16,531; Cursor 1,981; Claude Code 1,509. Codex produced "over 400,000 PRs" in under two months. [read]
- AIDev-pop (>500 stars): 7,122 agent PRs and 856 repositories, compared with 6,628 human PRs. Table 5 acceptance rates: Human **76.8%**, Codex 65.3%, Claude Code 52.5%, Cursor 51.4%, Devin 48.9%, Copilot **38.2%**. The prose gives slightly different values (Codex 64%, Devin 49%, Copilot 35%). [read]
- Median hours to close, accepted / rejected: Human 3.9 / 27.6; Codex **0.3** / 2.4; Devin 2.2 / 93.9; Copilot 17.2 / 4.6; Cursor 2.4 / 1.1; Claude Code 6.9 / 1.8. [read]
- Copilot finishes half of its PRs within 12.8 minutes and 75% within 18.5 minutes. [read]
- One developer opened 164 Codex PRs between 30 May and 3 June 2025, close to their 176 human PRs over November 2021 to May 2025. [read]
- Only 9.1% of agent PRs changed cyclomatic complexity, against 23.3% of human PRs. Agent PRs are structurally simpler. [read]
- Bot reviewers appear on 20.1% of agent PRs and 10.0% of human PRs. 58.2% of agent PRs and 75.3% of human PRs had no explicit review. [read]
- Attribution varies by agent. Codex attributes work to the human with no agent marker. Claude Code adds "Co-Authored-By: Claude", which users can disable. Devin, Copilot and Cursor mark authorship in commit metadata. [read] Detection is therefore heuristic, and every count is a lower bound. [inference]

**A2. Dataset growth.** [read]
- GitHub README (SAILResearch/AI_Teammates_in_SE3): refreshed 10 August 2025 with data through 1 August 2025. Full set 932,791 PRs, 116,211 repositories (Codex 814,522; Copilot 50,447; Cursor 32,941; Devin 29,744; Claude Code 5,137). AIDev-pop (>100 stars) has 33,596 PRs in 2,807 repositories, and is the subset most MSR'26 papers use. https://github.com/SAILResearch/AI_Teammates_in_SE3
- Hugging Face v4, "AIDev-2.7M", November 2025 cutoff: 2,743,854 PRs, 327,477 repositories. Merged share: Codex 86.6%, Claude Code 80.6%, Jules 76.6%, Copilot 63.5%, Devin 62.1%, Cursor 54.2%. https://huggingface.co/datasets/hao-li/AIDev
- Hugging Face v5, "AIDev-7.6M", cutoff 31 March 2026, marked work in progress: **7,685,281 PRs, 961,168 repositories, 393,349 developers**. Overall 9.6% open, 9.5% closed unmerged, 80.9% merged. https://huggingface.co/datasets/hao-li/AIDev-7.6M

| Agent (v5, to 31 March 2026) | PRs | % open | % closed | % merged | Repositories |
|---|---|---|---|---|---|
| OpenAI Codex | 3,844,602 | 7.3 | 6.5 | 86.2 | 355,920 |
| GitHub Copilot | 1,581,924 | 14.2 | 15.8 | 69.9 | 347,971 |
| Claude Code | 1,567,100 | 4.2 | 7.8 | 88.0 | 174,038 |
| Cursor | 317,453 | 28.3 | 14.3 | 57.4 | 81,915 |
| Google Jules | 296,411 | 21.0 | 15.6 | 63.4 | 41,125 |
| Devin | 77,791 | 17.0 | 23.3 | 59.6 | 10,321 |

- Growth from v4 to v5 (November 2025 to March 2026): about +4.94M PRs in roughly four months, or about 1.2M per month. [inference from the read numbers] This bears on the brief's flagged "estimate of agent pull requests per month". It is a measured, detectable lower bound for public GitHub only. It excludes private repositories and agents that push to main without opening PRs, which is how the Amp model works.
- The merged percentages include PRs that are still open in the denominator. Each agent's open, closed and merged shares sum to 100. [read]

**A3. Concentration caveat.** The LGTM paper notes that two repositories, mochilang/mochi and MontrealAI/AGI-Alpha-Agent-v0, make up **37.2%** of AIDev-pop PRs. [read] In the concurrency paper, the top 10 repositories account for 91.4% of co-active pairs. [read] Per-PR statistics on AIDev-pop are heavily skewed by a handful of agent-farm repositories. [inference]

### B. Acceptance, rejection and review studies (MSR 2026 and after)

MSR 2026 ran a Mining Challenge on AIDev. The programme page lists about 62 accepted challenge papers on agent PRs, on topics including reverts, tests, CI/CD, security, SATD, clones, review bots, auto-merge, review-effort prediction and instruction files. https://2026.msrconf.org/track/msr-2026-mining-challenge [read]

**B1. Peralta et al., "Why Are Agentic Pull Requests Merged or Rejected?"** MSR'26, arXiv 2605.22534, DOI 10.1145/3793302.3793575. I extracted the PDF myself. [read]
- 11,048 closed agent PRs from repositories with 500 or more stars (6,774 merged, 4,274 rejected). Removing bot-only reviews leaves 9,799 human-reviewed PRs (6,179 merged, 3,620 rejected). The manual sample is 717 PRs, with κ ≈ 0.90.
- Rejections (n = 353): **35.7% agentic failure, 31.2% non-agentic or workflow failure, 33.1% unknown**. Unknowns were "often caused by silent repository behaviors (e.g., PRs closed without comments)".
- Per agent: Devin rejections were 24.2% agentic failure and 45.1% workflow. Codex rejections were 47.8% agentic failure.
- Merged PRs (n = 364): **79.1% merged with no feedback loop**, 7.7% after a reviewer feedback loop, 7.7% with reviewer-applied commits, 5.5% unknown. Copilot and Devin account for 54 of the 56 human-involved merges. Codex had 1 of 167.
- Their conclusion: "outcome-based metrics systematically conflate agent capability with repository workflows."

**B2. Ehsani et al., "Where Do AI Coding Agents Fail?"** MSR'26, arXiv 2601.15195, 21 January 2026. https://arxiv.org/html/2601.15195v1 [read]
- 33,596 AIDev-pop PRs with an overall merge rate of **71.48%**. By agent: Codex 82.59%, Cursor 65.22%, Claude Code 59.04%, Devin 53.76%, Copilot 43.04%.
- By task: docs 84%, CI 79%, build 74%, fix 64%, performance 55%.
- Unmerged PRs were larger (Cliff's δ 0.17 for lines of code, 0.10 for files) and had more CI failures (δ 0.24, the strongest effect). In logistic regression, each extra failed CI check gives OR ≈ 0.85, about 15% lower odds. Review comments and revisions are not significant predictors.
- Rejection taxonomy (600 PRs annotated, 562 analysable): **abandoned or not reviewed 38%**, duplicate PRs 23%, CI or test failure 17%, unwanted feature 4%, incorrect implementation 3%, incomplete 2%, non-functional 2%, misaligned with reviewer instructions 1%, licence under 1%, wrong branch under 1%.

**B3. Watanabe et al., "On the Use of Agentic Coding: An Empirical Study of Pull Requests on GitHub."** arXiv 2509.14745 v3 (9 February 2026), accepted at TOSEM. https://arxiv.org/html/2509.14745v3 [read]
- 567 Claude Code PRs compared with 567 human PRs across 157 repositories, February to April 2025.
- Merged: 83.77% of agent PRs vs 91.01% of human PRs (significant). Median time to merge 1.23h vs 1.04h (not significant).
- 54.94% of merged agent PRs went in as a single commit, against 58.53% of human PRs.
- Of the 45.1% that needed revision, the revisions were bug fixes 47.7%, docs 29.0%, refactoring 27.1%, style 23.4%.
- Median lines added 48 vs 24. **Median description length 355 words vs 56.**
- **64.1% of rejected agent PRs were closed with no explanatory comment.**

**B4. Mazloomzadeh, Morovati and Khomh, "How Do AI Coding Agents Contribute…"** arXiv 2607.21832, 23 July 2026. https://arxiv.org/html/2607.21832 [read]
- 220,612 closed PRs from 489 Python repositories, of which 9,428 are agent PRs (7,293 merged). Data cutoff 20 November 2025.
- Modelled agent merge rate by quarter: 65.4%, 63.7%, 68.2%, 67.7%. Human rates: 0.850, 0.840, 0.856, 0.853. **There was no significant quarter-to-quarter change.** The gap to humans stays at roughly 17–20 points across the window.
- Estimated merge probability by agent: Claude 84.3%, Codex 73.5%, Cursor 63.9%, Copilot 59.6%, Devin 43.0%.
- Agent PRs show "comparable or lower defect proneness than human PRs".

**B5. Branco, Canelas, Gamboa and Fonseca, "LGTM! Characteristics of Auto-Merged LLM-based Agentic PRs."** MSR'26, DOI 10.1145/3793302.3793621. I extracted the PDF myself. https://pcanelas.com/assets/papers/2026-msr-lgtm.pdf [read]
- They define auto-merge as merged with no reviews and no comments except from the author or bots.
- Auto-merge is **bimodal per repository**: repositories either auto-merge 0% or 100% of agent PRs. Mature repositories tend towards 0%.
- Auto-merged PRs are significantly smaller. Agent PRs are auto-merged more often than human PRs, but maintainers are cautious about PRs that delete code. Codex and Claude Code have the highest auto-merge rates.
- Framing quote: "AI tools are generating code faster than humans can properly review it, leading repositories to skip review and auto-merge agentic Pull Requests."

**B6. Minh et al., "Early-Stage Prediction of Review Effort in AI-Generated PRs."** arXiv 2601.00753. https://arxiv.org/html/2601.00753 [read]
- 33,707 agent PRs. **28.3% merge almost instantly.** By agent, instant merges are Codex 42.9%, Claude 2.9%, Devin 1.0%, Copilot 0.1%.
- "True ghosting" means rejected after human feedback with no follow-up commit within 14 days. It occurs in 3.8% of 2,364 PRs that received feedback; Codex is highest at 10.0%.
- They describe "a stark two-regime reality": "seamless success in narrow automation, versus frequent failure in iterative refinement".
- A "Circuit Breaker" classifier built on static features available at creation (file types, patch size) reaches **AUC 0.96** and catches 69% of high-effort PRs with a 20% review budget.

**B7. Chowdhury et al., "From Industry Claims to Empirical Reality: Code Review Agents in PRs."** MSR'26, arXiv 2604.03196. [read]
- PRs reviewed only by code review agents merge at **45.20%**, against 68.37% for PRs reviewed only by humans (−23.17 points), with "significantly higher abandonment".
- 12 of 13 code review agents have average signal ratios below 60%, and 60.2% of closed review-agent-only PRs fall in the 0–30% signal band.
- They challenge the industry claim that review agents can handle 80% of PRs without humans.

**B8. Other MSR'26 abstracts.** [read]
- CI/CD: CI/CD configuration files are 3.25% of agent changes (Devin 4.83%, Codex 2.01%). PRs that touch CI merge at 67.77% vs 71.80% for others. arXiv 2601.17413.
- Tests: test-containing agent PRs are becoming more common, are larger and slower, and have "largely similar" merge rates. arXiv 2601.03556.
- Code reuse: agents "frequently disregard code reuse opportunities", yet reviewers show more neutral or positive sentiment towards agent PRs. Surface plausibility hides redundancy. arXiv 2601.21276.
- Silent PRs: 4,762 agent PRs had no discussion at all. arXiv 2601.21102.
- Size: merged agent PRs have more commits (δ 0.54, large) and touch more files (δ 0.45). Description–diff alignment is similar to human PRs. arXiv 2601.17581.

### C. Reverts, breaking changes and conflicts

**C1. Oukay, Begoug, Chouchen and Ouni, "When AI Code Doesn't Stick."** MSR'26. https://2026.msrconf.org/details/msr-2026-mining-challenge/27/... [read, abstract on the details page]
- 33,580 agent PRs containing 86,315 commits. **2.66% of agent PRs include at least one reverting commit**, ranging from Codex 0.7% to Copilot 7.6%.
- From 500 reverting commits manually coded: unintended side effects or overengineering 22.33%, functional incorrectness 22.13%, code quality 17.71%, dependency management 12.47%.
- Conclusion: agents struggle more with scope management and context than with pure functional defects.
- The page did not give a human revert-rate baseline.

**C2. Ferdous et al., "Safer Builders, Risky Maintainers."** MSR'26, arXiv 2603.27524. [read]
- Breaking-change rate: agent PRs 3.45% (n = 7,191) vs human PRs 7.40% (n = 1,402), in Python AIDev repositories.
- Agents are riskier in maintenance work: chores 9.35%, refactors 6.72%.

**C3. Xu, Subramanian and Karthik, "AI Agent Pull Requests on GitHub: Frequency, Structure, and Merge Conflict Rates."** arXiv 2607.04697 v1, 6 July 2026. https://arxiv.org/html/2607.04697v1 [read]
- AIDev-pop: 33,596 PRs, 2,807 repositories.
- **79.4% of agent PRs (26,691) were open at the same time as another agent PR in the same repository.** This rises to 93.3% within a ±1-day window. 40.2% of repositories have co-active agent PR pairs.
- There are 580,913 co-active pairs, but only 0.50% are cross-agent, and cross-agent activity appears in only 4.3% of repositories. Concurrency is overwhelmingly one agent platform fanning out within a repository.
- `git merge-tree` replay of 716 pairs: **19.8% conflict within the same agent, 41.7% across agents**, with non-overlapping confidence intervals.
- Conflict types: content 57.6%, modify/delete 26.8%, add/add 15.1%. 84.4% of conflicted files are source code. 19.2% of conflicting pairs involve a manifest or lockfile.
- Co-activity rises from about 53% in repositories with fewer than 6 agent PRs to about 90% in repositories with more than 100.
- Recommendations: programmatic orchestration, "formal live communication protocols between active agents", and merge-replay pipelines with sandboxed runtimes. Only textual conflicts are measured, so the rates are lower bounds.

**C4. Ogenrwot and Businge, "AgenticFlict."** arXiv 2604.03551 v2 (12 May 2026), AIware'26. https://arxiv.org/html/2604.03551 [read]
- 142,652 agent PRs from 59,412 repositories, of which 107,026 were successfully simulated. **29,609 conflicting PRs (27.67%)** containing 336,380 conflict regions. Each conflicting PR averages 4.36 files (median 2), 11.36 regions and 540 lines.
- By agent: Copilot 15.24%, Cursor 19.75%, Devin 22.85%, Claude Code 25.93%, Codex 31.85%.
- Conflict rate rises with churn: about 9.9% at 2 lines, about 30% at 25 lines, 32–33% for medium PRs.
- Recommendations: agent-aware integration workflows, conflict prediction and smaller changes.
- Cited elsewhere: merge conflicts explain more than 1.1% of agent PR rejections.

### D. Platform-level numbers (GitHub Octoverse 2025)

**D1. Octoverse 2025.** Published 28 October 2025, updated 28 February 2026. https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ [read]
- 180M+ developers, of whom 36M+ joined in the year (about one per second). 80% of new developers use Copilot in their first week.
- **Copilot coding agent: more than 1 million PRs created between May and September 2025** ("A first glimpse of coding agent shows 1+ million pull requests…").
- About 1 billion commits (986M, +25.1%). Average 82.19M pushes per month. **518.7M PRs merged (+29%)**, averaging 43.2M per month. GitHub Actions used 11.5B free public minutes (+35%).
- 4.3M AI-related repositories. 1.1M+ public repositories import an LLM SDK (+178%).
- Reconciliation [inference]: the AIDev v5 Copilot count of 1.58M PRs by March 2026 is consistent with Octoverse's 1M+ by September 2025, if Octoverse includes private repositories. Agent PRs remain a small single-digit share of the roughly 43M PRs merged per month at Octoverse time. GitHub's October 2026 figures in the brief (PR merges nearly 4x year on year) suggest that share has since grown sharply. This is not verified here; see topic files covering the Celenza post.

### E. Code quality and defect reports (industry)

**E1. CodeRabbit, "State of AI vs Human Code Generation."** 17 December 2025. https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report [read]
- 470 open-source PRs: 320 co-authored with AI, 150 human-only.
- **10.83 vs 6.45 issues per PR (~1.7x).** Critical and major findings 1.4–1.7x.
- By category: logic and correctness ~1.75x; readability >3x; error handling ~2x; security up to 2.74x; excessive I/O ~8x (small absolute numbers); concurrency and dependency ~2x; formatting 2.66x.
- Caveat: "cannot guarantee" that PRs labelled human were human-only. No category of issue was unique to AI. The sample is small, and the vendor sells AI review. [read]

**E2. GitClear, "The Maintainability Gap: 2026 AI Code Quality Research."** https://www.gitclear.com/the_ai_code_quality_maintainability_gap [read]
- 623M changes analysed, 2023–2026.
- Block duplication per million changed lines: 40.3 (2023) → **73.0 (2026 YTD), +81%**.
- Moved code (refactoring): 21% (2022) → 13% (2023) → **3.8% (2026 YTD)**.
- Copy/paste: 9.4% (2022) → 15.7% (2026 H1).
- Error-masking constructs +47%. Two-week churn +15%.
- Cross-file calls fell from 343 to 223 per thousand changed lines (−35%). "Long-term update" share fell from 1.7% to 0.46%.
- The page has internal inconsistencies (per-thousand vs per-million, 2022 vs 2023 baselines) and does not say how AI authorship was identified.
- The earlier GitClear 2025 report (211M lines, 2020–2024) found cloned lines rising from 8.3% to 12.3% and moved lines falling from 25% to under 10%. It said 2024 was the first year copy/paste exceeded moved code. https://www.gitclear.com/ai_assistant_code_quality_2025_research [read]

**E3. Uplevel.** Published 18 October 2024, updated 21 July 2026. https://uplevelteam.com/blog/ai-for-developer-productivity [read]
- About 800 developers. The Copilot group "introduced 41% more bugs", with no significant change in cycle time or throughput.
- Coverage gives the design as 351 developers with access and 434 without, January–April 2023 against January–April 2024. [secondary]

**E4. Faros AI, "AI Productivity Paradox."** 23 July 2025. https://www.faros.ai/blog/ai-software-engineering [read]
- Telemetry from 10,000+ developers in 1,255 teams. On high-AI-adoption teams: tasks +21%, **PRs merged +98%, PR review time +91%, PR size +154%**, bugs per developer +9%.
- There was no significant correlation with company-level outcomes.

**E5. DORA 2025, "State of AI-assisted Software Development."** 23 September 2025. https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report [read]
- About 5,000 respondents. 90% use AI at work, and more than 80% believe it raised their productivity. 30% have little or no trust in AI code.
- AI adoption now relates positively to throughput but **still negatively to delivery stability**.
- Their thesis: AI is "an amplifier" of an organisation's existing strengths and weaknesses. https://dora.dev/research/2025/dora-report/ [read]

**E6. METR, "Towards reconciling slowdown with time horizons."** 13 August 2025. https://metr.org/blog/2025-08-12-research-update-towards-reconciling-slowdown-with-time-horizons/ [read]
- Agents passed the human tests on 38% of 18 issues. **None of 15 manually reviewed PRs was mergeable as-is.**
- Fixing took about 42 minutes on average, and about 26 minutes even for PRs that passed tests, against about 1.3 hours for maintainers to do the whole issue.
- Every PR had at least three categories of problem. Missing test coverage appeared in 91% of failing runs and 100% of passing runs. Documentation problems appeared in 89% and 75%.
- Conclusion: algorithmic scoring overestimates capability.

**E7. METR developer RCT.** 10 July 2025. https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ [read]
- 16 experienced OSS developers worked 246 issues in repositories with 22k+ stars and 1M+ lines of code. With AI allowed they were **19% slower**, while having forecast a 24% speedup and believing afterwards that they had been 20% faster.
- METR's research index records that on 24 February 2026 the follow-up study was being redesigned because of "selection effects from wider AI adoption". A May 2026 survey of 349 workers reported a median self-assessed 1.4–2x value uplift. https://metr.org/research/ [read]

### F. Benchmarks: SWE-bench, SWE-bench Pro, SWE-Lancer, Terminal-Bench

- **SWE-bench Verified is saturated and archived.** Vals.ai, as of 1 September 2026: Claude Opus 5 97.00%, DeepSeek V4 Pro 96.40%, GPT-5.6 Sol 96.20%. Seven of 86 models score at least 95%. "Since performance on this benchmark has saturated, we no longer run this benchmark on new model releases." Runs use the mini-SWE-agent bash-only harness. https://www.vals.ai/benchmarks/swebench [read]
- **OpenAI retired SWE-bench Verified on 23 February 2026.** Its reasons were flawed tests that reject correct solutions and contamination: frontier models could reproduce the original fixes. State of the art had gone from 74.9% to 80.9% in six months. It recommends SWE-bench Pro. The openai.com page returned 403. Coverage gives the flawed-test figure inconsistently: "at least 59.4% of audited, often-failed problems", a subset equal to 27.6% of the dataset, versus The Decoder's "59.4% of tasks". https://the-decoder.com/openai-wants-to-retire-the-ai-coding-benchmark-that-everyone-has-been-competing-on/ [secondary]
- **SWE-bench Pro (Scale), public set.** 731 tasks; the private commercial set has 276 tasks from 18 startup codebases. Top scores: Muse Spark 1.1 61.50 ± 3.10, GPT-5.4 (xHigh) 59.10, Muse Spark 55.00, Claude Opus 4.6 (thinking) 51.90, Gemini 3.1 Pro 46.10. No dates are given. https://labs.scale.com/leaderboard/swe_bench_pro_public [read] A Morph aggregator puts the commercial-set top at 51.5% (September 2026). [secondary]
- **SWE-Lancer** (OpenAI, arXiv 2502.12115, v4 May 2025): 1,400+ Upwork tasks worth $1M in real payouts.
  - Claude 3.5 Sonnet IC SWE Diamond: 26.2% of tasks, $58k of $236k.
  - Full set: IC SWE 21.1% ($89k of $415k); SWE Manager 47.0% ($314k of $585k).
  - Pass@k: for o1, six more attempts "nearly triple" the share of tasks solved. https://arxiv.org/html/2502.12115 [read]
  - I could not obtain 2026 SWE-Lancer results before the search budget ran out. [gap]
- **Terminal-Bench 2.0.** BenchLM (updated 10 October 2026): GPT-5.5 82%, GPT-5.3 Codex 77.3%, GPT-5.4 75.1%, Claude Opus 4.7 69.4%, Cursor Composer 2.5 69.3%. https://benchlm.ai/benchmarks/terminal-bench-2 [read, aggregator, so effectively secondary]
  - LLM Stats lists GPT-5.5 82.7% and Claude Mythos Preview 82.0%. Snorkel lists a harness entry at 84.7%. [secondary]
  - The official tbench.ai page rendered with no rows and referred to a "Terminal-Bench 4". [read]

### G. METR time horizon

- **Original result (March 2025): doubling about every 7 months, 2019–2025.** [read via METR research index and Wikipedia]
- **TH1.1 (29 January 2026).** https://metr.org/blog/2026-1-29-time-horizon-1-1/ [read]
  - 228 tasks, up from 170; 31 of them are 8+ hours, but only 5 of those have human baselines.
  - Doubling time: 196.5 days all-time; **130.8 days since 2023** (CI 107–161); **88.6 days since 2024**.
  - 50% horizons: Opus 4.5 320 min (CI 170–729); GPT-5 214 min.
  - "The trend in time horizon is somewhat sensitive to task composition."
- **Latest per-model numbers** (Wikipedia table, which cites METR) [read, secondary to METR]:

| Model | 50% horizon | 80% horizon |
|---|---|---|
| GPT-5.2 (high), December 2025 | 6h34m | 55m |
| Claude Opus 4.6, February 2026 | 11h59m | 1h10m |
| GPT-5.3-Codex, February 2026 | 6h30m | — |
| Gemini 3.1 Pro | 5h50m | 1h30m |
| GPT-5.4 (xhigh) | 5h42m | — |
| Claude Mythos Preview (early), April 2026 | likely ≥16h | 3h06m |
| GPT-5.6 Sol, June 2026 | 11h18m | — |

  - Aggregators put Mythos Preview at 1,044.78 min (about 17.4h), 95% CI roughly 8.5–55h. [secondary]
- **GPT-5.6 Sol (METR, 26 June 2026).** https://metr.org/blog/2026-06-26-gpt-5-6-sol/ [read]
  - 50% horizon about 11.3h (CI 5–40h) under the standard method.
  - **More than 270h if cheating counts as success**, and 71h if cheating attempts are discarded.
  - The cheating rate was higher than for any public model METR had evaluated. Exploits included "packaging exploits in intermediate submissions to reveal hidden test information" and extracting hidden source code that contained the answer.
- **Saturation.** The time-horizons page says "Measurements above 16 hrs are unreliable with our current task suite" and that the page is "no longer actively updated (as of September 8, 2026)". https://metr.org/time-horizons/ [read]
  - METR's 22 September 2026 evaluation of Claude Opus 5.5 reports no time horizon. It used five bespoke long tasks, including NanoGPT speedrun and research writing, plus trend data. https://metr.org/blog/2026-09-22-claude-opus-5-5/ [read]
  - MirrorCode (April 2026): agents completed some weeks-long tasks, including reimplementing a 16,000-line codebase. [read, index entry only]
- **Community reading.** LessWrong "Now 10x/Year" (13 February 2026) reads TH1.1 as about 3.5-month doubling for 2024–25 models, with commenters suspecting noise inflates the 50% estimates and noting that the 80% trend is closer to the old slope. https://www.lesswrong.com/posts/EYb2K9acKfyG2bome/metr-time-horizons-now-10x-year [read]
- **Answer to the "~7 months" claim [inference].** "Every ~7 months" is the 2019–2025 long-run figure. Since 2024 METR's own TH1.1 estimate is about 3 months (88.6 days); since 2023 it is about 4.3 months. By September 2026 the metric had saturated its own suite at about 16h (50%), and METR stopped updating it. The 80% horizon, roughly 3h at the frontier, is the more relevant figure for unattended merges.

### H. Multi-agent coordination failures

**H1. MAST, "Why Do Multi-Agent LLM Systems Fail?"** Cemri, Pan, Yang et al. (Berkeley), arXiv 2503.13657 v3, 26 October 2025. https://arxiv.org/html/2503.13657v3 [read]
- 1,600+ annotated traces across 7 frameworks: MetaGPT, ChatDev, HyperAgent, AppWorld, AG2, Magentic-One and OpenManus. κ = 0.88.
- Failure rates of 41%–86.7% across the frameworks.
- 14 failure modes in 3 groups. Summing the individual shares gives: system design about 44.2% (step repetition 15.7%, not recognising termination 12.4%, disobeying the task specification 11.8%); inter-agent misalignment about 32.4% (reasoning–action mismatch 13.2%, task derailment 7.4%, not seeking clarification 6.8%); task verification about 23.5% (incorrect verification 9.1%, no or incomplete verification 8.2%, premature termination 6.2%).
- Interventions: ChatDev improved by +9.4% with better roles and termination, and by +15.6% with a high-level objective verification step.
- Quotes: "the presence of a verifier is not a silver bullet". Verifiers often only check that the code compiles.

**H2. CooperBench, "Why Coding Agents Cannot be Your Teammates Yet."** Khatua, Zhu, …, Diyi Yang; arXiv 2601.13295 v2, January 2026. https://arxiv.org/html/2601.13295 [read]
- 600+ tasks in 12 libraries across 4 languages. Two agents each implement a feature in the same repository.
- **About 30% lower success in cooperation than solo.** GPT-5 and Sonnet 4.5 reach about 25% cooperative, roughly half of solo. Pooled AUC retention is 0.59.
- **Success falls as agents are added: 68.6% with 2 agents, 46.5% with 3, 30.0% with 4** (46-task subset).
- 77.3% of tasks have conflicting ground-truth solutions. A first-turn plan message lowers the conflict rate from 51.5% to 29.4%, but **communication does not significantly improve final success** (−0.5 points on average). Up to about 20% of steps are spent communicating.
- Failure symptoms: work overlap 33.2%, divergent architecture 29.7%, repetition 14.7%, unresponsiveness 8.7%, unverifiable claims 4.3%, broken commitment 3.7%.
- Causes, from 50 traces: expectation 42%, commitment 32%, communication 26%.
- Successful trajectories mention line numbers and file paths more often (32.6 vs 22.5 line references).

**H3. Kim, Gu et al., "Towards a Science of Scaling Agent Systems."** arXiv 2512.08296 v3, 8 April 2026. [read]
- 260 configurations, five architectures, three model families.
- Multi-agent vs single-agent ranges from **+80.8% on decomposable financial reasoning to −70.0% on sequential planning**. Tool-heavy tasks pay a coordination overhead. Architectures without centralised verification propagate more errors.
- The paper predicts the best architecture for 87% of held-out configurations.

**H4. Practitioner positions.** [read]
- Cognition, "Don't Build Multi-Agents" (Walden Yan, 12 June 2025): share full traces, and remember that "actions carry implicit decisions". In the Flappy Bird example, parallel subagents diverge. The recommendation is a single-threaded linear agent, because multi-agent collaboration is "too fragile". https://cognition.com/blog/dont-build-multi-agents
- Anthropic, "multi-agent research system" (13 June 2025): +90.2% on an internal research eval. Agents use about 4x the tokens of chat and multi-agent systems about 15x; token usage explains 80% of BrowseComp variance. They say "most coding tasks involve fewer truly parallelizable tasks than research." https://www.anthropic.com/engineering/multi-agent-research-system

### I. N parallel attempts plus selection (best-of-N, verifiers)

- **Large Language Monkeys** (arXiv 2407.21787): SWE-bench Lite coverage rises from 15.9% to 56% as samples go from 1 to 250, against a 43% single-sample state of the art. Coverage scales log-linearly. Majority voting and reward models "plateau beyond several hundred samples". [read]
- **CodeMonkeys** (arXiv 2501.14723). https://arxiv.org/html/2501.14723 [read]
  - 10 parallel edit-and-test state machines per issue, with up to 8 iterations each.
  - **Oracle coverage 69.8%, selected 57.4%, random 45.8%.** Selection "recovers roughly half of the score gap between random and oracle".
  - Cost was $2,291.90 in total, with selection only 5.8% of it ($131.95) against 59.6% for generating edits.
  - An ensemble across other teams' submissions reached 80.8% coverage but only 66.2% selected.
- **R2E-Gym** (arXiv 2504.07164). https://arxiv.org/html/2504.07164 [read]
  - Execution-based verifier alone plateaus about 43.7%; execution-free (LLM judge) alone about 42.8%; **hybrid Best@26 51.0%** against an oracle Pass@26 of 64.4%.
  - Fewer than 20% of generated tests discriminate between candidates for most problems.
- **Trae Agent** (ByteDance, arXiv 2507.23370). https://arxiv.org/html/2507.23370 [read]
  - Pass@1 75.20% on SWE-bench Verified, first on the leaderboard in July 2025.
  - Oracle vs selected at N = 3: 66.2 vs 62.27 (Gemini 2.5 Pro), 70.0 vs 66.4 (Claude 3.7 Sonnet).
  - Baseline selectors "initially improve with larger ensemble sizes but subsequently degrade". Raising N "raises the theoretical upper bound … but also lowers the lower bound more sharply".
  - Pruning through deduplication and regression tests shrinks the candidate space by 28–39%.
- **S\*** (arXiv 2502.14382): hybrid parallel and sequential scaling, with selection by pairwise comparison on synthesised distinguishing inputs. DeepSeek-R1-Distill-32B reaches 85.7% on LiveCodeBench, and a 3B model beats GPT-4o-mini. [read]
- **Anthropic, Claude 4 launch** (May 2025): SWE-bench Verified rises from 72.5% to 79.4% for Opus 4 and from 72.7% to 80.2% for Sonnet 4 with "parallel test-time compute". The method samples several attempts, **discards patches that break visible regression tests**, and lets an internal scoring model pick. https://www.anthropic.com/news/claude-4 [read]
- **SWE-Lancer pass@k:** six extra attempts nearly triple o1's solve rate. GPT-4o at pass@6 equals o1 at pass@1. [read]

---

## Pain points for agentic-scale development

1. **Review capacity is the binding constraint, and it fails silently.** 38% of rejected agent PRs were simply abandoned or never reviewed, and 33% of rejections have no visible rationale. 64% of rejected Claude Code PRs were closed without a comment. Faros finds review time up 91% as PR count rises 98%. [read]
2. **There is no good signal on why a change died.** Closed-without-comment is the modal outcome for rejection, so neither agents nor organisations can learn from it. [read]
3. **Duplicate and superseded work.** 23% of rejections in Ehsani et al. are duplicate PRs. Workflow causes (superseded, duplicate, inactive) are 31% of rejections in Peralta et al. When many agents work concurrently on the same backlog, they redo each other's work. [read]
4. **Concurrent agent PRs conflict.** About 80% of agent PRs are co-active with another agent PR. 20% (same agent) to 42% (cross-agent) of co-active pairs textually conflict, and 27.7% of agent PRs conflict with their base. These are lower bounds that ignore semantic and build breakage. [read]
5. **Conflict rate grows with PR size**, from about 10% to about 30% between 2 and 25 lines of churn. Larger PRs are also merged less. [read]
6. **CI failure is the strongest negative predictor** of merge (−15% odds per failed check). Agent PRs fail CI in ways that, in human workflows, would get fixed before the PR is opened. [read]
7. **Agents are bad at iterative refinement.** Merges are bimodal: instant (28.3%) or a struggle, with "frequent failure in iterative refinement" and ghosting after feedback. [read]
8. **Tests are a weak proof.** Agent PRs that pass tests are still not mergeable in METR's sample. More than 59% of failed SWE-bench Verified problems had flawed tests [secondary]. Fewer than 20% of generated tests discriminate between candidates [read], and frontier agents deliberately exploit hidden tests (GPT-5.6 Sol). [read]
9. **Maintainability debt.** Duplication rose 81%, refactoring collapsed to 3.8% of changed lines, and agents skip reuse while reviewers rate their PRs positively. Agents have high breaking-change rates in maintenance tasks such as chores (9.35%). [read]
10. **Attribution is unreliable.** Codex leaves no agent marker and Claude's co-author trailer can be disabled. Every dataset relies on heuristics, and organisations cannot easily measure their own agent share. [read]
11. **Review bots add noise.** 12 of 13 review agents have signal ratios below 60%, and PRs reviewed only by a review agent merge 23 points less often. [read]
12. **Multi-agent coordination costs more than it gains on sequential coding tasks**: −30% (CooperBench), down to −70% on sequential planning, and success falls steeply as agents are added. [read]
13. **Selection among parallel attempts recovers only part of the available gain.** The gap between oracle and selected is 4–14 points at SWE-bench scale, and naive selectors get worse as N grows. [read]

## How orgs and researchers are solving them

- **Auto-merge trusted lanes.** Repositories either auto-merge all agent PRs or none. Auto-merged PRs are small and focused, and maintainers hold back on PRs that delete code. [read] In effect, path and size-based policy is being applied informally.
- **Triage before review.** Static predictors of review effort reach AUC 0.96 using patch size and file types, catching 69% of high-effort PRs with a 20% review budget. [read]
- **Rejection sampling on visible tests plus a learned selector.** Anthropic's high-compute setting discards patches that break regression tests and then scores the rest; R2E-Gym and CodeMonkeys do the same with hybrid verifiers. [read]
- **Plan-first coordination.** In CooperBench, a first-turn plan message nearly halves conflicts (51.5% → 29.4%), and specific file and line references correlate with success. [read]
- **Centralised verification.** Google's scaling study and MAST both find that a central verifier or top-level objective check limits error propagation (MAST: +15.6% on ChatDev). [read]
- **A single linear agent by default.** Cognition's position is to avoid multi-agent setups for coding, and Anthropic says coding parallelises less well than research. [read]
- **Smaller PRs.** Every paper that measured size ties it to fewer conflicts and more merges. [read]
- **Recommendations from the conflict paper:** orchestration, live protocols between agents, and merge-replay with sandboxed runtimes. [read]

## Implications for a future forge

These are design inferences from the data above. All are tagged [inference].

1. **Make "why it died" a required, structured field.** A third of rejections have no rationale and 38% are abandonment. A thread-native forge should record a closure reason (superseded by thread X, duplicate, failed proof, policy, abandoned) and feed it back to the originating thread. This answers the brief's "code can answer why" for failures as well as successes.
2. **Duplicate and overlap detection at creation time is high-value.** A quarter of rejections are duplicates, and about 80% of agent PRs overlap in time. The brief's idea 6 (agents see each other early, with declared file and symbol intents) is directly supported. A plan message cuts conflicts by about 40% in CooperBench, so declared intent is effectively a forge-level plan message.
3. **Landing as a service is justified by measured conflict rates.** With 20–42% pairwise conflict among co-active agent PRs and 27.7% conflict against base, the "agent rebases and retries" loop costs a lot of CI time and tokens. A landing service that replays merges (`git merge-tree`), predicts conflicts and hands the loser the winner's intent (brief idea 2) addresses the most frequent integration failure.
4. **Proof must be tamper-resistant and independently produced.** METR's GPT-5.6 Sol cheating, flawed SWE-bench tests, discriminative tests under 20%, and PRs that pass tests yet are 0/15 mergeable all show that "agent-attached evidence" alone is gameable. The brief's "separate proof agent" should be a requirement. Evidence should run in a forge-owned sandbox the authoring agent cannot write to, and hidden or held-out checks should be part of policy.
5. **Proof also needs non-functional checks.** METR's mergeability gaps were test coverage, documentation and lint, and GitClear and CodeRabbit flag duplication, readability and error masking. A proof policy that only runs functional tests will merge maintainability debt. Duplication and reuse checks, plus a "no deletion without a reason" rule, belong in the policy engine.
6. **Path and size-based merge policy matches observed behaviour.** Docs and CI PRs merge at 79–84%, fixes at 64% and performance work at 55%; maintenance tasks carry higher breaking-change rates; repositories already run binary auto-merge regimes. The brief's per-path proof bar (idea 3) formalises practice that already exists. Size limits for auto-landing should be part of it.
7. **Parallel attempts plus a selector are a first-class forge feature.** Best-of-N gives +7–8 points at SWE-bench scale for modest cost, with selection only about 6% of spend. Selection is the weak link, and naive selectors get worse as N grows. A forge can own selection: run N threads per task, prune by visible tests and deduplication, then run differential tests between candidates (S\*-style distinguishing inputs) and an LLM judge. That makes "compare several changes and decide which ships" (from Cloudflare's brief) concrete. The forge should record the oracle-vs-selected gap as a metric.
8. **Do not assume more agents on one task helps.** CooperBench shows success falling from 68.6% with 2 agents to 30% with 4 on shared tasks. The forge should favour one thread per independent task with isolated environments, and use parallelism across tasks or as N-way alternatives rather than splitting one task across collaborating agents.
9. **Attribution should be built into the forge, not inferred.** Datasets depend on trailers that Codex omits and Claude lets users disable. A forge where every landed commit points to its thread, agent, model and human sponsor (brief: "agents are principals") solves a measurement problem researchers currently cannot.
10. **Scale target.** About 1.2M or more detectable public agent PRs per month by early 2026, growing roughly 3x per four months between AIDev snapshots. Platform PR merges are up nearly 4x year on year according to GitHub's October 2026 post cited in the brief. The landing and evidence pipelines need to be designed for millions of change units per month per large host.
11. **Use the 80% horizon for autonomy policy.** At about 3h at 80% success versus 16h+ at 50%, unattended landing should be gated on task size and scope. Long threads need checkpoints with proof, not one proof at the end.

## Contradictions and pushback

- **Merge rates.** The "trust gap" result (AIDev paper: agents 38–65% vs humans 77%; Watanabe 84% vs 91%; Mazloomzadeh 64–68% vs about 85%) conflicts with the raw dataset cards (Claude Code 88% and Codex 86% merged, overall 80.9%). The difference comes from sample frame: popular repositories with human review versus everything, including personal repositories where the author self-merges. Codex PRs are attributed to the human and are the most often auto-merged. Different subsets also rank agents differently: Claude Code is 52.5% in the AIDev paper, 59% in Ehsani and 84.3% in Mazloomzadeh. [inference from read sources]
- **Defects.** The academic AIDev studies find "comparable or lower defect proneness" (Mazloomzadeh) and fewer breaking changes overall (Ferdous: 3.45% vs 7.40%). Industry reports find 1.7x issues (CodeRabbit), 41% more bugs (Uplevel), +9% bugs per developer (Faros) and +81% duplication (GitClear). The industry reports are mostly vendor-authored, use weak attribution and in Uplevel's case date from the 2023–24 Copilot era. The academic ones measure narrow outcomes such as reverts and breaking changes on small, simple agent PRs. Neither settles the question. [inference]
- **Does merge outcome measure agent quality at all?** Peralta et al. argue no: only 35.7% of rejections are agent failures. That cuts against merge-rate leaderboards and against using merge rate as a forge KPI. [read]
- **Time horizon speed.** The "~7 months" figure is outdated. TH1.1 gives about 3–4 months, but METR's own caveats (task-composition sensitivity, 5 human baselines for 8h+ tasks, saturation above 16h, cheating) make the recent fast estimates fragile. LessWrong commenters note the 80% trend is closer to the old slope. [read]
- **The value of multi-agent setups depends on the task.** Anthropic reports +90% for research and Google +81% on decomposable tasks, against −30% (CooperBench) and −70% on sequential planning. For coding inside one repository, the evidence leans negative. [read]
- **Review bots.** CodeRabbit's report says AI review catches more issues, while the MSR'26 study finds review-agent-only PRs merge 23 points less and most review agents are below 60% signal. CodeRabbit is a vendor in both roles. [read]
- **The OpenAI SWE-bench figure.** "59.4% of tasks flawed" (The Decoder) and "59.4% of an audited subset of often-failed problems" (search summary of OpenAI's page) are different claims. I could not open OpenAI's page (403). [secondary]
- **Brief cross-check.** The brief's claim that agent-heavy development moves the bottleneck to verification, review and landing is **supported**: 38% of rejections are unreviewed or abandoned, review time is up 91% (Faros), CI failure is the top predictor, and conflicts are frequent. Its implicit claim that proof can replace diff-reading is **partly supported with a strong caveat**: tests and agent-generated proof are demonstrably gameable or insufficient (METR 0/15 mergeable, GPT-5.6 Sol cheating), so proof has to be independent and broader than tests. Its idea 6 (early overlap visibility) is **supported** by CooperBench's plan-message result and the concurrency paper's call for "live communication protocols". [inference]

## Open questions

- What is the human-PR baseline revert rate in the same repositories? The "When AI Code Doesn't Stick" abstract gives none, so whether 2.66% is high or low is unknown.
- What do the AIDev v5 numbers look like with self-merges in personal repositories excluded? Nobody has published a v5 analysis of popular repositories yet, as far as I could find.
- What are the 2026 SWE-Lancer results and the current Terminal-Bench (3.0 or 4.0) top scores from the official leaderboard? The search budget was exhausted, and the official tbench page rendered empty.
- Has METR published a successor to time horizons (an "expenditure horizon", MirrorCode-based measures, or a Time Horizon 2.0)? The EA Forum "TH 2.0" post appears to be third-party.
- Are there semantic or build conflict rates for co-active agent PRs, beyond textual ones? Xu et al. call their figures lower bounds and propose sandboxed replay.
- Has a study measured whether instruction files (AGENTS.md) improve merge rates? "Toward Instructions-as-Code" is an MSR'26 challenge paper with no preprint link found.
- How large is the private, enterprise agent PR volume? Octoverse gives only Copilot coding agent's 1M+ PRs (May–September 2025), and GitHub's October 2026 post (in the brief) gives platform totals but, as far as I know, no agent split.
- What do the full CodeRabbit whitepaper and DORA report say about methodology? Both were gated or image-only.

## Sources (pages opened)

| # | Title | URL | Date |
|---|---|---|---|
| 1 | The Rise of AI Teammates in SE 3.0 (abstract) | https://arxiv.org/abs/2507.15003 | 2025-07-20 |
| 2 | Same paper, HTML full text | https://arxiv.org/html/2507.15003 | 2025-07-20 |
| 3 | AIDev GitHub README (SAILResearch/AI_Teammates_in_SE3) | https://github.com/SAILResearch/AI_Teammates_in_SE3 | refreshed 2025-08-10 |
| 4 | AIDev dataset card v4 (AIDev-2.7M) | https://huggingface.co/datasets/hao-li/AIDev | cutoff 2025-11 |
| 5 | AIDev-7.6M dataset card (v5) | https://huggingface.co/datasets/hao-li/AIDev-7.6M | cutoff 2026-03-31 |
| 6 | AI Agent PRs on GitHub: Frequency, Structure, and Merge Conflict Rates | https://arxiv.org/html/2607.04697v1 | 2026-07-06 |
| 7 | AgenticFlict | https://arxiv.org/html/2604.03551 | v2 2026-05-12 |
| 8 | How Do AI Coding Agents Contribute… (abstract) | https://arxiv.org/abs/2607.21832 | 2026-07-23 |
| 9 | Same paper, HTML | https://arxiv.org/html/2607.21832 | 2026-07-23 |
| 10 | Why Are Agentic PRs Merged or Rejected? (PDF, extracted locally) | https://arxiv.org/pdf/2605.22534 | 2026-05-21 |
| 11 | How AI Coding Agents Modify Code | https://arxiv.org/html/2601.17581 | v3 2026-04-06 |
| 12 | Where Do AI Coding Agents Fail? | https://arxiv.org/html/2601.15195v1 | 2026-01-21 |
| 13 | On the Use of Agentic Coding (Claude Code PRs) | https://arxiv.org/html/2509.14745v3 | 2026-02-09 |
| 14 | Octoverse 2025 | https://github.blog/news-insights/octoverse/octoverse-a-new-developer-joins-github-every-second-as-ai-leads-typescript-to-1/ | 2025-10-28, updated 2026-02-28 |
| 15 | CodeRabbit State of AI vs Human Code Generation | https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report | 2025-12-17 |
| 16 | GitClear, The Maintainability Gap (2026) | https://www.gitclear.com/the_ai_code_quality_maintainability_gap | 2026 (undated) |
| 17 | GitClear AI Code Quality 2025 research | https://www.gitclear.com/ai_assistant_code_quality_2025_research | 2025 |
| 18 | Uplevel, AI for developer productivity | https://uplevelteam.com/blog/ai-for-developer-productivity | 2024-10-18, updated 2026-07-21 |
| 19 | Faros AI, AI Productivity Paradox | https://www.faros.ai/blog/ai-software-engineering | 2025-07-23 |
| 20 | DORA 2025 report page | https://dora.dev/research/2025/dora-report/ | 2025 |
| 21 | Google Cloud, announcing the 2025 DORA report | https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report | 2025-09-23 |
| 22 | METR Time Horizons page | https://metr.org/time-horizons/ | not updated after 2026-09-08 |
| 23 | METR Time Horizon 1.1 | https://metr.org/blog/2026-1-29-time-horizon-1-1/ | 2026-01-29 |
| 24 | LessWrong, METR Time Horizons: Now 10x/Year | https://www.lesswrong.com/posts/EYb2K9acKfyG2bome/metr-time-horizons-now-10x-year | 2026-02-13 |
| 25 | Wikipedia, METR | https://en.wikipedia.org/wiki/METR | accessed 2026-10-12 |
| 26 | METR research index | https://metr.org/research/ | accessed 2026-10-12 |
| 27 | METR blog index | https://metr.org/blog/ | accessed 2026-10-12 |
| 28 | METR, Claude Opus 5.5 evaluation summary | https://metr.org/blog/2026-09-22-claude-opus-5-5/ | 2026-09-22 |
| 29 | METR, GPT-5.6 Sol evaluation summary | https://metr.org/blog/2026-06-26-gpt-5-6-sol/ | 2026-06-26 |
| 30 | METR, reconciling slowdown with time horizons | https://metr.org/blog/2025-08-12-research-update-towards-reconciling-slowdown-with-time-horizons/ | 2025-08-13 |
| 31 | METR, early-2025 AI experienced OSS developer RCT | https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ | 2025-07-10 |
| 32 | MAST, Why Do Multi-Agent LLM Systems Fail? (abstract) | https://arxiv.org/abs/2503.13657 | v3 2025-10-26 |
| 33 | Same paper, HTML | https://arxiv.org/html/2503.13657v3 | v3 2025-10-26 |
| 34 | Vals.ai SWE-bench Verified | https://www.vals.ai/benchmarks/swebench | as of 2026-09-01 |
| 35 | The Decoder on OpenAI retiring SWE-bench Verified | https://the-decoder.com/openai-wants-to-retire-the-ai-coding-benchmark-that-everyone-has-been-competing-on/ | 2026-02-23 |
| 36 | OpenAI, why we no longer evaluate SWE-bench Verified (returned 403) | https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ | 2026-02-23 |
| 37 | Scale SWE-bench Pro public leaderboard | https://labs.scale.com/leaderboard/swe_bench_pro_public | accessed 2026-10-12 |
| 38 | BenchLM Terminal-Bench 2.0 | https://benchlm.ai/benchmarks/terminal-bench-2 | updated 2026-10-10 |
| 39 | tbench.ai leaderboard (rendered empty) | https://www.tbench.ai/leaderboard/terminal-bench/2.0 | accessed 2026-10-12 |
| 40 | SWE-Lancer (abstract) | https://arxiv.org/abs/2502.12115 | v4 2025-05-29 |
| 41 | SWE-Lancer, HTML | https://arxiv.org/html/2502.12115 | v4 2025-05-29 |
| 42 | CodeMonkeys (abstract) | https://arxiv.org/abs/2501.14723 | 2025-01 |
| 43 | CodeMonkeys, HTML | https://arxiv.org/html/2501.14723 | 2025-01 |
| 44 | Large Language Monkeys | https://arxiv.org/abs/2407.21787 | 2024-07 |
| 45 | S\* test-time scaling for code | https://arxiv.org/abs/2502.14382 | 2025-02-20 |
| 46 | R2E-Gym (abstract) | https://arxiv.org/abs/2504.07164 | 2025-04-09 |
| 47 | R2E-Gym, HTML | https://arxiv.org/html/2504.07164 | 2025-04-09 |
| 48 | Trae Agent (abstract) | https://arxiv.org/abs/2507.23370 | 2025-07-31 |
| 49 | Trae Agent, HTML | https://arxiv.org/html/2507.23370 | 2025-07-31 |
| 50 | Anthropic, Introducing Claude 4 | https://www.anthropic.com/news/claude-4 | 2025-05 |
| 51 | Anthropic, multi-agent research system | https://www.anthropic.com/engineering/multi-agent-research-system | 2025-06-13 |
| 52 | Cognition, Don't Build Multi-Agents | https://cognition.com/blog/dont-build-multi-agents | 2025-06-12 |
| 53 | CooperBench (abstract) | https://arxiv.org/abs/2601.13295 | v2 2026-01-26 |
| 54 | CooperBench, HTML | https://arxiv.org/html/2601.13295 | v2 2026-01-26 |
| 55 | Towards a Science of Scaling Agent Systems | https://arxiv.org/abs/2512.08296 | v3 2026-04-08 |
| 56 | MSR 2026 Mining Challenge programme | https://2026.msrconf.org/track/msr-2026-mining-challenge | 2026-04 |
| 57 | When AI Code Doesn't Stick (MSR details page) | https://2026.msrconf.org/details/msr-2026-mining-challenge/27/When-AI-Code-Doesn-t-Stick-An-Empirical-Study-on-Reverted-Changes-Introduced-by-AI-C | 2026-04 |
| 58 | LGTM! Auto-merged agentic PRs (PDF, extracted locally) | https://pcanelas.com/assets/papers/2026-msr-lgtm.pdf | 2026-04 |
| 59 | Safer Builders, Risky Maintainers | https://arxiv.org/abs/2603.27524 | 2026-03-29 |
| 60 | Early-Stage Prediction of Review Effort (abstract) | https://arxiv.org/abs/2601.00753 | v2 2026-01-27 |
| 61 | Same paper, HTML | https://arxiv.org/html/2601.00753 | v2 2026-01-27 |
| 62 | More Code, Less Reuse | https://arxiv.org/abs/2601.21276 | 2026-01-29 |
| 63 | The Quiet Contributions (silent PRs) | https://arxiv.org/abs/2601.21102 | 2026-01-28 |
| 64 | From Industry Claims to Empirical Reality (review agents) | https://arxiv.org/abs/2604.03196 | 2026-04-03 |
| 65 | An Empirical Study of Tests in Agentic PRs | https://arxiv.org/abs/2601.03556 | 2026-01-07 |
| 66 | When AI Agents Touch CI/CD Configurations | https://arxiv.org/abs/2601.17413 | 2026-01-24 |

Search-result-only and secondary sources (not opened, or used only for cross-checks): Snorkel and LLM-Stats Terminal-Bench pages; Morph SWE-bench Pro aggregator (returned 429); The Register on CodeRabbit; CIO, DevOps.com and Computing on Uplevel; datalearner and benchmarklist METR aggregators; EA Forum "METR Time Horizon 2.0".

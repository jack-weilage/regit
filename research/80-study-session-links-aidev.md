# 80 — Do session links in agent PRs change merge outcomes? An AIDev study

*Empirical note, 2026-10-12. Data: AIDev v4 (Hugging Face `hao-li/AIDev`, revision `7840b6e`, last modified 2026-10-09). Scripts and outputs: `scratchpad/research/aidev-study/` (`analysis.py`, `addendum.py`, `full_scan.py`, `out/*.csv`, `out/addendum.txt`, `out/full_scan.txt`).*

## Question

When an agent-authored PR links to its agent session (task, thread or transcript), do reviewers merge it more often or faster?

**Short answer:** In this data there is no evidence that the link helps once you compare like with like. The raw gaps are large but point in opposite directions for different agents. They come from *how* the PR was produced, not from the link. Among PRs that a human other than the author actually reviewed, the merge-rate difference is close to zero (pooled within-repo: −2.7 pp, 95% CI −6.3 to +0.9). Linked PRs merge about 2× faster within the same repo, but that gap disappears once commit count is controlled for (ratio 0.86, CI 0.67–1.09).

## Data

- **Primary: AIDev-pop** (repos with more than 100 stars). The tables used were `pull_request.parquet` (71,677 PRs in 6,673 repos, created 2024-12-24 to 2025-10-24), `pr_reviews.parquet` (83,816 reviews), `pr_commits.parquet` (220,883 commits with messages) and `repository.parquet` (stars, `full_name`). 65,745 PRs are closed and 5,932 are open. Open PRs are excluded from every outcome.
- **Robustness: full AIDev.** `all_pull_request.parquet` (2,743,854 PRs, 2,451,452 closed) plus `all_repository.parquet`, streamed in full with no sampling. This table has no reviews, so it supports only the merge-rate checks.
- Agents are Codex, Copilot, Cursor, Devin, Jules and Claude Code. **Amp is not in AIDev.** The dataset has no `merged_by` field, so self-merges cannot be identified directly (proxies are below).

## Method

**1. Link detection (PR body; commit messages checked as well).** Regexes:

| link type | pattern |
|---|---|
| codex_task / codex_share | `chatgpt.com/codex/tasks/task_` / `chatgpt.com/s/cd_` |
| cursor_agent | `cursor.com/background-agent?bcId=` or `cursor.com/agents?id=` |
| devin_session | `app.devin.ai/sessions/<hex>` |
| jules_task | `jules.google.com/task/<n>` |
| claude_session | `claude.ai/code/session_` or `Claude-Session:` |
| amp_thread | `ampcode.com/threads/` or `Amp-Thread` |
| copilot_session | `/agent-sessions/` or `github.com/copilot/tasks/` |
| *attribution, kept separate* | `Generated with [Claude Code]`, `Co-Authored-By: Claude` |

I checked 5 random matches per type plus host/path tallies of every URL (`out/link_samples.json`). All matches were the agent's own footer or badge, except the two Copilot `agent-sessions` hits, which a human had typed into the prose.

Every `claude.ai/code` URL in Claude Code PRs (1,135) is the bare product link in the "Generated with [Claude Code]" footer, not a session.

**2. Outcomes (closed PRs only):**
- merged (has `merged_at`);
- time-to-merge (TTM) in hours;
- time-to-close for closed-but-unmerged PRs.

**3. Comparisons.** I compared linked and unlinked PRs:
- overall and within each agent;
- only in each agent's **template era**, i.e. the months when the agent's default PR text already contained the link (Codex from 2025-06, Cursor from 2025-07, Jules from 2025-09, Devin all months);
- in these subsets:
  - (a) PRs with ≥1 review by a non-bot user who is not the PR author. 91% of such PRs have a review submitted before merge or close.
  - (b) PRs whose author is not the repo owner, a proxy that excludes owners merging in their own repos.
  - (c) all PRs except those from the single largest Codex user (13,194 closed PRs).

**4. Statistics.**
- Merge rates: Wilson 95% CIs.
- Differences in merge rate and in median times: **repo-cluster bootstrap** (400 resamples).
- Logistic regressions with agent and month fixed effects, log stars, log body length (URLs stripped) and author-is-owner, with repo-clustered SEs.
- Linear probability models with **repo×agent fixed effects**, which compare linked and unlinked PRs of the same agent in the same repo. These have month FE and repo-clustered SEs.
- OLS on log TTM, with and without log(number of commits).

## Results

### 1. Link prevalence (AIDev-pop, PR body)

| agent | PRs | session link in body | link type | notes |
|---|---:|---:|---|---|
| OpenAI Codex | 35,521 | 29,730 (84%) | codex_task 29,708; codex_share 23 | 4,270 of the 4,463 May-2025 PRs have no link (template not yet in place) |
| Devin | 6,172 | 6,002 (97%) | devin_session | 43 also in commits |
| Cursor | 4,059 | 2,295 (57%) | cursor_agent | link only from Jul 2025, on background-agent PRs |
| Google Jules | 487 | 211 (43%) | jules_task | link only from Sep 2025 |
| Claude Code | 1,942 | **0** | — | attribution only: 1,942 `Co-Authored-By: Claude`, 1,708 `Generated with [Claude Code]` |
| Copilot | 23,496 | 2 | copilot_session (human prose) | Copilot shows the session in GitHub's PR UI, not in the body |
| Amp / Claude-Session | — | 0 / 0 | — | 2 PRs have an `Amp-Thread` trailer in a commit |

Commit messages add only 9 PRs. The full 2.7M dataset matches:
- Codex: 1.97M of 2.07M PRs linked;
- Devin: 42.4k of 43.3k;
- Cursor: 170k of 213k;
- Jules: 27.7k of 50.5k;
- **Claude Code: 0 `claude_session` links in 18,232 PRs** (data cutoff is before such links existed);
- Copilot: 8.

In practice, **link presence is a property of the agent product and its template version**, not a choice the PR author makes.

### 2. Raw within-agent comparison (template era, closed PRs)

| agent | n link / no-link | merge rate link | merge rate no-link | diff, pp [cluster-boot 95% CI] | median TTM h (link / no-link) |
|---|---|---|---|---|---|
| Codex | 28,648 / 1,377 | 0.869 [.865,.873] | 0.684 [.659,.708] | **+18.5 [+9.5, +25.1]** | 0.02 / 2.28 |
| Cursor | 1,963 / 1,127 | 0.504 [.482,.526] | 0.703 [.675,.729] | **−19.9 [−25.8, −14.3]** | 1.56 / 0.97 |
| Devin | 5,836 / 168 | 0.565 [.552,.577] | 0.619 [.544,.689] | −5.4 [−13.9, +8.4] | 2.23 / 18.65 |
| Jules | 173 / 18 | 0.798 [.732,.851] | 0.722 [.491,.875] | +7.5 [−13.4, +53.8] | 0.83 / 0.03 |
| All agents pooled (confounded) | 36,815 / 28,930 | 0.801 | 0.655 | +14.6 [+5.0, +19.7] | 0.03 / 2.62 |

Sensitivity checks:
- Codex, author ≠ repo owner: +24.1 [+8.3, +32.3].
- Codex without its largest user: +15.2 [+7.5, +23.1].
- Cursor, author ≠ owner: −18.3 [−25.7, −10.7].

The raw sign therefore flips between agents.

### 3. Why: the link marks a workflow

Self-merge proxy (merged within 5 minutes of creation) and human-review rate, by link status, for template-era closed PRs:

| agent | merged ≤5 min, link / no-link | non-author human review, link / no-link |
|---|---|---|
| Codex | **69.1% / 23.6%** | **2.6% / 27.6%** |
| Cursor | 17.6% / 21.8% | 13.0% / 25.3% |
| Devin | 10.1% / 2.9% | 37.0% / 54.8% |

What the two groups look like:
- **Linked Codex PRs** are the push-button flow: the template "## Summary / ## Testing / link" (99.3% of them), opened and usually merged by the same person within about a minute.
- **Unlinked Codex PRs** were edited or opened by hand. 22% have an empty body, only 33% keep the template, and they are 10× more likely to get a human review.
- **Linked Cursor PRs** are background-agent PRs; unlinked ones are mostly human-opened, IDE-assisted PRs.

### 4. Like-for-like: PRs reviewed by a human other than the author (AIDev-pop)

| agent | n link / no-link | merge link | merge no-link | diff, pp [95% CI] | median TTM h (link / no-link), diff [CI] |
|---|---|---|---|---|---|
| Codex | 759 / 380 | 0.883 | 0.911 | −2.8 [−8.2, +2.7] | 17.2 / 27.5; −10.3 [−24.0, −1.0] |
| Cursor | 256 / 285 | 0.922 | 0.891 | +3.1 [−2.7, +9.0] | 21.6 / 22.3; −0.7 [−6.8, +7.5] |
| Devin | 2,159 / 92 | 0.848 | 0.902 | −5.4 [−12.8, +0.4] | 4.1 / 23.8; −19.6 [−76.9, −10.3] |
| Jules | 70 / 8 | — | — | too few | — |

### 5. Models

| model | N | effect of link [95% CI] |
|---|---:|---|
| Logit, 4 agents, agent+month FE, stars, body length, owner | 39,310 | OR 1.03 [0.82, 1.30] |
| …same + human-review indicator | 39,310 | OR 1.43 [1.10, 1.85] |
| …human-reviewed PRs only | 4,009 | OR 0.84 [0.58, 1.20] |
| Logit, Codex only / Cursor only / Devin only / Jules only | 30,025 / 3,090 / 6,004 / 191 | OR 1.66 [1.15, 2.41] / 0.46 [0.32, 0.67] / 1.12 [0.52, 2.40] / 1.35 [0.40, 4.60] |
| **LPM, repo×agent FE (same repo, same agent)**, all | 24,975 (379 groups) | **−15.9 pp [−20.0, −11.8]** |
| ……Codex / Cursor / Devin | 18,859 / 2,170 / 3,928 | −12.9 [−19.8, −5.9] / −21.7 [−30.3, −13.1] / −2.0 [−11.4, +7.4] |
| **LPM, repo×agent FE, human-reviewed only** | 2,286 (112 groups) | **−2.7 pp [−6.3, +0.9]** |
| Full AIDev (2.45M closed), within-repo LPM: Codex / Cursor / Devin / Jules | 395k / 82k / 11k / 5.8k | −1.1 [−3.8, +1.6] / −7.9 [−9.6, −6.2] / −1.0 [−5.7, +3.8] / −1.0 [−2.9, +1.0] |
| Time-to-merge ratio, pooled OLS (merged PRs) | 31,176 | 0.18 [0.13, 0.25] |
| TTM ratio, repo×agent FE, all merged / human-reviewed merged | 19,072 / 1,991 | 0.50 [0.32, 0.78] / 0.46 [0.35, 0.63] |
| **TTM ratio, repo×agent FE + log(#commits), all / human-reviewed** | 19,072 / 1,991 | **1.07 [0.72, 1.61] / 0.86 [0.67, 1.09]** |

The Codex effect is positive across repos (OR 1.66) but negative within repos (−12.9 pp); a sign that flips with the design is measuring selection. Speed follows the same pattern. Linked PRs have fewer commits (median 1 vs 2 for Codex, 2 vs 3 for Cursor and Devin), and once commit count is controlled for, the speed advantage is gone.

## Caveats (what this can and cannot say)

1. **The link is not randomly assigned.** Codex, Devin, Jules (from Sep 2025) and Cursor background agents (from Jul 2025) insert it by default. "No link" usually means a hand-rewritten description, a hand-opened PR, an older template or another product mode, each of which changes review on its own. No estimate here is causal.
2. **The link is close to collinear with agent and era.** It is 97% of Devin PRs and 0% of Claude Code and Copilot PRs. Pooled comparisons mostly compare agents. Jules's no-link group in its template era has only 18 PRs.
3. **Self-merge is only approximated.** There is no `merged_by`. The proxies (author = repo owner, merged within 5 minutes, non-author review) are imperfect. Bot-authored PRs (Copilot, Devin, Jules) hide who triggered them.
4. **"Human reviewed" is a post-treatment filter.** Whether someone reviews may itself depend on the link. It is still the closest available proxy for "a reviewer saw it". 9% of such PRs have reviews only after merge or close.
5. **Commit count is partly a mediator.** Review rounds add commits, so controlling for it may absorb a real speed effect. The uncontrolled within-repo ratio (0.46–0.50) is an upper bound on any speed benefit, and that bound is itself confounded.
6. **Exposure is unmeasured.** We cannot tell whether reviewers clicked the link, and most sessions (Codex, Devin, Jules) are private to the requester, so a reviewer often *cannot* open them.
7. **The newest formats are missing.** Coverage ends in Oct 2025. There are no Claude Code session URLs or `Claude-Session` trailers, no Amp `Amp-Thread` (Amp is not in AIDev), and no Copilot session links in bodies. The results cannot speak to public or shareable transcripts.
8. **Scope.** Primary data covers only repos with >100 stars; the full-data check has no reviews. One user accounts for 13.2k Codex PRs; results without them are similar.

## Conclusion

In 71,677 agent-authored PRs from popular GitHub repos (AIDev-pop, Dec 2024–Oct 2025), backed by 2.74M PRs across all of AIDev, a session link in the PR body does not reliably predict being merged more often or faster once you account for how the PR was produced. Raw within-agent differences are large but have opposite signs: Codex +18.5 pp, Cursor −19.9 pp. They reflect workflow selection: linked Codex PRs are mostly push-button self-merges (69% merged within 5 minutes; 2.6% reviewed by someone else), while unlinked ones were curated by hand. Comparing within the same repo and agent, linked PRs merge *less* often in AIDev-pop (−15.9 pp). In the full data the within-repo effect is null for Codex, Devin and Jules (about −1 pp each, CIs including 0) and −7.9 pp for Cursor. Among PRs that a non-author human reviewed, it is null (−2.7 pp, CI −6.3 to +0.9). Linked PRs do merge about 2× faster within repo, but that difference disappears after controlling for commit count (ratio 0.86, CI 0.67–1.09). So the honest finding is "no detectable reviewer benefit from today's session links", with three limits: the links are mostly private, they are inserted automatically, and nobody measured whether reviewers opened them. That leaves room for a real effect from *readable, reviewer-facing* transcripts. Testing that needs data this dataset does not yet contain: public Claude Code or Amp thread links, or forge telemetry on whether reviewers open the link. A within-repo design, or a randomized one, would be the right way to run that test.

# 07: Monorepo CI and merging at scale (prior art for keeping trunk green at high throughput)

Researcher key: `07-monorepo-ci-merge-at-scale`. Written 2026-10-12.

Tags: **[read]** means I opened the page and read the claim there. **[secondary]** means it came from coverage, a vendor summarising someone else, or a search snippet. **[inference]** means it is my own reasoning.

Method note: the shared web-search budget ran out partway through, so later sources were reached by fetching known URLs directly. The CACM Google monorepo article returned 403 from every mirror I tried. Its figures below are therefore marked [secondary], except where the TAP paper (which I did read) repeats them.

---

## Summary

1. **Two schools have kept trunk usable at scale, and they diverge at exactly the point agents push on.** The strict school ("not rocket science": Bors, Zuul, GitLab merge trains, GitHub merge queue, Uber SubmitQueue, Shopify) never lets main move to an untested state. The optimistic school (Google TAP, Meta land-time testing, Chromium CQ) runs a cheaper gate before submit, then runs the full suite after submit and finds the culprit and reverts. The only system with published volume near agent scale, Google at more than 50,000 changes a day, belongs to the optimistic school. [read]
2. **Google already met "agent-scale" volume a decade ago and chose not to run every test before submit.** TAP sees "a code commit every second on the average" and said testing each commit "was growing quadratically" in compute. It responded by cutting "milestones" about every 45 minutes at peak and running affected tests per milestone, not per change. [read] Per the CACM article, automated systems committed more changes than humans: about 24,000 a day against 16,000 in 2016. [secondary]
3. **Uber's SubmitQueue is the most developed strict design.** It builds a speculation tree, uses the build graph's target hashes to tell independent changes from conflicting ones, uses ML to predict which builds will succeed, and lets small changes "bypass" large ones (BLRD). The 2025 paper reports P95 wait down 31–45%, builds per change down 45–64%, and weekly CPU down 35–52%. Uber still describes the volume as "thousands of daily changes" per monorepo. [read]
4. **Speculation cost grows exponentially, and every strict queue caps it.** Uber says verifying all bypass paths "grows exponentially" and that speculation builds "double with each new conflicting change". Zuul starts with a window of 20, adds one on each success, and halves it on each failure. GitHub caps build concurrency at 1–100. GitLab defaults to 20 parallel train pipelines. [read]
5. **Meta's landing is literally a platform service.** Mononoke "pushrebase" rebases the pushed stack server-side onto the bookmark. It rejects only on file-path overlap with commits that landed since the stack's base, retries up to `MAX_REBASE_ATTEMPTS = 100`, and has a per-bookmark `PushrebaseQueue` that "Lands multiple indexed stacks in a single critical section pass" with one compare-and-swap. It also now attempts automatic three-way merge resolution for overlapping files. [read, source code on main]
6. **Meta openly says strict serialized land-time testing is infeasible.** "Due to the velocity of code changes, it is not feasible to serialize the process of land-time testing… changes… will be rebased onto the same version of master branch, tested in parallel and then serialized." Meta relies on a post-land "stabilization" stage to find green versions to release from. [read]
7. **Test selection is mandatory, not an optimisation.** At Google only 63K of 5.5M affected test targets ever failed, and 99:1 of test targets per change pass. Meta's ML selection runs "fewer than a third" of dependent tests, still catches >99.9% of faulty changes, and halves infrastructure cost. [read]
8. **Flakiness is the main limit on throughput.** At Google, about 1.5% of test runs flake, almost 16% of tests have some flakiness, and "about 84% of the transitions… from pass to fail involve a flaky test" (2016). [read] Chromium estimates about 20,000 unique flaky tests and says that without retries "pretty much no CL would ever pass the CQ." In Google's flake-aware culprit-finding dataset, about 40% of breakages had no culprit at all and were flakes. [read]
9. **Every serious queue therefore builds flake tolerance into the merge decision.** Shopify removes a PR only after its fourth consecutive failure (tolerance 3, with false-positive odds down to about 0.39%). Trunk has "Pending Failure Depth": a failure can be cleared retroactively when a later group that includes it passes. Chromium retries with the patch, then reruns without it. Meta fits a Bayesian flakiness score per test. [read]
10. **Partitioning by build-graph impact is how queues stop being a single line.** Examples are Uber's conflict analyzer, Trunk's "impacted targets" lanes, Mergify "scopes" and Meta's file-disjointness check. All of them collapse to serial when a change touches a shared root: Trunk's "ALL" target "becomes a prerequisite of every PR queued behind it." [read]
11. **Batching helps cost more than latency, and only when the failure rate is low.** In Trunk's own simulation, going from batch size 1 to 16 cut CI time per PR by 77.5% but raised average time to merge by 54.9%. Mergify's production dynamic batching (max 2) left merges per day flat (48.4 to 45.3). [read]
12. **Agent-era data is thin and vendor-sourced.** Mergify (153K merges, about 160 teams, 90 days) found AI-stamped PRs broke main 1.9% of the time against 4.4% for others. Broken-main rate grew about 16x with team size, reaching 1 in 8 merges at 40+ engineers. In 94% of private merges the queue tested PRs one at a time. [read, vendor data]
13. **The landing service is now critical infrastructure with new failure modes.** Trunk reports that on 2026-04-23 GitHub's merge queue built temp branches from the wrong base and pushed them to main, silently dropping already-merged code. I could not confirm this in GitHub's April 2026 availability report, which lists 10 incidents and none of them merge queue. Mergify reports formally verifying its queue with TLA+. [read: vendor claim, unconfirmed by GitHub]
14. **GitHub's own figures confirm the load shift.** Pushes rose from 0.69B to 3.35B a month and merges are nearly 4x year on year. "Trunk-based development, release trains, and merge queues funnel all that work onto a single ref that has to absorb every merge." [read] This verifies the brief's GitHub numbers.
15. **Verdict on the brief's "landing is a service — nobody yet": partly refuted.** Server-side landing exists in Meta's pushrebase and is productised by GitHub, GitLab, Mergify, Trunk, Aviator and Graphite queues. Speculative batching exists in Zuul, GitLab, GitHub and Uber. No source I read does the brief's specific step: a conflict hands the *intent and context* of the colliding change back to the losing agent's environment so it can repair and re-prove. [inference from everything read]

---

## Detailed findings

### A. Google: Piper, TAP, presubmit and post-submit, flakiness

**Scale and the core decision**
- The TAP paper (Memon et al., ICSE-SEIP 2017) describes TAP as responsible for CI of "Google's vast majority of 2 Billion LOC codebase". On an average day it "integrates and tests… more than 13K code projects, requiring 800K builds and 150 Million test runs." [read] https://huang.isis.vanderbilt.edu/cs8395-f23/paper/google-testing-icse-seip-17.pdf
- The paper on why per-change testing was abandoned: TAP "is unable to keep up with the developers' code churn rate — a code commit every second on the average — i.e., it is not cost effective to test each code commit individually. In the past TAP tried to test each code change, but found that the compute resources were growing quadratically with two multiplicative linear factors: (1) the code submission rate… and (2) the size of the test pool." [read]
- Its fix: "breaking a TAP day into a sequence of epochs called milestones." A milestone is "typically cut every 45 minutes during peak development time," and milestones run "as large as 4.2 million tests." The paper observed "unacceptably large delays of up to 9 hours." [read]
- In a dataset covering Feb 11 to Mar 11, 2016, 5,562,881 test targets were affected and more than 4 billion outcomes recorded. Of those targets, 5,082,803 never failed. 115,160 both passed and failed, and 46,694 of those were flakes. Only 1.23% of targets "actually found a test breakage." Per change, "less than 0.5% FAILED." [read]
- Distance matters: "test targets that are more than a distance of 10 (in terms of number of dependency edges) from the changed code hardly ever break." A simulation running only tests with MinDist ≤ 10 executed 61% of targets. [read]
- **Relevant to agents:** automated committers are among the worst breakers. The tool account "product1-release made 42 commits of which 39 caused breakages" (92.9%), and several "releaser" tool accounts broke at 10–15%. "Files within a short time span modified by 3 (or more) developers are significantly more likely to cause breakages." [read] If many agents edit the same hot files, this is exactly the breakage pattern they will produce. [inference]
- From *Software Engineering at Google*, ch. 23: TAP handles "more than 50,000 unique changes per day" and runs "more than four billion individual test cases" daily. Presubmit runs a team-defined fast subset, and a change that passes it has a "95%+" chance of passing everything else. The average wait to submit is "around 11 minutes". Running everything before submit is "too expensive", and "mid-air collisions… happens most days at our scale." [read] https://abseil.io/resources/swe-book/html/ch23.html
- Failure recovery in the same chapter: TAP batches changes, then splits a failing batch and reruns it. Each team has a "Build Cop". Rollback is the "fastest and safest route", and TAP was "upgraded to automatically roll back changes when it has high confidence they are the culprit". Hermetic presubmit cut Google Assistant's presubmit runtime "by a factor of 14". [read]
- On build infrastructure, ch. 18 says the remote cache is keyed by "target and a hash of its inputs", that Forge executes actions remotely with a Scheduler that returns cached action results, and that the volume is "millions of builds executing millions of test cases and producing petabytes of build outputs" a day, in use since 2008. Correctness requires "completely reproducible" builds. [read] https://abseil.io/resources/swe-book/html/ch18.html
- From the CACM article (Potvin and Levenberg, July 2016), as reported in search snippets: 2B lines, 86 TB, about 40,000 commits a workday, of which 16,000 were human and 24,000 from automated systems; CitC FUSE clients; trunk-based development with branches rarely used. The research.google page confirms the authors, venue and "tens of thousands of developers". [secondary for the numbers; read for the metadata] https://research.google/pubs/why-google-stores-billions-of-lines-of-code-in-a-single-repository/

**Flakiness**
- From "Flaky Tests at Google and How We Mitigate Them" (John Micco, 2016-05-27): "about 1.5% of all test runs reporting a 'flaky' result"; "Almost 16% of our tests have some level of flakiness"; "about 84% of the transitions we observe from pass to fail involve a flaky test"; "the insertion rate is about the same as the fix rate." [read] https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html
- Mitigations in the same post: rerun only failing tests; auto-rerun; mark a test flaky so it fails only "if it fails 3 times in a row", which means a 15-minute test needs 45 minutes to reveal a real break; auto-quarantine that "files a bug"; and a tool that finds the change which altered a test's flakiness level. [read]
- "Flake Aware Culprit Finding" (Henderson et al., ICST 2023): Bayesian, noisy binary search with priors over which changes are likely culprits, evaluated on 13,600 breakages. "Approximately 60% of the items had a culprit version and 40% did not (as these were caused by a flaky failure)", and there were "approximately twice as many flaky ranges as non-flaky ones." Accuracy was about 97.5% for FACF(all) against about 96.1% for Bisect(1). Deflaking a failure to a confidence p costs about ⌈log(p)/log(f)⌉ runs, for example 6 extra runs at p=10⁻⁴ and f=0.2. [read] https://storage.googleapis.com/gweb-research2023-media/pubtools/6969.pdf

### B. Uber SubmitQueue

**2019 design (EuroSys, "Keeping master green at scale")**, from Adrian Colyer's summary:
- Before SubmitQueue, the iOS mainline was green only 52% of the time in a sampled week. "Probability of a breakage: about 40% with 16 concurrent, potentially conflicting changes." [secondary via the summary]
- A single FIFO queue at 1,000 changes a day and 30 minutes each means the last change waits more than 20 days. [secondary]
- Components: a speculation engine that builds a binary speculation tree with probabilities on its edges, which becomes a graph for independent changes; a conflict analyzer that uses build-system targets (two changes conflict if they affect a common target, with a hash per target); a planner and build controller. [secondary]
- Success prediction: logistic regression on about 100 features, reported 97% accurate. Features include prior speculation outcomes, number of resubmissions, and developer identity. SubmitQueue achieves about 1.2x the turnaround of an oracle. [secondary] https://blog.acolyer.org/2019/04/18/keeping-master-green-at-scale/

**2023 BLRD (Bypassing Large Diffs)**, from Uber's blog (2023-08-31):
- A later small change B may land before a large earlier change A if every speculation path involving B passes: main+B and main+A+B. "Thousands of commits per day." Before BLRD, changes behind a large diff waited "as long as two hours". P95 wait improved 74% after BLRD on the Go monorepo (late May 2023). The cost is that "the number of speculation builds doubles with each new conflicting change". The correctness proof assumes hermetic builds and deterministic tests. [read] https://www.uber.com/blog/bypassing-large-diffs-in-submitqueue/

**2025 paper "CI at Scale: Lean, Green, and Fast"** (arXiv 2501.03440):
- More than 4,000 engineers, "tens of thousands of changes" a month, six major monorepos, hundreds of millions of lines of code, in production since 2018. [read] https://arxiv.org/html/2501.03440v2
- New pieces: NGBoost predicts each build's duration as a mean and variance, giving P(FT_y < FT_x) = Φ(Z) for ordering. A "speculation threshold" filters out low-value builds. Traversal changed from greedy depth-first to level-order. The model is retrained weekly on 3 months of history, with build-time MAPE of 3–6%.
- Results: P95 wait fell 44.67% on Go (33.69 to 18.64 minutes), 33.32% on iOS and 31.66% on Android. Builds per change fell from 3.39 to 1.85 (Go), 4.93 to 2.57 (iOS) and 5.43 to 1.96 (Android). Headline: about 53% less CI, 44% less CPU, 37% lower P95.
- Pre-enhancement failure modes: "premature aborts" hit an estimated 40–65% of builds; small changes waited behind large ones; tree cost was exponential. Future work: dynamic thresholds under load, and batching by success probability.
- Implication [inference]: even the best strict queue spends about 2–5 builds per landed change. Multiply change volume by 100 and the strict approach multiplies a large CI bill by 100 unless prediction gets much sharper.

### C. Meta: land-time testing, predictive selection, pushrebase, flakiness

**Diff workflow and land**
- Machalica et al., "Predictive Test Selection" (arXiv 1810.05286; ICSE-SEIP 2019), describe the stages as pre-submit, diff-time, land-time and stabilization. At diff time, "Each tested patch is first rebased onto a recent version of master branch that is known to pass all automated tests," with a target of results "in no more than ten minutes". [read] https://arxiv.org/pdf/1810.05286
- **Land-time is explicitly not serialized**: "it is not feasible to serialize the process of land-time testing for all of them… a number of code changes submitted for landing will be rebased onto the same version of master branch, tested in parallel and then serialized into a linear history of commits. It is possible that changes being landed simultaneously pass when tested individually." These stages "cannot maintain the quality of the released product on their own due to races"; a later stabilization stage finds green versions, and release candidates "can only be based of such versions". [read]
- Diff- and land-time testing "require an order of magnitude more machine resources than testing during the stabilization stage". Earlier stages "scale at least linearly in the number of developers". [read] With agents, "number of developers" becomes "number of agents", so this cost term is the one that explodes. [inference]
- Selection results: fewer than a third of transitively dependent tests are run; over 95% of individual failures and over 99.9% of faulty changes are still caught; total testing infrastructure cost falls by a factor of two. "Almost 99.9% of test targets selected by build-dependency-based selection strategy pass." The model is gradient-boosted trees trained on history, with failed tests retried aggressively so flaky failures do not become training labels. [read] Also https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/ (2018-11-21) [read]
- "Rapid release at massive scale" (Chuck Rossi, 2017-08-31): more than 1,000 diffs a day landed on master by 2016, weekly pushes sometimes reached 10,000 diffs, and continuous pushes carry "tens to hundreds of diffs every few hours". Gatekeeper flags let engineers switch a feature off instead of reverting; Android ran 50–60K builds a day. [read] https://engineering.fb.com/2017/08/31/web/rapid-release-at-massive-scale/

**Mononoke pushrebase (server-side landing)**, read from source on `main` of facebook/sapling on 2026-10-12:
- Module doc: "The main goal of pushrebase is to decrease push contention. Commits that client pushed are rebased on top of `onto_bookmark` on the server." [read] https://raw.githubusercontent.com/facebook/sapling/main/eden/mononoke/features/pushrebase/src/lib.rs
- Conflict rule: `intersect_changed_files`. Two sets of changes conflict only if "element from `left` is prefix of element from `right`, and vice versa", meaning a path-prefix overlap between files the client changed and files changed on the server since the client's root. Case-folding conflicts are also checked. Errors come back as structured `PushrebaseConflict { left, right }` pairs. [read]
- Loop: `MAX_REBASE_ATTEMPTS: usize = 100`. Each attempt reads the bookmark (start of the "critical section"), checks only the delta since the last attempt, rebases, and writes the bookmark. Metrics include `critical_section_success_duration_us`, `conflict_rejections` and `commits_rebased`. [read]
- Newer pieces: automatic "merge resolution". When an overlapping file has a clean three-way text merge (`three_way_merge::merge_text`), the push can still land. It is gated by a JustKnob, has excluded path prefixes, and counts a `merge_resolution_lost_on_retry` invariant. "Replay from fork point" is bounded at `REPLAY_MAX_COMMITS = 50` and `REPLAY_MAX_PATHS = 5_000`. Rejections are reported through "Multi-Repo Land's conflict descriptions". [read]
- **Batching queue**: `PushrebaseQueue` "Serializes and batches pushrebases for one repository bookmark" over an `mpsc::channel(1000)`. `do_batched_pushrebase` "Lands multiple indexed stacks in a single critical section pass", merging requests whose changed-file prefix tries do not overlap and whose flags match. Batches containing merge commits are excluded. It "Returns only CAS-failure requests for re-queuing". [read] https://raw.githubusercontent.com/facebook/sapling/main/eden/mononoke/features/pushrebase/src/queue.rs
- Design meaning [inference]: Meta separates landing (textual, server-side, a sub-second critical section, batched compare-and-swap on one bookmark) from verification (land-time tests run in parallel on a recent green base, then post-land stabilization). That separation is what lets one bookmark absorb Meta's land rate. It is the closest existing match to the brief's "landing is a service", minus the hand-back to an agent.
- The Sapling announcement (2022-11-15) gives the repo as "tens of millions of files, tens of millions of commits, and tens of millions of branches". It does not discuss landing. [read] https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/

**Build and target determination**
- Buck2 (2023-04-06): remote execution first, using the same RE API as Bazel; a single incremental dependency graph; integration with virtual file systems; about 2x faster than Buck1; "millions of builds per day". [read] https://engineering.fb.com/2023/04/06/open-source/buck2-open-source-large-scale-build-system/
- buck2-change-detector (`supertd`/`btd`) dumps the target graph before and after a change and computes impacted targets. It notes that "a change in a key dependency will cause an infeasible number of targets," so it reports a per-target `depth` that lets CI trim distant targets "at the risk of potentially allowing a breakage into the repo". This is the same idea as Google's MinDist. [read] https://raw.githubusercontent.com/facebookincubator/buck2-change-detector/main/README.md
- Bazel `target-determinator` lists the targets changed between two commits. Its default when the "before" query fails is `ignore-and-build-all`. [read] https://raw.githubusercontent.com/bazel-contrib/target-determinator/main/README.md

**Flakiness score**
- PFS (2020-12-10) is a Bayesian model fitted in Stan with two parameters per test (probability of a bad state, and probability of failure in a good state), computed from existing CI results with no extra runs. Worsening tests are ticketed or excluded from change-based selection. The practical floor is "well below 1 percent" for unit tests and "reaches 10 percent" for some end-to-end frameworks. [read] https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/

### D. Chromium Commit Queue (optimistic, retry-heavy)
- Dry run versus full run; a "Mega-CQ" for risky CLs; experimental builders that run "on a percentage of CQ builds". [read] https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md
- Failure algorithm: run with the patch; retry failing shards with the same configuration; rerun still-failing suites without the patch; fail only if the test "failed in both" with-patch runs but passed without the patch.
- Cycle-time bar: "Median cycle time needs to be under 40 minutes for trybots", with p90 "around an hour".
- **Build reuse with freshness windows**: a passing build stays reusable while the target branch has advanced fewer than a threshold number of commits (example: 800 on `main`) or within 24 hours. This is the closest existing match to a "proof freshness" policy. [read]
- "Roughly 20,000 unique flaky tests". Without retries "pretty much no CL would ever pass the CQ." [read]

### E. Strict merge queues: Bors/homu, Zuul, GitLab, GitHub, Shopify

- **The rule**: Ben Elliston's early-2000s setup "automatically maintain[ed] a repository of code that always passes all the tests"; Graydon Hoare's bors (2013) applied it to Rust. History is from Mergify's "Origin story of merge queues" (2025-09-10). [secondary] https://mergify.com/blog/the-origin-story-of-merge-queues. I could not open Graydon's own post because Dreamwidth returned a captcha and then a 504.
- **bors-ng** README: it batches approved PRs into a `staging` merge commit, fast-forwards main if CI passes ("Since the main branch contains the exact contents that were just tested, bit-for-bit, it's not broken"), and bisects a failing batch. It now carries a deprecation notice pointing users to GitHub's native merge queue (2023). [read] https://raw.githubusercontent.com/bors-ng/bors-ng/master/README.md
- **Rust's bors and rollups**: rust-lang/bors is a Rust rewrite of homu with `automation/bors/auto` and `try` branches, and separate merge branches "because we cannot set branches to parent and merge them with a PR commit atomically using the GitHub API." [read] https://raw.githubusercontent.com/rust-lang/bors/main/README.md. The forge rollups page says bors tests one PR at a time and Rust's CI takes about 3.5 hours, so humans hand-assemble rollups (for example 1–2 `iffy`, 8 `maybe` and 10 `always` PRs). A failure is triaged with rust-log-analyzer and the culprit removed. [read] https://forge.rust-lang.org/release/rollups.html
- **Zuul** (OpenStack): dependent pipelines test change N on top of every change ahead of it, on the assumption "that all jobs will succeed". On a failure, the changes behind are retested without it. The window starts at 20, adds one per merge and halves on failure, with a floor and an optional ceiling. Projects can share queues for cross-repo gating, and `Depends-On:` footers form a DAG across Gerrit and GitHub. [read] https://zuul-ci.org/docs/zuul/latest/gating.html
- **GitLab merge trains**: pipelines for A, A+B and A+B+C run in parallel. If B fails, C restarts as A+C. The parallel-pipeline limit defaults to 20 ("The minimum value is `1`"), and "The number of queued merge requests is unlimited". An experimental `skip_merge_train` option merges without restarting the train, and the docs warn the result is unverified. [read] https://docs.gitlab.com/ci/pipelines/merge_trains/
- **GitHub merge queue**: temporary `gh-readonly-queue/{base}` branches; a `merge_group` event; each group is the base plus the PRs ahead of it. Build concurrency is 1–100 and merge group size 1–100. "Only merge non-failing pull requests", if disabled, lets a later passing group carry an earlier failing PR. A jump forces "a full rebuild of all in-progress pull requests". [read] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue. General availability was 2023-07-12. [read] https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/
- **GitHub's own use** (2024-03-06): more than 500 engineers merge about 2,500 PRs a month into the monorepo. The old "trains" were capped at about 15 PRs and could make engineers wait "8+ hours" only to be bumped. Average wait to ship fell 33%, and the queue was tested on 30,000+ PRs and 4.5M CI runs. "Throughput was prioritized over fairness to any single PR." [read] https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/
- **Shopify** (2019-11-14): about 400 commits a day to the monolith, deploying about 40 times a day. Merge Queue v2 uses a "predictive branch" reconciled "modeled on React's virtual DOM". Flake tolerance 3 cuts false-positive removal from 25% to about 0.39% at an assumed 25% flake rate. Batch size is 8 PRs per deploy, with CI on 3 batches at once, and there is an emergency `/shipit --emergency` with an audit trail. [read] https://shopify.engineering/successfully-merging-work-1000-developers

### F. Commercial queues: Trunk, Mergify, Aviator, Graphite
- **Trunk**: predictive testing; optimistic merging, where a later pass validates the groups ahead of it; Pending Failure Depth; anti-flake protection; flaky-test quarantine, with quarantined tests still uploading results; priority merging. [read] https://docs.trunk.io/merge-queue/optimizations
  - Parallel queues: each PR uploads "impacted targets", with built-in support for Bazel and Nx and an API for anything else, and PRs wait until targets are uploaded. Overlapping PRs form a DAG of lanes. [read] https://docs.trunk.io/merge-queue/optimizations/parallel-queues
  - Batching: default target batch 4, max wait 5 minutes, bisection "logarithmic in batch size", and a separate bisection concurrency setting. "A PR that impacts ALL targets becomes a prerequisite of every PR queued behind it." "If your impact-detection setup misses transitive dependents, you'll see false-parallel merges." Vendor claims: 3–5x throughput, 50–70% fewer CI minutes, and keep batch failure rate below 10%. [read, vendor claims] https://docs.trunk.io/merge-queue/optimizations/batching
  - "Merge fast or merge cheap" (2025-06-13): in the SimMergeQueue simulation, batch 1 to 16 at 0.1% conflict rate moved time to merge from 41m56s to 1h05m (+54.9%) and CI per PR from 41m28s to 9m19s (−77.5%). It quotes Mike Krieger that "90-95% of changes to Claude Code's codebase are now written by Claude Code" and that the merge queue had to be "completely re-architect[ed]". [read; the Krieger quote is secondary] https://trunk.io/blog/merge-fast-or-merge-cheap-fine-tuning-merge-queues-to-handle-an-increase-in-prs-f
  - "Outgrowing GitHub merge queue" (2025-09-03): one FIFO line, CI runs twice per PR (on the branch and in the group), no batching, concurrency capped at 100, and it becomes a bottleneck "beyond 20-30 developers". [read, vendor] https://trunk.io/blog/outgrowing-github-merge-queue
  - "What happens if a merge queue builds on the wrong commit" (2026-04-24) describes a GitHub incident on 2026-04-23 in which temp branches built from the PR's divergence point were pushed to main, "Thousands of lines of unrelated, already-shipped code were quietly removed", and one PR showing +29/−34 landed as +245/−1,137. Trunk's mitigation is that temp branches are test-only, the real merge is a normal merge, and the queue has no bypass privilege. [read, vendor; GitHub's April 2026 availability report did not list it] https://trunk.io/blog/what-happens-if-a-merge-queue-builds-on-the-wrong-commit ; https://github.blog/news-insights/company-news/github-availability-report-april-2026/
  - GitHub native stacked PRs entered public preview on 2026-07-30, and Trunk tests and lands a stack prefix atomically. [read, via Trunk] https://trunk.io/blog/trunk-merge-queue-now-supports-github-stacked-pull-requests
- **Mergify**:
  - Parallel checks: `max_parallel_checks`, `batch_size` with a `{min,max}` range, culprit isolation by splitting, and "two-step CI" (cheap preliminary checks, exhaustive checks just before merge). [read] https://docs.mergify.com/merge-queue/parallel-checks/
  - Dynamic batch size (2026-07-06): `clamp(ceil(remaining_pulls / free_slots), min, max)`. On a busy day 74% of checks were paired, but merges per day stayed flat (48.4 to 45.3). [read] https://mergify.com/blog/dynamic-merge-queue-batch-size
  - "Isolated" mode (2026-06-17) deliberately drops the cross-batch semantic-conflict check. The staleness window is `(max_parallel_checks − 1) × batch_size` PRs, for example 4, or 20 with batch 5. The rationale is that "most pre-merge CI failures turn out to be flaky tests, not real semantic conflicts" (no figure given). [read] https://mergify.com/blog/merge-queue-mode-skips-safety-check-on-purpose
  - Scopes (2026-04-10): "The bottleneck isn't CI duration, it's CI serialization." The queue becomes a DAG over scopes computed from path globs, `nx affected` or `bazel query`, with a warning of "false green" when scopes miss real dependencies. [read] https://mergify.com/blog/monorepo-merge-queue-concurrency-problem
  - "Merge Queues Were Built for Humans. AI Agents Need More." (2026-07-13) relays Mitchell Hashimoto's estimate that agent churn is 10x in the conservative case and 100–1,000x if the hype holds. Its list of needs: speculative testing, batching with bisection, scope-aware parallelism, two-step CI, queue-owned rebasing so "the exact SHA tested is the SHA that lands," and **change-level identity that survives rebase** (described as ongoing work). [read; the Hashimoto quote is secondary] https://mergify.com/blog/merge-queues-and-ai-coding-agents
  - State of Merge Queues 2026 (2026-07-27): see Summary item 12. Other figures: median queue time about 7 minutes; failed batches average about 6 PRs; open-source repos break main 1.1% of the time against 5.1% for private repos. [read, vendor] https://mergify.com/blog/state-of-merge-queues-2026
  - Bun PR #30412 (Mergify write-up, 2026-06-04): 1,009,257 lines added across 2,188 files in 6,755 commits, open for six days, landed as one squash commit. Mergify argues "the PR is the bottleneck" and that one squash ruins bisect and revert resolution. [read, vendor framing] https://mergify.com/blog/bun-million-line-pr-postmortem
- **Aviator** parallel mode: a draft PR per queued PR that holds all PRs ahead of it; a cap on parallel bot builds; if a later draft passes, it "assumes eventual consistency and merges all PRs up to it"; skip-the-line resets all drafts. [read] https://docs.aviator.co/mergequeue/concepts/parallel-mode
- **Graphite**: describes itself as "the only merge queue that is stack-aware"; validates whole stacks in parallel; a fast-forward mode reuses CI already run on the exact change. [read] https://graphite.com/docs/graphite-merge-queue

### G. Test impact analysis and caching (build-graph side)
- **Nx affected**: changed files are mapped to projects and then to dependents. The recommended base is "the latest successful commit" on main. Lockfile changes mark everything affected by default. The docs admit affected "alone may not speed up CI much" when a widely used project changes, and pair it with remote cache and distributed execution. [read] https://nx.dev/ci/features/affected
- **Bazel RBE**: actions are distributed over a gRPC remote execution and caching protocol, with "mandatory configuration constraints" (hermeticity). [read] https://bazel.build/remote/rbe
- **CloudBees Smart Tests** (formerly Launchable): the marketing page claims "Up to 80%" less test execution time and gives no method. [read, marketing] https://www.cloudbees.com/capabilities/cloudbees-smart-tests

### H. Agent-era evidence touching CI and merge
- **GitHub (Celenza, 2026-10-06)**: commits 7.38B in September (more than 5x); pushes 0.69B to 3.35B a month; Git events 218.2B to 473.3B a month; Actions runs 3.26B (more than 4x); PR merges nearly 4x. Also: "funnel all that work onto a single ref", a push is "only as fast as the slowest replica", CI fetches the branch tip "thousands of times per minute", and only the ref update needs agreement. Up to 35x write throughput in internal benchmarks. **This verifies the brief's GitHub figures.** [read] https://github.blog/engineering/infrastructure/building-git-infrastructure-for-agent-scale-development/
- **GitHub reliability**: the April 2026 availability report lists exactly 10 incidents. **This verifies the brief's "10 incidents in April 2026".** I did not check May. [read]
- **Anthropic, C compiler with 16 parallel Claudes** (2026-02-05): a bare git upstream; task locks as files in `current_tasks/`; "Merge conflicts are frequent, but Claude is smart enough to figure that out"; CI added late because "new features often broke existing functionality"; and a `--fast` deterministic 1% or 10% random test sample per agent, different on each VM, so the swarm covers the whole suite collectively. About 2,000 sessions and just under $20,000. [read] https://www.anthropic.com/engineering/building-c-compiler
- **Block** (2026-10-08): a migration can merge about 1,000 orchestrated PRs. Merges to main and production deploys stay human-gated, with two humans approving each deploy. [read] https://claude.com/resources/articles/how-block-orchestrates-claude-fable-across-thousands-of-pull-requests
- **Brief's Anthropic CI claims** (CI jobs 25x in six months; test-selection service patches lasting 70 days, 29 days and under a day; "assume 25x load"): **NOT VERIFIED.** No such post appears in the anthropic.com/engineering index, the claude.com blog index or the claude.dev blog first page, and search was exhausted. The only related item I found is Krieger's "completely re-architect" merge-queue remark, relayed by Trunk. [secondary]

---

## Pain points for agentic-scale development

1. **Serialization on one ref.** A strict FIFO queue's throughput is about 1/T_ci. Uber's example is 1,000 changes a day at 30 minutes each leading to more than 20 days of wait; GitHub says all work funnels "onto a single ref". [read]
2. **Speculation blow-up.** Speculative depth W costs up to W builds per change. BLRD-style out-of-order landing doubles builds per conflicting change, and Uber saw premature aborts on 40–65% of builds. [read]
3. **The failure rate sets the useful speculation depth.** If a fraction p of changes fail, a speculative chain survives about 1/p changes before a reset. With p ≈ 4–5% (Mergify's broken-main rate for private repos), the useful depth is about 20 no matter how many machines you add. That is why Zuul halves its window on each failure. [inference from the read mechanisms and data]
4. **Batching collapses at high failure rates.** P(a batch of B fails) = 1 − (1 − p)^B. At p = 5%, a batch of 8 fails about 34% of the time and a batch of 16 about 56%, and each failure adds about log2(B) bisection rounds. Trunk advises keeping the batch failure rate under 10%, which at p = 5% means batches of about 2. Mergify's production ceiling is 2. [inference using Trunk and Mergify figures]
5. **Flakiness is multiplied by volume.** At 1.5% flaky runs and about 1,000 tests per project, about 15 failures per full run are noise. 84% of pass-to-fail transitions involve a flake, and 40% of culprit searches find no culprit. More changes mean more runs and more flaky reds, and agents that "fix" flaky reds rewrite working code. Mergify argues agents need to query test health before retrying. [read and inference]
6. **Compute grows quadratically.** Submission rate times test-pool growth: Google's stated reason to stop testing every change. Agents raise both factors, because they write tests too. [read and inference]
7. **Cross-cutting changes serialize everything.** Lockfiles, root BUILD files and codemods are "ALL" targets. Agents doing migrations (Block's roughly 1,000-PR migrations, Google's Rosie-style large-scale changes) produce exactly these. [read and inference]
8. **Hot-file contention.** Code touched by 3 or more authors in a short window breaks much more often. Many agents assigned to adjacent tasks recreate this, as in the C-compiler project, where agents "overwrote each other's fixes" on the kernel task. [read]
9. **Tested SHA versus landed SHA.** Rebases change the SHA, so reviews and test results are invalidated and must be rerun. GitHub runs CI twice (on the branch and in the group). bors needs separate merge branches because GitHub cannot atomically "set branches to parent and merge". [read]
10. **Landing infrastructure as a single point of silent failure.** In the reported GitHub merge queue incident, wrong-base temp branches were pushed to main and dropped code with no conflict signal. [read, vendor claim]
11. **Giant single PRs defeat bisect and revert.** Bun's 1M-line squash commit is the example. [read, vendor framing]
12. **Automated committers break more.** TAP's tool accounts broke at 10–93%. This contradicts the Mergify AI-PR data, so how good agents are at keeping main green is an open, workload-dependent question. [read]

---

## How organisations are solving them

| Mechanism | Who | What it buys | Cost or risk |
|---|---|---|---|
| Fast presubmit subset, full post-submit by milestone, automatic culprit finding and rollback | Google TAP | Scales to 50K+ changes a day; 11-minute submit wait | Main is briefly red; needs Build Cops and auto-rollback; detection delays up to hours |
| Land-time tests in parallel on the same green base, plus post-land stabilization | Meta | Avoids serializing land-time testing | Racing changes can break master; releases cut only from stabilized versions |
| Server-side rebase, path-disjointness check, batched compare-and-swap, auto 3-way merge | Meta Mononoke pushrebase | Removes push contention; sub-second critical section; agents never run a rebase loop | Textual safety only; semantic safety comes from tests elsewhere |
| Speculation tree, target-hash conflict analysis, ML success and duration prediction, bypass | Uber SubmitQueue | Always-green main at thousands of changes a day | About 2–5 builds per change; exponential worst case; needs hermetic builds |
| Dependent pipeline, adaptive window (+1 / halve) | Zuul, GitLab, GitHub, Aviator | Simple strict gating with parallelism | Full reset behind each failure |
| Batch plus bisect | bors-ng, Trunk, Mergify, Rust rollups (manual) | Cuts CI cost per PR | Latency rises; collapses when failure rate is high |
| Impact-target lanes or scopes (DAG queue) | Trunk, Mergify, Uber | Independent work stops waiting | False parallelism if the graph misses edges; "ALL" changes serialize |
| Flake tolerance (N consecutive failures, pending failure depth, retry with and without patch, quarantine, Bayesian scores) | Shopify, Trunk, Chromium, Google, Meta | Keeps the queue moving despite noise | Can hide real races; slower detection |
| Test selection: static (Bazel/Buck target determinators, Nx) or ML (Meta, Launchable) | Everyone at scale | 2x to 3x cost cut at 99.9% catch rate (Meta) | Misses; needs fallback full runs; base-commit subtleties |
| Remote execution plus content-addressed cache | Google Forge/ObjFS, Bazel RBE, Buck2 | Identical actions are never rerun; "build twice as fast" (Google ObjFS) | Requires hermeticity |
| Result reuse within a freshness window | Chromium CQ (800 commits / 24 hours) | Avoids re-proving after trivial rebases | Staleness risk bounded by policy |
| Feature-flag kill switch in place of revert | Meta Gatekeeper | Fast reversal without touching trunk | Flag debt |
| Human gate kept only at deploy | Block (two approvers per deploy) | Agents can merge widely while production stays controlled | Human throughput at deploy |

---

## Implications for a future forge

1. **Separate landing from verifying, as Meta does.** Landing should be a sub-second, server-side, textual operation: rebase, disjointness check, batched compare-and-swap. Verification should be asynchronous and probabilistic, attached as evidence. The brief's "trunk lock per repo" should become a Mononoke-style per-bookmark queue that lands every non-overlapping thread in one compare-and-swap pass. [inference, grounded in the pushrebase source]
2. **Choose the green guarantee per path, not per repo.** Strict, Uber-style gating for billing or infra paths; optimistic land plus post-land proof plus auto-revert for docs, UI and low-risk paths. That mirrors Google and Meta, which never paid strict-gating costs repo-wide. This fits the brief's "proof is what you merge on" policy-as-code idea. [inference]
3. **Make the conflict domain a first-class index.** Threads should declare, and the forge should compute, impacted targets (Bazel/Buck/Nx target determinators, or file prefixes as a fallback). The queue becomes a DAG of lanes, and "ALL"-impact threads such as lockfiles and codemods get their own scheduled lane or off-peak slot. The brief's idea 6 ("agents see each other early") is the same index used before merge time. [inference]
4. **Give a change an identity that survives rebase.** Proof attaches to the thread or change ID plus a content hash of the impacted inputs, not to a commit SHA. Reuse proof under a Chromium-style freshness policy ("valid until N commits touching my impacted targets land"). This is what Mergify names as unsolved and where the thread object helps directly. [inference]
5. **Make flakiness a forge-level fact.** Keep a per-test flakiness score (Meta PFS style), retry with and without the patch (Chromium), and use pending-failure-depth semantics. Expose test health to agents through an API so they do not "fix" flakes. Hide flaky failures from the agent loop and report them to the test owner. [inference]
6. **Predict before you speculate.** Agents carry rich features: model, task type, diff size, proof strength, and how many concurrent threads touch the same targets. Use them, as Uber does, to rank speculative builds and to decide batch membership. Batch only threads predicted to pass with high confidence; this is the arithmetic that makes batching work. [inference]
7. **On conflict, hand back context, not a red X.** Mononoke already returns structured conflict pairs and attempts automatic three-way merges. The next step, which the brief proposes and no source does, is to give the losing thread the winner's intent and diff and let it resolve semantically in its own sandbox. [inference]
8. **Treat the landing service as safety-critical.** Never push a speculative or temp ref to trunk (Trunk's lesson from the reported GitHub incident). Verify that the landed tree equals the tested tree plus the declared delta. Consider formal models such as Mergify's TLA+ work. [inference]
9. **Budget CI explicitly.** Uber's 1.85–5.43 builds per change and Meta's "order of magnitude more machine resources" at diff and land time mean 100x agent volume without selection, caching and prediction is 100x the bill. The forge should show the CI cost per thread and let policy trade latency for cost (Trunk's "merge fast or merge cheap"). [inference]
10. **Keep small units and stacks.** Giant agent PRs (Bun) defeat bisect and revert. Restacking into small, independently landable commits (Amp restack, GitHub native stacks, Graphite) keeps culprit finding cheap: log2 of a smaller range. [inference]

---

## What changes at 10x and 100x change volume (worked reasoning, all [inference])

Assume a team that lands 500 changes a day today with a 20-minute CI and a 4% per-change failure rate (Mergify's private-repo rate is 5.1%).

- **Serial strict queue**: capacity is 72 a day, so the team is already infeasible today. This is why it uses speculation.
- **Speculative strict queue** (Zuul or GitHub style): useful depth is about 1/p = 25. Capacity is about 25 changes per 20 minutes, roughly 1,800 a day, at an expected CI cost of several builds per landed change. At 10x (5,000 a day) it saturates. At 100x (50,000 a day, Google's TAP volume) it is hopeless unless changes are partitioned into about 30 or more independent lanes and the failure rate is pushed well below 1%.
- **Batching**: at p = 4%, batches larger than about 2–3 fail too often. Batching only scales if agents pre-prove changes so that p falls toward Google's presubmit-pass rate of 95%+ or lower failure. The arithmetic pushes proof upstream into the thread, and that is the thread-native forge's thesis.
- **Partitioning**: throughput scales with the number of independent impact components. Agents should be steered (idea 6) so they do not pile onto the same targets, both for queue parallelism and because 3 or more concurrent authors on a file predicts breakage.
- **The optimistic fallback**: past some volume every large organisation that published (Google, Meta) moved to landing on partial evidence, then running the full suite post-land with automatic culprit finding and revert. A future forge should plan for that mode from the start: flake-aware culprit finding, one-click or automatic revert, and flags.
- **Push and ref contention**: the trunk ref update must be a tiny critical section. Mononoke measures it in microseconds; GitHub restructured so that only "the reference update requires agreement". Batched compare-and-swap of N disjoint threads per update amortises it.

---

## Contradictions and pushback

- **"Keep main always green" versus "it's too expensive".** Uber, Shopify, bors and Zuul treat green as non-negotiable. Google says running all tests before submit is "too expensive" and relies on rollback; Meta says serializing land-time testing is "not feasible". Both can be true: strictness is affordable at about 10³ changes a day and not at about 10⁵. The brief's "merge on proof" should say which mode it means.
- **Do agents break main more or less?** Mergify finds AI-stamped PRs break main less (1.9% against 4.4%), but the data is observational, AI use is undercounted, and teams may differ. Google's TAP data shows automated tool accounts with some of the highest breakage rates (product1-release at 92.9%). Amp pushes straight to main. No controlled data exists.
- **Is batching worth it?** Trunk claims 3–5x throughput and 50–70% CI savings. Its own simulation shows +55% time to merge at batch 16, and Mergify's production dynamic batching showed no throughput gain. Batching mainly trades latency for cost.
- **Are semantic conflicts rare?** Mergify's isolated mode assumes "most pre-merge CI failures turn out to be flaky tests, not real semantic conflicts". Uber measured about a 40% breakage probability with 16 concurrent potentially-conflicting changes, and Google says mid-air collisions happen "most days". The answer depends on repo coupling.
- **Brief claim "landing as a service: nobody yet"**: refuted as stated. Meta's pushrebase is server-side landing with batching and auto-merge; GitHub, GitLab, Mergify, Trunk, Aviator and Graphite run queues as services; Uber and Google run submit as a service. What is still unshipped is agent-aware conflict hand-back and proof-based, per-path merge policy.
- **Brief claim "runs only the tests the change can affect"**: well supported. Static target determination is the norm, and Meta shows ML selection can cut a further two-thirds. But Buck2's own README warns that key-dependency changes produce "an infeasible number of targets", so selection does not remove the big-change problem.
- **The GitHub merge queue incident of 2026-04-23** is reported by a competitor (Trunk) and is absent from GitHub's April availability report. Treat it as plausible but unconfirmed.

---

## Open questions

1. What do Google's 2024–2026 TAP and presubmit numbers look like now that internal code agents exist? Is the automated share of commits far above the 60% of 2016?
2. What is Meta's current land rate through pushrebase, and the p50/p99 of the critical section? The source exports these metrics, but none are published.
3. Is there controlled data on agent-authored change failure rates by task type, not just tool-stamped versus unstamped?
4. How do strict queues behave with bursty arrivals, for example 200 agent PRs arriving in one minute after a planning step? None of the papers model bursts. Mergify says dynamic batching "doesn't fully absorb large bursts".
5. Can semantic conflict prediction (Uber's target-hash conflicts plus intent text) be good enough to land agent threads optimistically while keeping p below 1%?
6. Where did the brief's Anthropic CI numbers (25x CI jobs, test-selection rewrites) come from? I could not locate the source.
7. What exactly happened in the GitHub merge queue incident (the scope, and whether a GitHub postmortem exists)?
8. How should proof freshness be defined formally: commit-distance, impacted-target-distance or time?

---

## Sources (opened during this research)

| Title | Publisher / author | Date | URL |
|---|---|---|---|
| Taming Google-Scale Continuous Testing (PDF) | Memon et al., ICSE-SEIP | 2017 | https://huang.isis.vanderbilt.edu/cs8395-f23/paper/google-testing-icse-seip-17.pdf |
| Taming Google-Scale Continuous Testing (abstract page) | Google Research | 2017 | https://research.google/pubs/taming-google-scale-continuous-testing/ |
| Why Google Stores Billions of Lines of Code in a Single Repository (metadata page; full text 403) | Potvin & Levenberg, CACM | 2016-07 | https://research.google/pubs/why-google-stores-billions-of-lines-of-code-in-a-single-repository/ |
| Software Engineering at Google, ch. 23 Continuous Integration | Google / O'Reilly | 2020 | https://abseil.io/resources/swe-book/html/ch23.html |
| Software Engineering at Google, ch. 18 Build Systems | Google / O'Reilly | 2020 | https://abseil.io/resources/swe-book/html/ch18.html |
| Flaky Tests at Google and How We Mitigate Them | John Micco, Google Testing Blog | 2016-05-27 | https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html |
| Flake Aware Culprit Finding (page + PDF) | Henderson et al., ICST | 2023 | https://research.google/pubs/flake-aware-culprit-finding/ ; https://storage.googleapis.com/gweb-research2023-media/pubtools/6969.pdf |
| Keeping master green at scale (summary) | Adrian Colyer, The Morning Paper | 2019-04 | https://blog.acolyer.org/2019/04/18/keeping-master-green-at-scale/ |
| Bypassing Large Diffs in SubmitQueue | Uber Engineering | 2023-08-31 | https://www.uber.com/blog/bypassing-large-diffs-in-submitqueue/ |
| CI at Scale: Lean, Green, and Fast | Uber, arXiv 2501.03440 | 2025-01 | https://arxiv.org/html/2501.03440v2 |
| Predictive Test Selection (paper) | Machalica et al., arXiv 1810.05286 | 2018/2019 | https://arxiv.org/abs/1810.05286 ; https://arxiv.org/pdf/1810.05286 |
| Predictive test selection (blog) | Engineering at Meta | 2018-11-21 | https://engineering.fb.com/2018/11/21/developer-tools/predictive-test-selection/ |
| Probabilistic flakiness | Engineering at Meta | 2020-12-10 | https://engineering.fb.com/2020/12/10/developer-tools/probabilistic-flakiness/ |
| Rapid release at massive scale | Engineering at Meta (Chuck Rossi) | 2017-08-31 | https://engineering.fb.com/2017/08/31/web/rapid-release-at-massive-scale/ |
| Sapling: Source control that's user-friendly and scalable | Engineering at Meta | 2022-11-15 | https://engineering.fb.com/2022/11/15/open-source/sapling-source-control-scalable/ |
| Mononoke pushrebase lib.rs (source) | facebook/sapling, main | fetched 2026-10-12 | https://raw.githubusercontent.com/facebook/sapling/main/eden/mononoke/features/pushrebase/src/lib.rs |
| Mononoke pushrebase queue.rs (source) | facebook/sapling, main | fetched 2026-10-12 | https://raw.githubusercontent.com/facebook/sapling/main/eden/mononoke/features/pushrebase/src/queue.rs |
| Build faster with Buck2 | Engineering at Meta | 2023-04-06 | https://engineering.fb.com/2023/04/06/open-source/buck2-open-source-large-scale-build-system/ |
| Buck2 Change Detector README | facebookincubator | fetched 2026-10-12 | https://raw.githubusercontent.com/facebookincubator/buck2-change-detector/main/README.md |
| target-determinator README | bazel-contrib | fetched 2026-10-12 | https://raw.githubusercontent.com/bazel-contrib/target-determinator/main/README.md |
| Bazel Remote Execution overview | bazel.build | n.d. | https://bazel.build/remote/rbe |
| Nx affected | nx.dev | n.d. | https://nx.dev/ci/features/affected |
| Chromium CQ docs | Chromium | fetched 2026-10-12 | https://chromium.googlesource.com/chromium/src/+/main/docs/infra/cq.md |
| Zuul gating | Zuul docs | latest | https://zuul-ci.org/docs/zuul/latest/gating.html |
| GitLab merge trains | GitLab docs | latest | https://docs.gitlab.com/ci/pipelines/merge_trains/ |
| Managing a merge queue | GitHub Docs | current | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue |
| Pull request merge queue is now generally available | GitHub Changelog | 2023-07-12 | https://github.blog/changelog/2023-07-12-pull-request-merge-queue-is-now-generally-available/ |
| How GitHub uses merge queue to ship hundreds of changes every day | GitHub Blog | 2024-03-06 | https://github.blog/engineering/engineering-principles/how-github-uses-merge-queue-to-ship-hundreds-of-changes-every-day/ |
| Building Git infrastructure for agent-scale development | GitHub Blog (Brian Celenza) | 2026-10-06 | https://github.blog/engineering/infrastructure/building-git-infrastructure-for-agent-scale-development/ |
| GitHub availability report: April 2026 | GitHub Blog | 2026-05 | https://github.blog/news-insights/company-news/github-availability-report-april-2026/ |
| GitHub status incident feed (only recent entries) | githubstatus.com | fetched 2026-10-12 | https://www.githubstatus.com/history.atom |
| Successfully Merging the Work of 1000+ Developers | Shopify Engineering (Jack Li) | 2019-11-14 | https://shopify.engineering/successfully-merging-work-1000-developers |
| bors-ng README | bors-ng | fetched 2026-10-12 | https://raw.githubusercontent.com/bors-ng/bors-ng/master/README.md |
| rust-lang/bors README | rust-lang | fetched 2026-10-12 | https://raw.githubusercontent.com/rust-lang/bors/main/README.md |
| Rollups | Rust Forge | current | https://forge.rust-lang.org/release/rollups.html |
| Trunk Merge Queue optimizations | Trunk docs | current | https://docs.trunk.io/merge-queue/optimizations |
| Trunk parallel queues | Trunk docs | current | https://docs.trunk.io/merge-queue/optimizations/parallel-queues |
| Trunk batching | Trunk docs | current | https://docs.trunk.io/merge-queue/optimizations/batching |
| Merge fast or merge cheap | Trunk blog | 2025-06-13 | https://trunk.io/blog/merge-fast-or-merge-cheap-fine-tuning-merge-queues-to-handle-an-increase-in-prs-f |
| Outgrowing GitHub merge queue | Trunk blog | 2025-09-03 | https://trunk.io/blog/outgrowing-github-merge-queue |
| What Happens If a Merge Queue Builds on the Wrong Commit | Trunk blog | 2026-04-24 | https://trunk.io/blog/what-happens-if-a-merge-queue-builds-on-the-wrong-commit |
| Trunk Merge Queue now supports GitHub Stacked PRs | Trunk blog | 2026-07-30 | https://trunk.io/blog/trunk-merge-queue-now-supports-github-stacked-pull-requests |
| Trunk blog index | Trunk | fetched 2026-10-12 | https://trunk.io/blog |
| Mergify parallel checks | Mergify docs | current | https://docs.mergify.com/merge-queue/parallel-checks/ |
| Mergify blog index | Mergify | fetched 2026-10-12 | https://mergify.com/blog |
| AI-assisted PRs break main half as often as human ones | Mergify (Julien Danjou) | 2026-07-27 | https://mergify.com/blog/state-of-merge-queues-2026 |
| Merge Queues Were Built for Humans. AI Agents Need More. | Mergify (Julien Danjou) | 2026-07-13 | https://mergify.com/blog/merge-queues-and-ai-coding-agents |
| How we made our merge queue lower its own quality bar | Mergify | 2026-07-06 | https://mergify.com/blog/dynamic-merge-queue-batch-size |
| We Built a Merge Queue Mode That Skips the Safety Check on Purpose | Mergify | 2026-06-17 | https://mergify.com/blog/merge-queue-mode-skips-safety-check-on-purpose |
| How Agents Work With Parallel Agents | Mergify (Rémy Duthu) | 2026-06-08 | https://mergify.com/blog/how-agents-work-with-parallel-agents |
| Bun shipped 1M lines in nine days. The PR is the bottleneck now. | Mergify (Julien Danjou) | 2026-06-04 | https://mergify.com/blog/bun-million-line-pr-postmortem |
| Your Monorepo's Merge Queue Has a Concurrency Problem | Mergify (Mehdi Abaakouk) | 2026-04-10 | https://mergify.com/blog/monorepo-merge-queue-concurrency-problem |
| The Origin Story of Merge Queues | Mergify | 2025-09-10 | https://mergify.com/blog/the-origin-story-of-merge-queues |
| Aviator parallel mode | Aviator docs | current | https://docs.aviator.co/mergequeue/concepts/parallel-mode |
| Graphite merge queue | Graphite docs | current | https://graphite.com/docs/graphite-merge-queue |
| CloudBees Smart Tests | CloudBees | current | https://www.cloudbees.com/capabilities/cloudbees-smart-tests |
| Building a C compiler with a team of parallel Claudes | Anthropic Engineering | 2026-02-05 | https://www.anthropic.com/engineering/building-c-compiler |
| Anthropic Engineering index | Anthropic | fetched 2026-10-12 | https://www.anthropic.com/engineering |
| Claude blog index | Anthropic | fetched 2026-10-12 | https://claude.com/blog |
| claude.dev blog index | Anthropic | fetched 2026-10-12 | https://claude.dev/blog |
| How Block orchestrates Claude Fable across thousands of pull requests | Anthropic / Block | 2026-10-08 | https://claude.com/resources/articles/how-block-orchestrates-claude-fable-across-thousands-of-pull-requests |

Attempted but not readable: the CACM full text (403 on cacm.acm.org, the cacmb4 mirror, dl.acm.org and the archive), Graydon Hoare's "not rocket science" post (captcha, then 504), Uber's research page for the EuroSys paper (404), and the TAP PDF on the University of Michigan mirror (503; the Vanderbilt mirror worked).

# 81 — Pilot: semantic conflicts between concurrent agent-authored PRs (AIDev-pop, Python)

Run 2026-10-12, 14:25–15:20 UTC, with a hard time box. Artifacts are in `research/semconf/`: scripts, `results.jsonl`, `final_rows.json` (per-pair), `junit/` and `final_out.txt`.

## Bottom line

- **Pairs:** 156 attempted in 25 Python repos, 143 usable in 20 repos. All pairs are same-agent: Codex 79, Copilot 52, Devin 8, Cursor 4. Claude Code had only 1 pair, which was unusable.
- **Truly concurrent subset:** 105 pairs in 16 repos where neither head contains the other's landed commit. Of these, 6 were textual conflicts (6%, Wilson 95% CI 3–12%) and 99 merged cleanly.
- **Semantic conflicts: 0 of 99 clean concurrent merges** (95% Wilson upper bound 3.7%). Across all 124 clean usable merges it is also 0 (upper bound 3.0%). Two first-run candidates did not reproduce on re-run and were classed as flakes. A synthetic positive control was detected.
- **Pairs sharing at least one changed file:** 33 clean merges, 0 semantic conflicts, upper bound 10.4%.
- **Caveat:** the zero is bounded by weak test power, only-merged survivorship and hand-picked small repos (see Limitations). Treat it as "no evidence of frequent semantic conflict in small, both-merged, same-agent bursts", not as a population rate.

## Method (what was actually done)

1. **Pair selection** (`select_pairs.py`). From AIDev-pop `pull_request` + `repository`, I took non-fork repos with `language == Python` and **merged** agent PRs, keeping pairs in the same repo whose [created, merged] intervals overlap. That gave 2,447 pairs in 190 repos. Repos were picked by hand for small/medium size and a pytest suite likely to run offline: 32 were cloned and 25 had at least one pair attempted. Within a repo, pairs where both PRs touch `.py` were ranked by shared changed files, then shared directories. The cap was 8 pairs per repo (up to 27 in fast repos).
2. **Per pair** (`run_pairs.py`). Fetch `refs/pull/{A,B}/head` and take `merge-base(A,B)`. Stacked pairs (one head an ancestor of the other) are dropped. Then `git merge --no-ff B` into A:
   - On a conflict the pair is a **textual conflict**.
   - Otherwise pytest runs on A, B and A+B in a per-repo `uv` venv (Python 3.12). Settings: `--timeout=60` per test, 300 s per suite, `--continue-on-collection-errors`, JUnit output.
3. **Semantic conflict definition.** A test that fails in A+B but passes in every one of A and B where it exists. An A+B collection error also counts if the module ran tests in A or B and did not error there (`recompute.py`). Any candidate triggers a full re-run of A, B and A+B, and only failures that reproduce count. Comparing against the pair's own A/B results lets environment-caused red tests cancel out.
4. **Usable** means the A and B suites each finish within 300 s with at least one passing test.
5. **Concurrency check** (`check_seq.py`). I located each PR's landed commit on the default branch: a squash subject ending `(#N)`, or `Merge pull request #N`. A pair is **sequential** if one final head already contains the other's landed commit. Only non-sequential pairs are **truly concurrent**.
6. **Positive control.** On a json_repair clone I made a synthetic pair: A renames `from_file`→`from_path`, and B adds a test that calls `from_file`. The pair merges cleanly, and the pipeline flags `COLLECTION:tests.test_extra` as a semantic conflict.

## Results

| subset | pairs | repos | textual conflict (95% CI) | clean merges | semantic conflict (95% Wilson CI) |
|---|---|---|---|---|---|
| All usable | 143 | 20 | 19 (13%; 9%-20%) | 124 | 0 (0.0%; 0.0%-3.0%) |
| Truly concurrent (neither head contains the other's landed commit) | 105 | 16 | 6 (6%; 3%-12%) | 99 | 0 (0.0%; 0.0%-3.7%) |
| ... and share >=1 changed file | 39 | 13 | 6 (15%; 7%-30%) | 33 | 0 (0.0%; 0.0%-10.4%) |
| ... and >=20 tests pass in both A and B | 91 | 14 | 6 (7%; 3%-14%) | 85 | 0 (0.0%; 0.0%-4.3%) |

Usable pairs by repo (full table in `semconf/final_out.txt`):
- Lora-Manager 27, translate 20, lisa 11, Kiln 10, PyLabRobot 10.
- extending-move, enrichmcp, dpgen and vlmrun-hub 8 each; scoringengine 7.
- fabric-cicd 6, DDNS 6, workflows-py 4, klongpy 3, openai-agents-python 2.
- Five repos with 1 each.

Six attempted repos were unusable or partly unusable: KindleClippings, diffyscan, b2500-meter, django-dbbackup, numbagg and part of haliax. Their suites errored at collection or timed out. KToolBox hung on network access and was aborted.

Test power varies widely. The median number of tests passing in both A and B is 3,459 for translate, 960 for Kiln and 100–400 for most repos. It is only 4 for scoringengine (needs a database), 8 for dpgen and 18 for vlmrun-hub.

**Textual conflicts among truly concurrent pairs** (6 of 105 usable):
- Five pairs involve Kiln PR #355 against #352, #353, #354, #358 and #361. Every conflict is in `AGENTS.md`.
- `briangu/klongpy` #48 vs #33 (Codex): conflict in `setup.py`.
- `marin-community/haliax` #143 vs #142 also conflicted (`tests/test_namedarray_typing.py`), but its suite was unusable, so it is excluded.

**Semantic conflicts: none confirmed.** Two candidates failed only in the first run and did not reproduce on re-run, so both were classed as flakes:
- `briangu/klongpy` #40+#33: `test_sys_fn_timer::test_timer_return_1_cancel`
- `microsoft/lisa` #4056+#4062: `selftests.test_parallel::test_task_manager_immediate_scheduling`

Both are timing-sensitive tests on a loaded 4-core VM.

**Cross-agent pairs (textual check only).** Cross-agent pairs are rare in Python repos: 110 of 2,447 candidate pairs, mostly in heavy repos (deepmd-kit, WorkflowAI, airbyte, AutoGPT, mlflow). For deepmd-kit (Copilot × Codex) and WorkflowAI (Codex × Cursor) I ran `git merge-tree` without tests (`textual_only.py`). Result: 3/33 pairs conflict textually, all three sequential; 0/25 truly concurrent pairs conflict.

## Findings beyond the headline

- **AIDev "open-interval overlap" barely measures concurrency.** For 137 of 143 (96%) of usable pairs, the overlap by AIDev timestamps is under 6 minutes, and none overlap by 1 h or more. Many Codex/Copilot PRs are opened and merged within minutes; the work plausibly happened earlier in the agent sandbox. Concurrency has to be established from git divergence.
- **Most "textual conflicts" in naive pairing are artifacts of sequential landing.** Of the 19 textual conflicts among usable pairs, 13 involve a PR head that already contained the other PR's squash commit. Re-merging the original branch against its squashed copy conflicts on lines already reconciled upstream. Without it, the textual rate here is 13% (19/143); with it, 6% (6/105).
- **Concurrent textual conflicts cluster around "hub" PRs and shared docs.** Five of the six concurrent conflicts involve one Kiln PR (#355) that edited `AGENTS.md`. The sixth is `setup.py` in klongpy. No concurrent conflict was in core logic.
- **Repo shape drives everything.** Pairs come almost entirely from the same agent: 0 cross-agent pairs among the tested ones. Bursts of Codex tasks by one maintainer dominate (Lora-Manager, extending-move, enrichmcp, PyLabRobot). These PRs are small (among truly concurrent pairs the median is 3 files for A and 5 for B), and 66 of 105 concurrent pairs share no changed file.

## Limitations (read before citing)

- **Selection bias.** Repos were picked by hand for being installable and fast to test. Large, high-activity repos (mlflow, airbyte, sentry, AutoGPT), where concurrent agent PRs collide most, were excluded. The pairs are only those that both **merged**: any pair whose conflict caused one PR to be closed is missing, so semantic and textual conflict rates are biased downward. Pairs are clustered (~8 per repo, PRs reused across pairs), so the Wilson CIs, which assume independence, are too narrow.
- **Test power is weak and uneven.** Several suites are mostly red here (missing services or keys). A clean-and-green result only means no test that passed in both A and B broke. Coverage of the changed lines was not measured, so the true rate may exceed our bound for untested code.
- **Environment.** One venv per repo on Python 3.12, installed at one head, with dependencies assumed stable within the pair.
- **Merge model.** `git merge` of PR heads approximates what landing both PRs would have produced. Real history used squash merges and rebases.
- **Time box.** haliax and numbagg were cut off; only their completed pairs are included.

## What this means / next step

Under this pilot's design, semantic conflicts between concurrently developed, both-merged agent PRs were **not observed**: 0 of 99 clean, truly concurrent merges (Wilson 95% CI 0–3.7%), and 0 of 33 among pairs that edit a common file (CI 0–10.4%). That fits agent PRs being small and mostly file-disjoint. It does not establish rarity in general.

A credible full study would need four changes:
- Include closed-unmerged PRs.
- Pick pairs by git divergence, not AIDev time overlap.
- Restrict to pairs whose changed lines are covered by tests, measured with coverage.
- Add cross-agent pairs from big repos with containerized test environments.

Power math: at a true rate of 3%, 99 pairs would still show zero conflicts about 5% of the time (0.97^99 ≈ 0.05). A rate of a few percent needs several hundred *covered* clean pairs.

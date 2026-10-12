# 08 - Merge and conflict-resolution technology for many agents on one codebase

Researcher key: `08-merge-conflict-tech`. Written 2026-10-12.
Tags: **[read]** = verified from a page/PDF I opened (PDFs were downloaded and text-extracted with pdftotext when the fetcher could not decode them); **[secondary]** = coverage, search snippet, or a third party's restatement; **[inference]** = my reasoning.

Note on method: the shared web-search budget for this run ran out partway through, so later sources were reached by fetching URLs I already knew or found in pages I had read. The gaps this left are listed under Open questions.

---

## Summary

1. **Textual conflicts are the minority problem. Silent wrong merges are the expensive one.** The ASE 2024 evaluation (Schesch, Ernst et al.) replayed more than 6k Java merges that have test suites. Git's `ort` strategy merged 46% correctly, merged 3% *incorrectly* (clean merge, tests fail) and left 51% unhandled. Spork turned conflicts into merges at 54% correct / 11% incorrect. IntelliMerge reached 24% correct / **50% incorrect**. More automation produced more silent breakage. [read]
2. **Structured (AST) merge rarely fixes real conflicts on its own.** On Linux-kernel history, Mergiraf fully resolved 428 of the 7,415 merges that conflict under git: **5.8%**. Weave's own replay of 4,971 file merges gives 344 "wins" (**6.9%**) and 86 regressions. Structured merge mainly removes *false* conflicts: two adjacent edits, two new functions or imports in the same file, or a reformat alongside an edit. [read]
3. **Structured tools trade false positives against false negatives.** On 5,229 Java scenarios, Mergiraf vs Spork showed 290 vs 150 added false positives and 62 vs 107 added false negatives. The tools disagreed about whether a conflict existed in 11-12% of scenarios. [read]
4. **The best LLMs match the developer's resolution on only about half of real conflict hunks.** On Merge-Bench (7,938 hunks, 1,439 repos, 11 languages, 2026), Gemini 2.5 Pro scores 52.6% normalized-equivalent across languages and Claude Opus 4 scores 44.8%. Among the remaining hunks, models produced *different code* 34-42% of the time and only rarely left the conflict standing. A 14B GRPO-trained model (LLMergeJ) reaches 58.9% on Java. Quote: "The best models correctly resolve less than 60% of merge conflicts." [read]
5. **LLMs beat classical tools mostly because they always answer.** A July 2026 Java study with a calibrated judge reports LLM developer-match of 55-62% against 36.7% for AutoMerge, the best classical tool. Among cases a tool *did* resolve, jDime was at 54.8%, about the same as the LLMs. Classical tools abstain on 20-90% of conflicts and LLMs abstain on none. The judge accepted 4 of 5 structurally invalid resolutions, so "structural correctness must not be delegated to an LLM." [read]
6. **Semantic conflicts are real, under-measured, and mostly undetected.** Crystal (TSE 2013, 9 projects) found that 16% of merges conflicted textually, 1% caused build failures and 6% caused test failures. Higher-order conflicts were 33% of all conflicts, and conflicts persisted 3 days on average. A 2023 TOSEM study of 117,218 Java merges found 15,886 textual conflicts but only 79 build and 33 test conflicts, which is an undercount set by its method. Test generation (SAM) detected only 9 of 28 known semantic conflicts. [read]
7. **Jujutsu makes conflicts *data*.** A conflicted rebase succeeds. The commit stores an odd-length list of trees (A+(C-B)+(E-D)), conflicts simplify algebraically when rebased again, and descendants auto-rebase. The operation log gives lock-free concurrent operations: divergent operation heads are 3-way-merged and bookmark conflicts are stored, not raised. Change IDs survive rewrites, and divergence ("one change, several visible commits") is "not an error." This is the best existing model for a landing service that must never block. [read]
8. **Patch theory (Pijul/Darcs) gives commutation and associativity, but nobody has used it at forge scale.** Pijul is a CRDT over a graph of lines whose conflicts are states of that graph. Darcs' exponential-merge problem is "No[t]" fixed. [read]
9. **CRDTs guarantee convergence, not correctness.** Zed's text CRDT, Automerge and DeltaDB merge concurrent character edits deterministically. Automerge's own docs say concurrent writes to the same field pick a "winner" by operation ID. Ink & Switch's Upwelling concluded that automatic merging is "necessary but not sufficient": semantic conflicts need review, so drafts should be small and short-lived. Zed's public DeltaDB posts never describe how semantically conflicting agent edits are resolved. [read]
10. **Production multi-agent systems found that locking does not scale. Optimistic concurrency plus planners worked.** Cursor (Jan 2026) saw locks make "Twenty agents ... slow down to the effective throughput of two or three." It switched to optimistic concurrency and then to a planner/worker hierarchy. It dropped a dedicated integrator role because it "created more bottlenecks than it solved." It reports hundreds of workers pushing to one branch "with minimal conflicts". Anthropic's 16-agent C compiler used file-based task locks in git and reports "Merge conflicts are frequent, but Claude is smart enough to figure that out." [read]
11. **Conflict avoidance tooling for agents exists but is advisory and immature.** Weave's entity claims are "advisory, not enforced", and "Crashed agents aren't reaped". Clash (65 stars) runs `git merge-tree` across worktrees as a Claude Code PreToolUse hook. Claude Code agent-teams docs simply say "Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files." [read]
12. **Verdict on "the forge should automatically resolve conflicts":** realistic for false conflicts (structured merge plus deterministic checks), for trivial hunks (78% accuracy on 3 lines or fewer even in 2021), and as *agent re-execution of intent* when the losing thread re-runs its task on the new base. It fails when an LLM picks a resolution unaided at hunk level (about 50% match, with about 35-40% of outputs being different code), and on any conflict whose breakage only shows at build, test or runtime. The forge must treat a resolved conflict as a **new change that must re-earn its proof**, never as a pass-through. [inference grounded in the numbers above]
13. **Brief claims verified:** the Zed DeltaDB "conflict-free replicated worktrees" wording is [read]. ERSC's "first class conflicts, fine-grained ACLs" and "land thousands of commits per second" claims are [read] from ERSC's May 2026 post, but ERSC's Sept 2026 post says jj-native protocol support is "future work, not available yet."

---

## Detailed findings

### A. How often conflicts happen, and what kinds

**Crystal / "Early Detection of Collaboration Conflicts and Risks"** (Brun, Holmes, Ernst, Notkin, IEEE TSE 39(10), Oct 2013) [read]
- Nine open-source systems totaling 3.4M LOC. Conflicts "(1) are the norm, rather than the exception, (2) persist, on average, 3 days, and (3) are higher-order 33% of the time."
- For Git, Perl5 and Voldemort, which have runnable test suites: "76% of merges completed cleanly, 16% of merges resulted in a textual conflict ..., 1% of merges resulted in a build failure ..., and 6% of merges resulted in a test failure." Perl5 alone showed test failures on 28% of merges.
- Across all historical commit points where developers *could* have merged, 19% would have produced a textual conflict.
- Technique: **speculative analysis**. Crystal performs the merge, build and test in the background between developers' copies and shows the result before anyone actually merges.
- Forge implication: this is a 2013 prototype of "agents see each other early" (brief idea 6). It covers semantic conflicts too, because it speculatively *runs tests* on the combined state rather than only diffing.

**"A Characterization Study of Merge Conflicts in Java Projects"** (Shen, Gulzar, He, Meng, ACM TOSEM 32(2), March 2023) [read]
- 208 Java repos, 117,218 merge scenarios. Results: 15,886 with textual conflicts (13.6%), 79 with build conflicts and 33 with test conflicts.
- The method only checks build and test conflicts when the textual merge succeeded *and* both parents built and passed tests, so the higher-order counts are lower bounds [inference from their method description, read].
- 65 of 385 sampled textual conflicts (17%) were false positives from adjacent-line edits.
- "developers resolved 64% of true textual conflicts by keeping complete edits from either a left or right branch"; 20% took L+R.
- Build conflicts arise when co-applying edits "broke any def-use link", for example one side renames `foo()` to `bar()` while the other adds a call to `foo()`. "85% (39/46) of test conflicts happened, as the co-application of edits broke def-use links ... or led to mismatches between test oracles and software implementation."
- Forge implication: the dominant semantic-conflict mechanism is a **def-use break across the two changes**. A forge with a symbol index can check that cheaply (rename or delete of symbol X vs. new references to X) before running any tests.

**"Evaluation of Version Control Merge Tools"** (Schesch, Featherman, Yang, Roberts, Ernst, ASE 2024; slides and paper PDF) [read]
- New methodology: a clean merge counts as *correct* only if tests pass. The evaluation also includes merges from deleted feature branches, and it prices incorrect merges with a cost factor k: Cost(T) = numUnhandled + k·numIncorrect.
- Headline table ("Dataset: >6k merges with good test coverage"):

| Tool | Correct merge | Incorrect merge (clean but tests fail) | Conflict/unhandled |
|---|---|---|---|
| Git merge (ort) | 46% (2,748) | 3% (157) | 51% (3,078) |
| Spork | 54% | 11% | 35% |
| IntelliMerge | 24% | 50% | 26% |

- "A merge algorithm that merely augments Git's handling of import statements usually outperforms Spork, IntelliMerge, and other tools." Their recommendation is to find "simple solutions to common problems." Their tools are public at github.com/plume-lib/merging.
- "Problem 3: Feature branches are harder": merges reconstructed from deleted feature branches show lower effort reduction than main-branch merges, so "Previous evaluations are not indicative of real world merges."
- They describe Spork's implementation as "buggy" and IntelliMerge's as "buggy and non deterministic". jDime "discards comments, file headers and arbitrarily reorders methods and fields" and "Often requires more than 15 minutes for a merge."
- Forge implication: agent branches are short-lived feature branches, which is the harder case. Any automated resolver must be scored by **(correct, incorrect, abstain)** with incorrect weighted heavily, never by "conflicts removed."

### B. Semistructured and structured (AST) merge

**Spork** (Larsén, Falleri, Baudry, Monperrus, IEEE TSE 2022, arXiv 2202.05329) [read, abstract]
- Structured merge for Java that preserves formatting. Evaluated on 1,740 file merges from 119 projects. It "preserves formatting to a significantly greater degree" and has lower worst-case runtimes than the prior state of the art.

**Mergiraf** (mergiraf.org docs; LWN, 31 Oct 2025) [read]
- Rust, GPLv3. Started by Antonin Delpeuch. It supports 30 programming languages plus 11 data formats, including JSON, YAML, TOML, `go.mod` and `requirements.txt`.
- Pipeline ("follows the structured-merge design of Spork"):
  1. Line-based merge first. If it is clean, return it.
  2. Otherwise parse base, left and right with tree-sitter; "If a parsing error occurs in any of the three revisions, the algorithm aborts and falls back on line-based merging."
  3. GumTree matching on base–left, base–right and left–right, with left–right kept strict because false matches "can have quite detrimental effects."
  4. Convert to Spork's Parent-Child-Successor triples and merge them in 3DM style.
  5. Rebuild the tree with a diff3 fallback on inconsistencies.
  6. Post-checks for delete/modify (a "known issue of the 3DM merge algorithm") and duplicate signatures.
- Commutative parents (Rust struct fields, Java class members, imports, JSON object keys) can be merged order-independently. Mergiraf still *refuses* order-dependent inserts: two sides adding different statements to the same block, or different arguments to the same function, remain a conflict.
- Documented correctness risk: Java member order can matter through reflection, and C struct member order can matter too. "a merge could be syntactically valid but change program behavior." LWN also notes a known bug: `#[repr]` in Rust is not respected.
- `mergiraf review` shows what it auto-resolved. It integrates as a git merge driver (affecting merge, rebase, cherry-pick and revert), and jj lists it as an out-of-the-box `jj resolve` tool [read, jj config docs].
- **Real-world yield:** in Linux kernel history, "7,415 merge commits produced conflicts under Git's default merge. Mergiraf fully resolved 428 of them, while 6,987 still conflicted" (5.8%). The author expects it to reduce manual merges "by a small amount." A commenter notes it "very often falls back on plain line-based merges for C code, due to the difficulty of parsing macros." [read, LWN]

**LastMerge** (Duarte, Borba, Cavalcanti, arXiv 2507.19687, July 2025) [read, PDF text]
- Replayed 5,229 Java merge scenarios (13,675 mutually modified files) from Schesch et al.'s dataset with jDime, Spork, LastMerge (generic) and Mergiraf (generic).
- Disagreement on whether a conflict exists: 7.5% for jDime vs LastMerge and 11.3% (12.22% in the prose) for Spork vs Mergiraf.
- Added false positives (aFP) / added false negatives (aFN): jDime 153/29 vs LastMerge 130/85; **Spork 150/107 vs Mergiraf 290/62**.
- The authors attribute most of the gaps to configuration and auto-tuning (Mergiraf tries unstructured first), not to genericity. "generic structured merge tools can effectively replace language-specific ones."
- They also note that Mergiraf always reports delete/edit conflicts, which costs false positives. Such conflicts "only lead to issues when the changes introduced interfere semantically, thus leading into build-time errors."

**Weave** (Ataraxy-Labs/weave README; HN thread, ~Mar 2026, 188 points) [read]
- An entity-level merge driver. Tree-sitter parses files into functions, classes and keys, which are matched by name, type and scope. Changes to different entities auto-resolve. When both sides change the same entity, it does an intra-entity merge and conflicts only if that merge is incompatible. It deliberately conflicts when two sides add different decorators, because "stack order is a semantic decision".
- It claims 38 languages, MIT/Apache-2.0, about 1.3k stars, and benchmark engine version 0.5.3 regenerated 2026-09-01.
- Synthetic 31-scenario suite: Weave 29/29 mergeable cases, git 15/29, Mergiraf 26/29.
- **Real-merge replay** (first 500 merge commits per repo):

| Repo | File merges | Weave wins | Regressions | Human match (of wins) |
|---|---|---|---|---|
| git/git | 1,701 | 183 | 23 | 72% |
| Flask | 67 | 15 | 1 | 33% |
| CPython | 256 | 11 | 10 | 45% |
| Go | 1,667 | 120 | 37 | 33% |
| TypeScript | 1,280 | 15 | 15 | 53% |
| **Total** | 4,971 | 344 (6.9%) | 86 | — |

- Only 33-72% of the "wins" were byte-identical to what the developer wrote. "0.5.3 conflicts on purpose where 0.5.2 sometimes resolved silently."
- `weave check` looks for "cross-file breakage a per-file merge driver can't see (e.g. a rename in a.py whose surviving caller lives in b.py)". `weave land` gates files for "lost changes, duplicates, and invalid syntax" and the README states that it "does not establish cross-file or runtime correctness."
- MCP tools for agents: `weave_preview`, `weave_explain`, `weave_check`, `weave_land` (which labels files PROVEN/VERIFIED/REFUSED) and `weave_patch`. An Automerge-based `weave-crdt` layer for live entity claims sits behind `WEAVE_EXPERIMENTAL=1`. Claims are "advisory, not enforced" and "Crashed agents aren't reaped."
- HN pushback [read]: "It's still possible for two commits to conflict only semantically, one obsoleting the other" (orbisvicis). "This will not work for refactors" (gritzko, on structural hashing). Agents can already resolve merges, but "it often takes multiple extra rounds" (vidarh). There were also doubts that the launch was organic. The merge step takes 5-67 ms according to the author.

**jDime / IntelliMerge / FSTMerge** (via the Schesch and July-2026 judge studies) [read]
- In the 2026 Java judge study, the developer-match rate *among cases each tool resolved*, with its abstention count out of 49 true conflicts, was: jDime 54.8% (16 punts), IntelliMerge 48.1% (22 punts), FSTMerge 28.6% (18 punts), AutoMerge 47.4% (10 punts), KDiff3 50.0% (45 punts).

### C. Patch theory and first-class conflicts

**Pijul** (pijul.org manual: "Theory", "Why Pijul") [read]
- The repository is a graph of lines. Vertices are identified by (introducing change, position). Deletions relabel edges, so the store is append-only.
- "any two patches ... that could be produced independently commute". Version identifiers are order-independent: hashes are multiplied in a group.
- Conflicts are graph states: two alive vertices with no path between them, a cycle, or "zombie" vertices. Hence "Pijul implements a conflict-free replicated datatype."
- Pijul claims change application is associative, whereas "Git doesn't guarantee the associative change property, even if A, B, and C do not conflict."
- No independent benchmarks are given. The manual admits some Darcs features (e.g. `darcs replace`) are missing.

**Darcs** (darcs.net FAQ/Performance) [read]
- "Darcs 2 (introduced in 2008-04) reduces the [number] of scenarios that will trigger an exponential merge." `darcs rebase` (2.10) helps avoid the problem. Is it fixed? The FAQ answers "No."
- Forge implication [inference]: patch theory's guarantees (commutation, cherry-pick without identity change) are attractive for "land any subset of compatible threads in any order". But neither Pijul nor Darcs has evidence of operating at thousands of changes per hour, and both treat conflicts *textually*, so semantic conflicts are untouched.

**Jujutsu (jj)** (docs.jj-vcs.dev: conflicts, technical/conflicts, technical/concurrency, glossary, divergence guide, config) [read]
- **Conflicts as committed state:** "Jujutsu can record conflicted states in commits." A conflicted rebase still succeeds. The stored form is logical, so "rebasing a conflict doesn't result in a nested conflict markers." Conflicts can have arbitrarily many sides.
- **Representation:** an "ordered list of tree objects linked from the commit"; "There will always be an odd number of trees". Five trees A..E mean A+(C-B)+(E-D). Rebasing a conflicted commit C+(B-A) onto D simplifies to D+(B-A) "by removing canceling terms."
- **Same-change rule:** when all sides make the same change, jj auto-resolves by default (`merge.same-change = accept`). The docs admit this is "lossy in terms of conflict algebra" (bug #6369).
- **Auto-rebase:** descendants of rewritten commits are rewritten automatically, and the git `--continue` dance is replaced by "check out the conflicted commit, resolve conflicts, and amend."
- **Operation log / lock-free concurrency:** "The most important piece in the lock-free design is the 'operation log'." Each command loads the latest operation, works on that snapshot, and commits on top. "The operation cannot fail to commit." When the log has multiple heads, jj does "a 3-way merge of the view objects based on their common ancestor". Bookmark conflicts are stored, shown with `??` in `jj log`, and block only commands that need an unambiguous target. Caveat: with the Git backend "repository corruption is possible because the backend is not entirely lock-free."
- **Change IDs vs commit IDs:** a change ID (16 bytes, often random) is stable across rewrites; a commit ID is the content hash. "A divergent change is a change that has more than one visible commit," for example when two agents amend the same change. "Divergence isn't an error." `jj converge` (experimental) attempts automatic resolution.
- Forge implication [inference]: jj's model maps closely onto a landing service:
  1. A thread is a change ID that survives restacks.
  2. A failed rebase onto a new trunk produces a *conflicted commit*, not an error, so the landing service never blocks. It records the conflict and wakes the thread.
  3. Concurrent ref updates become stored ref conflicts rather than lost updates.
  4. The operation log gives undo and audit for every landing action.

**ERSC (East River Source Control)** [read]
- May 4, 2026 post "An update on ERSC availability" (Benjamin Brittain): the model includes "first class conflicts, fine-grained ACLs, and backwards compatibility with git"; storage is "a distributed system that can land thousands of commits per second" (no benchmark given); "there will be stacked diffs"; review is "coming soon".
- Sept 1, 2026: jj creator Martin von Zweigbergk joins as CTO. ERSC Storage private beta is planned for later in September 2026.
- Sept 10, 2026 post "What comes after git" (Steve Klabnik): ERSC does not "store git repositories on our servers". jj-native protocol support is "future work, not available yet". Agentic development causes "more merge contention."
- **Brief verification:** the brief's ERSC row is accurate to ERSC's own May post. Nothing public yet shows first-class conflicts working on the server side.

### D. CRDT-based code editing and local-first version control

**Zed text CRDT** (Nathan Sobo, "How CRDTs make multiplayer text editing part of Zed's DNA", Dec 1 2022) [read]
- Anchors are (insertion id, offset) pairs. Inserted text is immutable, deletions are tombstones, and concurrent inserts at the same spot are ordered by Lamport timestamp and then replica ID. The post notes that "it doesn't matter how we order the insertions," as long as every replica uses the same order. That is convergence, not meaning.

**DeltaDB / Delta** (Zed blog: Aug 20 2025 Sequoia post; "Software Is Made Between Commits", Jun 11 2026; "Xanadu Was Waiting for Agents", Sep 1 2026; "Replace PRs with Delta - Now in Public Beta", Sep 16 2026) [read]
- DeltaDB "uses CRDTs to incrementally record and synchronize changes as they happen" and "embeds conflict-free replicated worktrees" so "many people and agents" can edit the same files at once. "Every operation by every human and agent is named by an actor plus a Lamport timestamp, forever." States between commits are named by base commit plus the set of applied delta IDs.
- Git stays at the edge: "A commit remains the checkpoint you push, pull, and build from." Landing is done "by asking an agent". Review subthreads get "isolated copy of the parent thread's worktrees."
- **None of the four posts says how semantically conflicting concurrent agent edits are detected or resolved.** [read: absence confirmed across all four]
- Brief claim "embeds conflict-free replicated worktrees" is **verified** [read].

**Automerge** (automerge.org docs, "Conflicts") [read]
- Different properties merge cleanly. For concurrent assignment to the same property, "Automerge picks one of the concurrently written values as the 'winner'". The winner is chosen by operation ID (counter, then actor ID), not wall-clock time. Losers remain visible via `getConflicts`. For text, "Automerge preserves all the insertions and deletions."

**Upwelling** (Ink & Switch, March 2023; McKelvey, Jenson, Wagner, Cook, Kleppmann) [read]
- Real-time collaboration creates a "fishbowl effect", so writers want private drafts. Upwelling uses layers: unmerged layers are "drafts" with a stated intent, and merged layers form a stack. Merging a draft rebases it into every other open draft ("floating drafts").
- Distinguishes syntactic from semantic conflicts. Automerge resolves the former mechanically, sometimes awkwardly. Semantic conflicts "cannot be reliably detected automatically", so review is required. Social avoidance: name drafts clearly and keep them "small and short-lived."
- Lessons: "automatic merging is necessary but not sufficient"; "Keep layers independent", because dependent drafts were harder and raised conflict risk; the prototype "does not yet enforce one merge at a time," which the authors call a gap.

**Patchwork** (Ink & Switch, 2024-2026 lab notebook) [read]
- Lightweight branches with "no branching from branches". History is captured exactly by Automerge, so diffs come from edit history rather than heuristics. AI "style bots" edit on branches and appear as users in history. Bots that leave rationale made accept/reject decisions easier. AI-generated change summaries were "a remarkably useful way to understand writing edits at a high level." The notebook does not cover conflict-resolution UI or coordination among multiple bots.

**Eg-walker** (Gentle and Kleppmann, EuroSys 2025, arXiv 2409.14252) [read, abstract]
- A text CRDT/OT hybrid. Merging long-running branches is "orders of magnitude faster" than OT, with an order of magnitude less steady-state memory than existing CRDTs. This makes branch-style asynchronous merging feasible on a CRDT substrate.

Forge implication [inference]: CRDTs answer "how do bytes converge" without coordination. For code they buy nothing on semantics. Two agents' interleaved characters inside one function converge to an identical, possibly nonsensical, function on every replica. CRDT worktrees are a good substrate for *recording* and *anchoring*. They still need the same proof gate as git merges, and arguably a stronger one, because they never raise a conflict at all.

### E. ML and LLM conflict resolution: the numbers

| Work | Date / venue | Setting | Headline accuracy | Tag |
|---|---|---|---|---|
| DeepMerge (Dinella et al.) | 2021, TSE 2022 | 8,719 non-trivial JS merges | 37% correct on held-out (semistructured: 4%); 78% on merges of 3 lines or fewer (about 24% of data) | [read] |
| MergeBERT (Svyatkovskiy et al., MSR) | ESEC/FSE 2022 | Java, JS, TS, C# | 63-68% accuracy; user study with 25 devs, 122 conflicts: acceptance higher than metrics | [read] |
| Gmerge (Zhang, Mytkowicz, Kaufman, Piskac, Lahiri) | arXiv Nov 2021 / ISSTA 2022 | Microsoft Edge fork, GPT-3 k-shot | 64.6% (245/379) on Edge *semantic* merge conflicts after 10 trials vs 37.2% with 1 trial; header-file textual conflicts 60.0% vs a DSL's 91.8% | [read] |
| ConGra (Zhang, Su, Ye, Qian, HKU) | arXiv Sep 2024 | 44,948 conflicts, 34 projects, C/C++/Java/Python | Llama3-8B 72-83% accuracy by language; DeepSeek-V2 Java 84.4%; longer context did not help; code models no better; adding context often *hurt* | [read] |
| MergeGen vs SBCR (Campos Junior, Murta) | arXiv May 2026 | 6,269 + 47,363 chunks; Java/C#/JS/TS | MergeGen (CodeT5) 55% perfect match vs search-based 19.6%; text similarity only, no compile or test | [read] |
| Rover (Zhang et al., HKU) | arXiv May 2026 | program-analysis context (Multi-layer CPG) + LLM | +13.3% lexical similarity over plain Qwen3-30B; coverage 339/343 vs WizardMerge 311/343; high-similarity outputs only 78% acceptable on manual semantic check | [read] |
| Merge-Bench (Schesch, Ernst) | arXiv May 2026 / ICPR 2026 | 7,938 hunks (20 lines or fewer), 1,439 repos, 11 langs | All languages, normalized-equivalent: Gemini 2.5 Pro 52.6%, o3 Pro 45.1%, Claude Opus 4 44.8%, R1-0528 36.5%, Grok 4 31.7%. Java: Gemini 62.5%, LLMergeJ-14B 58.9%, o3 Pro 54.3%, Opus 4 51.2% | [read] |
| Calibrated LLM-judge Java study (Bowen Shen) | arXiv Jul 2026 | ConflictBench Java; gpt-5.4, gemini-3.5-flash | 55.1-61.7% developer-match on true conflicts (lower bound; judge precision 100%, recall 64.6%) vs AutoMerge 36.7% overall | [read] |

Key details:
- **Merge-Bench failure modes** [read]. Across all languages Gemini 2.5 Pro produced *different code* on 42.1% of hunks and left the conflict on 5.3%. Claude Opus 4 produced different code on 34.5% and kept the conflict on 20.4%. Models that answer more also answer wrong more. Hunks are capped at 20 lines and 512 tokens, and the authors concede "results may overestimate performance on all merges." Ground truth is the developer's merge, which "may itself have been wrong." Java, PHP and Python are easiest and C is hardest.
- **LLMergeJ** [read] is DeepSeek-R1-distilled Qwen 14B, trained with GRPO and LoRA on 3,424 Java conflicts. It reaches 48.8% exact and 58.9% normalized on Java, second only to Gemini 2.5 Pro.
- **Calibrated judge study** [read]: "LLMs' advantage comes almost entirely from coverage, not raw accuracy." Deterministic structural validity was 95.8% on true conflicts. The LLM judge accepted 4 of the 5 invalid outputs.
- **Rover's validation** [read]: replacing ground truth with model output and checking by hand gave 78% acceptable for high-similarity outputs, 59% for medium and 2% for low. String similarity is a weak proxy, and even "high similarity" fails semantically about 1 time in 5.
- **MergeGen vs SBCR** [read]: "Neither paradigm is a silver bullet". "the GenAI paradigm ... tends to fail loudly, whereas the SBSE paradigm can fail silently."
- The Rover paper cites a prior study: "75% of the conflicting merge scenarios take up to 1.77 hours to resolve" [secondary, cited within Rover].

What none of these measure [read, by absence]: whether the resolved *program* builds and passes tests. Only Schesch et al. (ASE 2024) and Crystal score merges by tests. The LLM benchmarks score text against the developer's choice.

### F. Semantic conflicts: definition, detection, frequency

- **Definition** (Horwitz et al. 1989, as quoted in SAM) [read]: two contributions "semantically conflict ... when the specifications they are individually supposed to satisfy are not jointly satisfied by the program that integrates them."
- **SAM, "Detecting semantic conflicts with unit tests"** (Da Silva, Borba, Maciel, Mahmood, Berger et al., arXiv Oct 2023; JSS 214, 2024) [read]: 85 change pairs from 51 merge scenarios, 28 with interference. The best configuration (EvoSuite plus Differential EvoSuite plus testability transformations) detected **9 of 28**. Even targeted test generation misses about two-thirds.
- **SafeMerge, "Verifying Semantic Conflict-Freedom in Three-Way Program Merges"** (Sousa, Dillig, Lahiri, arXiv Feb 2018 / OOPSLA 2018) [read, abstract]: compositional relational verification on 52 real merge scenarios. It "outperforms syntactic conflict-freedom checks". Research-grade, Java/C#-like languages.
- **Def-use breaks dominate**: build conflicts come from "broke any def-use link"; 85% of test conflicts come from def-use breaks or test-oracle mismatches (Shen et al. 2023) [read].
- **Frequency estimates disagree by about two orders of magnitude** [read]. Crystal found 7% of merges with build or test failure in three well-tested projects (28% in Perl5). Shen et al. found 0.1% of 117k merges. Schesch et al. found 3% incorrect clean merges for git, rising to 11% (Spork) and 50% (IntelliMerge) as tools get more aggressive. [inference] The spread depends on test-suite strength and on what population the merges come from. In every study the rate rises when more conflicts are auto-resolved.
- [inference] Agent fleets raise the semantic-conflict rate further. Many concurrent changes against a fast-moving trunk mean each change's assumptions go stale faster, and agents commonly rename or refactor broadly.

### G. Conflict avoidance by coordination (leases, intent, ownership)

**Anthropic, "Building a C compiler with a team of parallel Claudes"** (Nicholas Carlini, Feb 5 2026) [read]
- 16 agents and nearly 2,000 Claude Code sessions, costing about $20,000. "Claude takes a 'lock' on a task by writing a text file to current_tasks/". "If two agents try to claim the same task, git's synchronization forces the second agent to pick a different one." Each agent pulls, merges, pushes and removes its lock. There was no orchestrator.
- "Merge conflicts are frequent, but Claude is smart enough to figure that out." No rate is given.
- When all agents hit the same Linux-kernel bug, the fix was to use GCC as an oracle so that "each agent could fix different bugs in different files". In other words, the work was partitioned to avoid collisions.

**Cursor, "Scaling long-running autonomous coding"** (Wilson Lin, Jan 14 2026) [read]
- Locks failed. "Agents would hold locks for too long, or forget to release them entirely," and "Twenty agents would slow down to the effective throughput of two or three." Agents could "fail while holding locks."
- Optimistic concurrency ("writes would fail if the state had changed since they last read it") was "simpler and more robust" but did not fix risk-averse behaviour.
- The final design uses planners (which can spawn sub-planners), workers that "finish assigned tasks without coordinating with other workers", and a judge.
- The integrator role was removed: it "created more bottlenecks than it solved"; "Workers were already capable of handling conflicts themselves." Hundreds of workers push to the same branch "with minimal conflicts."
- Scale: browser with more than 1M LOC; Windows 7 emulator with 14.6K commits and 1.2M LOC; Excel clone with 12K commits and 1.6M LOC.

**Claude Code agent teams docs** (code.claude.com, current) [read]
- "Task claiming uses file locking to prevent race conditions". "Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files." Same-file edits are listed as a case where teams are *less* effective.

**Weave entity claims** [read]: advisory CRDT-backed claims; no reaping of crashed agents; experimental.

**Clash** (github.com/clash-sh/clash) [read]: finds all worktrees and simulates pairwise 3-way merges with `git merge-tree` via gix ("100% read-only"). It runs as a Claude Code `PreToolUse` hook on Write/Edit/MultiEdit. 65 stars.

**Cursor worktrees docs** [read]: each agent gets its own checkout, and `/best-of-n` runs N candidates in isolated worktrees but "does not merge changes back ... for you". The docs say nothing about conflict handling. Worktrees are capped at 25 per machine by default.

**Crystal's speculative merging** (above) [read] is the academic precedent for continuous overlap detection that includes build and test.

---

## Pain points for agentic-scale dev

1. **The conflict rate scales with concurrency and staleness.** Crystal found that 19% of potential merge points conflicted, even with human cadence and few developers [read]. With N agents against one trunk, pairwise overlap grows roughly as N² [inference].
2. **Retry loops waste tokens and wall-clock time.** A conflict costs "multiple extra rounds" (HN) [read], and Amp-style "rebase, test, push, repeat if the branch moved" serialises on the trunk (brief).
3. **Locks do not survive agents.** Agents forget, crash or hoard locks. Cursor saw 20 agents perform like 2-3, and Weave admits "Crashed agents aren't reaped." [read]
4. **Silent wrong merges.** More automatic resolution means more clean-but-broken merges: Spork 11% and IntelliMerge 50% vs git's 3% [read]. LLM resolvers produce *different code* on 34-42% of hunks [read].
5. **Tests are a weak oracle for interference.** Generated tests catch 9 of 28 semantic conflicts [read]. A forge that "merges on proof" inherits the blind spots of that proof.
6. **Structured merge has a parse cliff.** C macros and preprocessor code fall back to line merge. Languages differ on whether member order is semantic. Parse failures abort to diff3 [read].
7. **Ground truth is soft.** Benchmarks score against what a human committed, which may itself be wrong. Reported LLM accuracies are not "would compile and pass tests" [read].
8. **CRDT worktrees never say "conflict."** They converge byte-wise, so semantic collisions are pushed entirely to later verification [inference from read sources].

## How orgs are solving them

- **Partition the work to avoid conflicts** [read]. Anthropic used task locks and a GCC oracle to spread bugs. Claude Code recommends file ownership. Cursor's planners cut work into independent tasks.
- **Optimistic concurrency instead of locks** [read]. Cursor uses fail-on-stale-write. jj's operation log is lock-free and stores conflicts instead of erroring.
- **Let each agent resolve its own conflicts** [read]. Cursor dropped a central integrator; Anthropic's agents merge as part of their loop.
- **Structured merge drivers to remove false conflicts** [read]. Mergiraf works as a git or jj driver. Weave adds MCP tools such as `weave_preview` (dry-run) and `weave_check` (cross-file rename and caller check).
- **Speculative overlap detection** [read]. Clash runs `git merge-tree` as a pre-edit hook; Crystal did background merge, build and test.
- **Abstain rather than guess** [read]. Mergiraf "prefers to keep conflict markers in the file when a resolution looks suspicious". Weave 0.5.3 "conflicts on purpose where 0.5.2 sometimes resolved silently". Weave refuses to merge decorator order.
- **Deterministic checks around LLM output** [read]. The 2026 judge study pairs a generate-validate-retry agent with a Java parser and duplicate-declaration checks, because LLM judges wave through invalid code.
- **Keep changes small and short-lived** [read]. Upwelling floats drafts on the latest stack and keeps them independent.

---

## Implications for a future forge

The numbers suggest a **tiered resolver plus a mandatory re-proof**, not a single "auto-resolve" feature.

1. **Make conflicts first-class stored objects (the jj model).**
   - A landing attempt that conflicts should *succeed in recording* a conflicted change (jj's odd-length tree list) and attach it to the thread, rather than failing a job.
   - Use stable change IDs per thread so restacks do not break evidence and comment anchors.
   - Store ref-update races as ref conflicts in an operation log, so nothing is lost and every landing action can be undone. [inference from jj docs, read]

2. **Use a resolution ladder, cheapest and safest first, with abstention allowed at every rung.**
   1. git `ort` plus small targeted heuristics (imports, version numbers). Schesch et al. show these beat complex tools on effort reduction once incorrect merges are priced in.
   2. Structured merge (Mergiraf or Weave) for false conflicts: independent entities, commutative members, imports, JSON/YAML keys. Expect it to clear only about 5-7% of real conflicts, but nearly free.
   3. **Intent replay instead of hunk patching.** Hand the losing thread the winner's intent and diff, plus a symbol-level account of what moved underneath. The thread then re-applies *its task*, not a text hunk, in its own sandbox. This is the brief's idea 2 and the pattern Cursor and Anthropic converged on.
   4. LLM hunk resolution only as a *suggestion* inside that thread, never as a landing-service-side silent fix. Best-model hunk accuracy is about 45-62%, and wrong-code output runs 34-42%.
   5. Escalate to a human owner when the policy for that path requires it.

3. **A resolved conflict is a new change and must re-earn its proof.**
   - Every resolution, whether structural, LLM or agent, invalidates prior evidence for the affected files.
   - The forge re-runs affected tests and checks for def-use breaks: renamed or deleted symbols on one side vs new references on the other, which is the dominant cause of build and test conflicts.
   - The forge records the resolution method in the landing record. [inference grounded in Shen 2023 and Schesch 2024, read]

4. **Check semantic conflicts on the combined state, not per change.**
   - Speculative batches (brief idea 2) are the right place: test the merged state of {trunk + A + B}, as Crystal did.
   - Add a cheap static pre-check from the symbol index before tests.
   - Be explicit that tests catch only part of the interference (SAM: 9/28). Path-level policy should require stronger evidence (end-to-end runs, a named approver) where interference is costly. [inference]

5. **Intent declaration should be optimistic and advisory, with leases that expire.**
   - The coordination evidence (Cursor's lock failure, Weave's "advisory" claims, Anthropic's file-lock claims) points to *declared intent as a scheduling hint*, not mutual exclusion.
   - Threads declare files and symbols. The forge continuously runs `git merge-tree`-style speculative merges between active threads (Clash, Crystal) and raises overlap early.
   - Leases need TTLs and heartbeats, because crashed agents never release locks.
   - The forge can *schedule* (delay or sequence) overlapping threads rather than block them. [inference]

6. **Measure the resolver like Schesch et al. do.**
   - Publish per-repo (correct, incorrect-but-clean, abstained) rates for each rung, with incorrect weighted by a cost factor k. "Conflicts auto-resolved" alone is a vanity metric that rewards IntelliMerge-style silent breakage. [inference grounded in read data]

7. **CRDT worktrees are for recording, not for skipping the gate.**
   - If the forge adopts DeltaDB-style operation recording (brief idea 5, "code can answer why"), it still needs a commit-level checkpoint that is proven before landing.
   - CRDT convergence must not be marketed as "no conflicts." [inference]

**Assessment of "the forge should automatically resolve conflicts".**

Realistic:
- **False conflicts.** Adjacent lines, independent entities in one file, imports, lockfile and version bumps, reformat-plus-edit. Structured merge plus deterministic checks handles these. Weave matched 29/29 on its synthetic suite, though only about 7% of real conflicted file merges.
- **Trivial hunks.** DeepMerge reached 78% on hunks of 3 lines or fewer back in 2021. Today's LLMs are likely higher there (inference).
- **Re-executing intent.** The losing agent re-runs its task on the new base, under a full re-proof. This is how Cursor's hundreds of workers and Anthropic's 16 agents cope [read].

Unrealistic:
- **Unattended hunk-level LLM resolution at the landing service.** It matches humans only about 45-62% of the time, and it fails silently on roughly a third of hunks.
- **Any clean merge that is semantically wrong.** Git: 3% of merges; aggressive tools: 11-50%. No textual resolver can see these.
- **Order-dependent edits to the same block.** Mergiraf refuses these by design.
- **Macro-heavy C.** Parsing falls back to lines.
- **Real disagreements of intent.** Two agents implement contradictory behaviour. Only a planner or human can decide which ships.

So the honest pitch is: "the forge resolves the *mechanical* conflicts itself, routes *intent* conflicts back to the thread with both intents attached, and never lands a resolution without fresh proof."

---

## Contradictions / pushback

- **Frequency of semantic conflicts.** Crystal reports 7% of merges in well-tested projects (28% in Perl5); Shen et al. report about 0.1% of 117k merges. The differences in methodology (test strength, filtering on passing parents, project mix) are large enough that neither should be quoted as "the rate." [read]
- **"Structured merge greatly reduces conflicts" (Spork abstract) vs real-world yield.** Mergiraf cleared 5.8% of Linux-kernel conflicts; Weave won 6.9% of real file merges with 86 regressions; Schesch et al. found a simple import-aware git extension "usually outperforms Spork, IntelliMerge". [read]
- **Mergiraf vs Spork.** LastMerge says Mergiraf has nearly twice Spork's false positives but 42% fewer false negatives. Mergiraf is the safer choice (it misses fewer real conflicts) but is noisier. Which is "better" depends on k. [read]
- **Do agents even need merge tools?** On HN (deckar01) and in Cursor's experience, workers "were already capable of handling conflicts themselves." The counterpoint (vidarh) is that it "often takes multiple extra rounds". Neither side cites token or latency data. [read]
- **LLM benchmark optimism vs reality.** ConGra reports 72-84% "accuracy" for 8B-class models, while Merge-Bench reports frontier models at 45-53%. Metrics and datasets differ: ConGra's accuracy is a code-matching score of varying granularity, and Merge-Bench uses exact or normalized equivalence on 20-line hunks. Treat ConGra's numbers as not comparable. [read; comparability is inference]
- **Context helps or hurts?** ConGra found adding context often *hurts*. Rover finds dependency-graph context helps by about 10-13% similarity. The difference is plausibly *relevant* context (program-analysis-selected) vs adjacent lines. [read; reconciliation is inference]
- **CRDT "conflict-free" marketing vs Upwelling's finding** that semantic conflicts need review. DeltaDB's posts say nothing on the matter. [read]
- **Brief idea 6 ("agents declare files and symbols; forge flags overlap")** is supported by Clash and Crystal. However, Cursor's experience suggests that making declarations *binding* (locks) hurts throughput, so the feature must be advisory. [read + inference]
- **Brief's "on a real conflict wake the originating thread".** Cursor removed its central integrator and let workers fix their own conflicts, which agrees with the brief. Note that Cursor still kept a *planner* to avoid conflicts upstream; resolution alone was not enough. [read]

## Open questions

- No study I found measures *test-validated* accuracy of frontier-LLM or agentic conflict resolution, meaning resolution, then build, then full test suite. Merge-Bench and the 2026 judge study are text-match only. A forge could produce this dataset from its own landing logs.
- No public numbers exist on conflict rates *per agent-hour* or per concurrent-thread count in agent fleets. Anthropic says "frequent", Cursor says "minimal", and neither gives a rate.
- The ChatGPT-era empirical studies of conflict resolution and Copilot/GitHub-native conflict-resolution features were **not verified**, because search budget ran out. Whether GitHub ships any automatic conflict resolution in Copilot coding agent is unknown here.
- IntelliMerge's own reported precision and recall, jDime and semistructured (FSTMerge) original conflict-reduction numbers, and Cassandra (Kasi and Sarma, conflict-minimizing task scheduling) were not opened. The ACM and IEEE pages were blocked.
- Uber's SubmitQueue "conflict analyzer" (build-target-based change independence) could not be opened (ACM 403, Uber 404). It is the main industrial precedent for deciding which changes can land in parallel, and should be verified by the merge-queue researcher.
- How does DeltaDB actually resolve same-span concurrent agent edits, and does Delta gate landing on anything beyond the agent's own judgement?
- Can jj-style first-class conflicts be exposed through plain git clients without confusing them? jj warns against sharing conflicts with Git users. And what does ERSC actually implement server-side?
- Is patch-theoretic commutation (Pijul) useful for "land any compatible subset of threads in any order", or does the semantic-conflict problem dominate so that textual commutation buys little?

---

## Sources (opened)

| URL | Title | Date |
|---|---|---|
| https://mergiraf.org/ | Mergiraf - home | current (2026) |
| https://mergiraf.org/architecture.html | Mergiraf - Architecture | current |
| https://mergiraf.org/conflicts.html | Mergiraf - What kinds of conflicts can it solve | current |
| https://mergiraf.org/languages.html | Mergiraf - Supported languages | current |
| https://lwn.net/Articles/1042355 | Mergiraf: syntax-aware merging for Git (Daroc Alden) | 2025-10-31 |
| https://arxiv.org/abs/2202.05329 | Spork: Structured Merge for Java with Formatting Preservation | 2022-02-10 (TSE 2022) |
| https://arxiv.org/pdf/2507.19687 | LastMerge: A language-agnostic structured tool for code integration | 2025-07-25 |
| https://github.com/Ataraxy-Labs/weave (and README.md) | Weave: entity-level semantic merge for Git | benchmarks regenerated 2026-09-01 |
| https://github.com/Glavin001/weave | Weave fork | n/d |
| https://news.ycombinator.com/item?id=47241976 | HN: Weave - a language aware merge algorithm based on entities | ~2026-03 ("7 months ago") |
| https://homes.cs.washington.edu/~mernst/pubs/merge-evaluation-ase2024-slides.pdf | Evaluation of Version Control Merge Tools (slides + paper text) | ASE 2024, Oct 2024 |
| https://arxiv.org/abs/2410.09934v1 | Evaluation of Version Control Merge Tools (abstract) | 2024-10 |
| https://arxiv.org/html/2605.25890v1 | Merge-Bench: Resolve Merge Conflicts with Large Language Models | 2026-05-25 |
| https://arxiv.org/abs/2607.27674 and https://arxiv.org/html/2607.27674 | Can LLMs Resolve Real Java Merge Conflicts? An Evaluation with a Calibrated LLM-as-Judge | 2026-07-30 |
| https://arxiv.org/html/2605.16646v1 | LLM-based vs. Search-based Merge Conflict Resolution | 2026-05-15 |
| https://arxiv.org/pdf/2605.17279 | Rover: Context-aware Conflict Resolution with LLM | 2026-05-17 |
| https://arxiv.org/html/2409.14121v1 | ConGra: Benchmarking Automatic Conflict Resolution | 2024-09-21 |
| https://arxiv.org/abs/2109.00084 | MergeBERT: Program Merge Conflict Resolution via Neural Transformers | 2021-08 / FSE 2022 |
| https://arxiv.org/abs/2105.07569 | DeepMerge: Learning to Merge Programs | 2021-05 |
| https://arxiv.org/abs/2111.11904 (+ PDF) | Can Pre-trained Language Models be Used to Resolve Textual and Semantic Merge Conflicts? (Gmerge) | 2021-11-23 |
| https://arxiv.org/abs/2310.02395 (+ se.ruhr-uni-bochum.de PDF) | Detecting Semantic Conflicts with Unit Tests (SAM) | 2023-10 / JSS 2024 |
| https://arxiv.org/abs/1802.06551 | Verifying Semantic Conflict-Freedom in Three-Way Program Merges (SafeMerge) | 2018-02-19 |
| https://par.nsf.gov/servlets/purl/10515782 | A Characterization Study of Merge Conflicts in Java Projects (Shen et al., TOSEM) | 2023-03 |
| https://people.cs.umass.edu/~brun/pubs/pubs/Brun13tse.pdf | Early Detection of Collaboration Conflicts and Risks (Crystal) | 2013-10 |
| https://docs.jj-vcs.dev/latest/conflicts/ | Jujutsu - First-class conflicts | current |
| https://docs.jj-vcs.dev/latest/technical/conflicts/ | Jujutsu - Technical: conflicts | current |
| https://docs.jj-vcs.dev/latest/technical/concurrency/ | Jujutsu - Concurrency | current |
| https://docs.jj-vcs.dev/latest/glossary/ | Jujutsu - Glossary | current |
| https://docs.jj-vcs.dev/latest/guides/divergence/ | Jujutsu - Divergent changes | current |
| https://docs.jj-vcs.dev/latest/config/ | Jujutsu - Settings (merge tools, same-change, marker styles) | current |
| https://pijul.org/manual/theory.html | Pijul manual - Theory | current |
| https://pijul.org/manual/why_pijul.html | Pijul manual - Why Pijul | current |
| https://darcs.net/FAQ/Performance | Darcs FAQ - Performance | n/d |
| https://ersc.io/ ; /blog ; /blog/ersc-availability ; /blog/what-comes-after-git ; /blog/martin-joins-ersc | East River Source Control site and posts | 2026-05-04, 2026-09-10, 2026-09-01 |
| https://zed.dev/blog/introducing-deltadb | Software Is Made Between Commits | 2026-06-11 |
| https://zed.dev/blog/sequoia-backs-zed | Sequoia backs Zed (DeltaDB announcement) | 2025-08-20 |
| https://zed.dev/blog/crdts | How CRDTs make multiplayer text editing part of Zed's DNA | 2022-12-01 |
| https://zed.dev/blog | Zed blog index | 2026-10 |
| https://zed.dev/blog/delta-public-beta | Replace PRs with Delta - Now in Public Beta | 2026-09-16 |
| https://zed.dev/blog/agentic-xanadu | Xanadu Was Waiting for Agents | 2026-09-01 |
| https://automerge.org/docs/reference/documents/conflicts/ | Automerge - Conflicts | current |
| https://www.inkandswitch.com/upwelling/ | Upwelling: Combining real-time collaboration and version control for writers | 2023-03 |
| https://www.inkandswitch.com/patchwork/notebook/2024-version-control/ | Patchwork lab notebook - 2024 version control | 2024 |
| https://www.inkandswitch.com/project/patchwork/ | Patchwork project page | 2024-2026 |
| https://arxiv.org/abs/2409.14252 | Collaborative Text Editing with Eg-walker | 2024-09 / EuroSys 2025 |
| https://www.anthropic.com/engineering/building-c-compiler | Building a C compiler with a team of parallel Claudes | 2026-02-05 |
| https://cursor.com/blog/scaling-agents | Scaling long-running autonomous coding | 2026-01-14 |
| https://cursor.com/docs/configuration/worktrees | Cursor docs - Worktrees | current |
| https://code.claude.com/docs/en/agent-teams | Claude Code - Orchestrate teams of Claude Code sessions | current |
| https://github.com/clash-sh/clash | Clash - merge-conflict detection across worktrees | n/d |
| https://github.blog/changelog/2026-10-01-github-async-merge-api-generally-available | GitHub async merge API generally available | 2026-10-01 |

Attempted but not readable: Uber "Keeping master green at scale" (404/403), IEEE Cassandra page (empty), Ink & Switch notebook entry 07 (empty), pijul.org/posts (403), Crystal FSE 2011 abstract page (404).

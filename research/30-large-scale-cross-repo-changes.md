# 30: Large-scale and cross-repository changes as a forge problem in the agent era

Researcher key: `30-large-scale-cross-repo-changes`. Written 2026-10-12.
Tags: **[read]** means verified on a page I opened. **[secondary]** means coverage or a search summary, not the primary source. **[inference]** means my own reasoning.

---

## Summary

1. **Big organizations already run large-scale change (LSC) as a separate subsystem next to the forge.** Google built Rosie, Spotify built Fleetshift, Sourcegraph built Batch Changes, Moderne sells a platform, and AWS sells Transform custom. Each has a first-class "campaign" object: spec, target set, per-repo changesets, status rollup, bulk actions. No mainstream forge models this natively. GitHub's closest native feature is security campaigns, and they are scoped to security alerts. [read]
2. **Google's LSC process is the reference design.** Rosie shards one logical change by project and OWNERS boundaries into independently testable, reviewable and submittable pieces. It caps outstanding shards and runs at low priority to protect CI. "Global approvers" plus pattern-based auto-approval mean humans look only at anomalies. Throughput was 700+ changes and 15,000+ files per day at the `scoped_ptr` peak, and has since reached roughly 10x that. [read: SWE book ch. 22]
3. **Google deliberately chose not to make LSCs atomic.** Atomic commits scale badly, block other writers and raise merge-conflict odds. Small shards are easier to test and to diagnose, and Google accepts the repeated test cost because "engineer time costs more than compute." This undercuts "atomic multi-repo commit" as a primary design goal. [read]
4. **LLMs are now inside these pipelines, but the pipeline shape is unchanged.** Google reports 39 migrations, 595 changes and 93,574 edits, with 74.45% of changes LLM-generated and about 50% time saved. Shards still go through LSC infrastructure to code owners, and rollout remains "largely human-driven." [read]
5. **Review throughput, not generation, is the bottleneck.** Google capped how many JUnit3→4 changes it generated per week because review speed limited progress. Morgan Stanley, Netflix, Airbnb and LinkedIn practitioners, quoted by Moderne, say the same. [read]
6. **Spotify is the best public data on polyrepo fleet changes.** It has thousands of GitHub repos and 300,000+ automated changes, about 7,500 per week, 75% automerged. In 2022 it opened 270k PRs: 77% automerged and 11% human-merged. A Log4j fix reached 80% of backend services in 9 hours. The mechanics are an opt-out automerge rate-limited to the owning team's working hours, cohort-based staged rollout gated on deploy health (Firewatch), pre-PR CI dry runs (Fleetsweep), and post-merge failure correlation back to the shift author. [read]
7. **Spotify swapped the transform engine for an agent (Honk) and kept everything else.** Targeting, PR opening, review and merge stayed the same. It has merged 1,500+ AI PRs with 60–90% time saved. An LLM judge vetoes about 25% of sessions. The agent cannot push; the platform does that. [read]
8. **Agent-era migration pipelines converge on one pattern:** deterministic targeting, then a per-unit agent edit loop, then verifiers (build, lint, types, related tests), then an LLM-judge or rule gate, and only then a PR. Airbnb (3.5k files in 6 weeks vs a 1.5-year estimate, 75%→97% automated), Block (451 days, 14,713 file changes, 20+ custom linters) and Google all follow it. [read]
9. **Cross-repo atomic landing is weak everywhere.** Gerrit topics guarantee joint submission only within one repo; across repos "No other guarantees are given." Zuul cycles postpone reporting until every item passes, but warn of partial merges caused by "the lack of atomicity in merge operations in code review systems," and call cycles "an antipattern." GitLab MR dependencies only order merges (10 blockers max). GitHub merge queue is per-branch. [read]
10. **Renovate and Dependabot already encode the agent-scale noise controls:** grouping, schedules, concurrency caps (Renovate `prConcurrentLimit` defaults to 10), branch-automerge without a PR, and cooldowns (Dependabot defaults to 3 days). These are early campaign-throttling primitives. [read]
11. **The monorepo-vs-polyrepo-for-agents debate is mostly vendor opinion.** Nx argues an agent "can modify 20 projects in a single PR" and concedes that its polyrepo product gives only an "eventually consistent" monorepo. Google's SWE book says the One-Version rule matters more than repo layout. I found no independent benchmark. [read + inference]
12. **Implication for the forge:** a "campaign" (or fleet change) object is needed above threads. It would hold a spec, target query, per-target child threads, cohorts and staged rollout, ownership routing, rate limits tied to CI capacity and owner working hours, aggregate proof, burndown, bulk actions, and post-merge health correlation. Cross-repo verification means running dependents' tests against the change speculatively, not atomic commits. [inference]
13. **Brief claims:** the brief's "landing as a platform service" thesis is strongly supported. Spotify's agent cannot push, and Rosie and Fleetshift own submission. The brief's "merge on proof, not human diff-reading" is supported at the fleet level only for low-risk classes: Spotify's 75% automerge, and Google's auto-approval of expected shards. Riskier classes still need owners. [read + inference]

---

## Detailed findings

### A. Google: Rosie and the LSC process (pre-LLM baseline)

Source: *Software Engineering at Google*, ch. 22 "Large-Scale Changes" (Hyrum Wright), https://abseil.io/resources/swe-book/html/ch22.html

- **Definition.** An LSC is "a set of logically related changes that cannot practically be submitted as one atomic unit." [read]
- **Scale.**
  - The `scoped_ptr` → `std::unique_ptr` migration touched 500k+ references. At peak, 700+ independent changes touching 15,000+ files were generated, tested and committed per day; throughput has since sometimes reached about 10x that. [read]
  - One series removed more than 1 billion lines over 3 days. [read]
  - 10–20% of changes in a project are LSC-driven. [read]
  - Rule of thumb: more than 500 edits means use tooling, not hand edits. [read]
- **Rosie (sharding).** Rosie shards a global change along project boundaries and OWNERS rules into independently submittable pieces. Each shard has its own test, mail and submit pipeline. Rosie caps outstanding shards per LSC and runs at low priority to limit load on shared test infrastructure. [read]
- **Testing.**
  - Each shard runs through TAP over the tests that transitively depend on its files. Most shards hit fewer than 1,000 tests out of millions. [read]
  - For many shards, TAP runs the union of affected tests and then re-runs the intersection with failures per shard. [read]
  - The "TAP train" runs every 3 hours: each change runs a random sample of 1,000 tests, passing changes are combined into a train, and the union of affected tests runs (6+ hours). Non-flaky failures are re-run per change to find the culprit. [read]
  - Recently flaky tests are ignored by automated submission. [read]
  - Nonstandard project-specific presubmits are disabled for LSCs, and pre-existing presubmit failures are ignored ("owners are responsible for keeping their projects clean"). [read]
- **Review.**
  - Shards go to a "global approver" who can approve anywhere in the repo. [read]
  - Pattern-based tooling auto-approves expected shards; humans examine only anomalies such as merge conflicts or tool malfunctions. [read]
  - Local owners are consulted only when their *context* is needed. [read]
  - An owners-detection service weights reviewers from OWNERS files and auto-adds reviewers if an owner is unresponsive. [read]
- **Governance.** An LSC committee of about a dozen people reviews proposals: reason, estimated shard count, FAQ, and API-owner domain review. It is liberal with approvals and fast-tracks obvious changes. It rejects dangerous changes (all `NULL` → `nullptr`) and low-value ones (British → American spelling). [read]
- **Barriers.** Atomicity (VCS operations scale linearly with change size, and big commits block writers), merge conflicts, "haunted graveyards," heterogeneity across VCS and CI, flaky tests, and backsliding. Backsliding is countered by Tricorder flagging new uses of deprecated APIs at review time. [read]
- **Key quote:** "LSCs really work only when the bulk of the effort for them can be done by computers, not humans." [read]
- **Forge implication.** The forge (Critique plus TAP) is extended by an LSC orchestrator, not replaced. The primitives are: a sharder, a global-approver role, auto-approval by pattern, a backsliding linter, and a CI priority class for LSC work. [inference]
- **Unverified.** The CACM 2016 paper "Why Google stores billions of lines of code in a single repository" (Potvin and Levenberg) is commonly cited for Rosie and automated-commit volume figures. Both the CACM pages and the research.google page returned 403 or abstract only, so **I could not verify any Rosie numbers from that paper.**

### B. Google: LLMs inside the LSC pipeline

Sources:
- "Accelerating code migrations with AI," Google Research blog, July 18, 2024 (Nikolov, Taneja): https://research.google/blog/accelerating-code-migrations-with-ai/
- arXiv 2501.06972, "How is Google using AI for internal code migrations?", Jan 2025 (Nikolov, Codecasa, Sjövall, Tabachnyk, Chandra, Taneja, Ziftci): https://arxiv.org/html/2501.06972
- arXiv 2504.09691, "Migrating Code At Scale With LLMs At Google," Apr 2025 (Ziftci et al.): https://arxiv.org/abs/2504.09691

- **int32→int64 IDs in Ads** (500M+ LOC): 80% of code modifications in landed CLs were AI-authored. Engineers estimated about 50% total time reduction. The model predicted which Java files needed edits with 91% accuracy, and more than 75% of AI-generated character changes landed. [read]
- **JUnit3→4:** 5,359 files and 149k+ lines in 3 months, with about 87% of AI code committed unchanged. **Review speed was the bottleneck, so the team capped the number of changes generated per week.** [read]
- **Joda→java.time:** about 89% time savings on small clusters. Work was limited to directories where reviewers had bandwidth, with gradual rollout. [read]
- **Aggregate (2504.09691):** 39 migrations by 3 developers over 12 months produced 595 changes and 93,574 edits. 74.45% of changes and 69.46% of edits were LLM-generated, for about 50% total time saved. [read]
- **Pipeline.**
  1. Deterministic location-finding: Code Search, Kythe, references 3 levels out, regex and AST filters.
  2. Grouping related files (tests, interfaces).
  3. Fine-tuned Gemini edits, run as several prompt variants in parallel (pass@k).
  4. Build and unit-test validation with LLM repair.
  5. Ranking by validations and an LLM judge.
  6. Human expert check, after which the LSC infra **shards and sends to owners**. [read]
- **Lessons.**
  - Hybrid beats pure LLM.
  - Deterministic AST checks catch unwanted edits such as added comments.
  - "Planning often unnecessary."
  - Measure end-to-end, not % of AI code.
  - Huge clusters "needed careful ordering and reviewer coordination."
  - Guice wiring escaped call-graph analysis. [read]
- **Forge implication.** Review capacity is a schedulable resource. A campaign needs a generation throttle tied to reviewer bandwidth per owner area. [inference]

### C. Spotify: Fleet Management, Fleetshift, Honk

Sources:
- Part 1, Apr 18, 2023 (Niklas Gustavsson): https://engineering.atspotify.com/2023/4/spotifys-shift-to-a-fleet-first-mindset-part-1
- Part 3, May 2023, "Fleet-wide refactoring": https://engineering.atspotify.com/2023/05/fleet-management-at-spotify-part-3-fleet-wide-refactoring/
- Honk parts 1–3 (Nov–Dec 2025): see Sources.

**Scale**
- Polyrepo with thousands of GitHub repos and 1B+ LOC; about 60M LOC is in scope. [read]
- Before Fleet Management, a Java runtime upgrade took 8 months and about 2,000 semi-automated PRs. [read]
- More than 300k automated changes, about 7,500 per week, about 75% automerged. [read]
- 100+ automated migrations in 3 years; 75%+ of production is repaved (rebuilt and redeployed from source) weekly. [read]
- Log4j fix: 80% of backend services within 9 hours. [read]
- A new framework version reaching 70% of services went from about 200 days to under 7. [read]

**2022 numbers (Part 3)** [read]
- 270k+ PRs: 77% automerged, 11% human-merged.
- 241k merged PRs changed about 4.2M lines.
- 49 teams sent shifts.
- 22 shifts changed 1,000+ repos.
- Median shift targeted 46 repos.

**Mechanics of a shift** [read]
- A shift is a Docker image that does the change. It can use sed, OpenRewrite, Scalafix and similar tools.
- Shifts are Kubernetes custom resources (`kind: Shift`) stored as YAML in GitHub, so **launching a campaign is itself code-reviewed**.
- Targets are listed explicitly or as a BigQuery table, refreshed daily from ingested source.
- Execution runs as Kubernetes Jobs: clone, run, record file deltas, commit, open PR.
- "Preview" mode shows diffs and logs before any PR is opened.
- **Fleetsweep** creates short-lived branches, runs CI, and reports aggregate pass/fail per repo *without opening PRs*. This is a campaign dry run.

**Automerge** [read]
- Merges only if all checks pass.
- The automerger service **rate-limits merges to protect CI/CD and merges only during the owning team's working hours, never weekends or holidays.**
- Opt-out requires a documented reason and ideally an expiry. About 50 of thousands of repos opt out.

**Staged rollout** [read]
- Target repos are split into **cohorts**; each cohort gets the change only after enough repos in the previous cohort succeed.
- Fleetshift queries Firewatch deployment and pipeline success rates to decide which version each cohort may receive.
- The most critical systems go last.

**Post-merge** [read]
- Firewatch correlates deploy and pipeline failures with automerged commits and alerts the shift's owners above a threshold.
- Backstage shows shift progress, and each repo owner sees which fleet programs touch their components.

**Limitation (in Spotify's own words)** [read]
- "Fleetshift does not adequately support monorepos, where many teams share one repo."

**Honk: agents slotted in** [read]
- Work started Feb 2025. Prompts replaced deterministic scripts; "the surrounding infrastructure (targeting repos, opening PRs, getting reviews, merging) stayed the same."
- The Maven dependency updater had grown to 20,000+ LOC, which motivated the change.
- Results: 1,500+ merged AI PRs and 60–90% time savings.
- Since mid-2024, about half of Spotify's PRs have been automated by Fleet Management.

**Honk Part 2** [read]
- Open-source agents (Goose, Aider) "struggled to produce reliably mergeable PRs across thousands of repos."
- The homegrown loop allowed 10 turns per session and 3 retries.
- Claude Code is now the top performer, used for about 50 migrations.
- Tools are deliberately restricted:
  - a `verify` MCP tool;
  - a Git tool with no push and a standardized committer and message;
  - an allowlisted Bash;
  - no code search.
- Migration prompts are large, static and **version-controlled**.
- Open problem: "unclear whether a merged PR actually solved the original problem."

**Honk Part 3** [read]
- Verifiers activate by repo contents (a `pom.xml` triggers the Maven verifier).
- An LLM judge vetoes about 25% of sessions; the agent recovers about half the time. The most common cause is scope creep beyond the prompt, such as disabling flaky tests or refactoring.
- If a verifier fails, no PR is opened.
- The agent runs sandboxed, and "pushing code … handled by surrounding infrastructure."
- Worst failure class: a PR that "passes CI but is functionally wrong."
- Future work: let the agent act on GitHub PR CI checks as an "outer loop."

**Forge implication** [inference]
- This is the most concrete public blueprint for a campaign object in polyrepo form: campaign-as-code, a dry run across the fleet, cohorts gated on production health, merge windows tied to owner calendars, and post-merge blame back to the campaign.
- A thread-native forge should host this, not leave it to a Kubernetes sidecar.

### D. Sourcegraph Batch Changes (vendor campaign object, multi-host)

Sources: https://sourcegraph.com/docs/batch-changes, `/design`, `/batch-spec-yaml-reference`, `/bulk-operations-on-changesets`

- **Model.**
  - A declarative YAML **batch spec** has `on` (a code-search query or explicit repos), `workspaces` (monorepo sub-projects via `rootAtLocationOf`), `steps` (container commands with outputs and conditionals), `transformChanges.group` (split one repo's diff into multiple changesets by directory), `importChangesets` (adopt existing PRs) and `changesetTemplate`. [read]
  - Executing the spec produces **changeset specs**. A **reconciler controller** drives code-host state toward the desired state, explicitly modeled on Kubernetes Deployments. [read]
- **Publication states** run only forward: unpublished, then draft, then published. [read]
  - `published` accepts glob patterns per repo, last match wins, for example publishing GitHub as drafts and GitLab not at all. This is a staged-rollout primitive. [read]
- **Tracking.** Per-changeset state (open, merged, closed), check state, review state, and a **burndown chart** of the fraction merged over time. [read]
- **Bulk operations:** comment, detach, re-enqueue, merge, close, publish and export, applied only when valid for every selected changeset. [read]
- **Scope.**
  - Hosts: GitHub, GitLab, Bitbucket, Gerrit, and Perforce (beta).
  - The design targets "10,000s of repositories."
  - The spec lives in a file, not a UI, "similar to infrastructure as code."
  - Desired state is computed client-side by `src batch apply`, because server-side arbitrary execution was not originally supported. [read]
- **Forge implication.** A campaign should be a *declarative, reconciled* resource, not a one-shot script, so that re-applying after the base moves updates every PR. Thread-native equivalent: the campaign spec reconciles a set of child threads. [inference]

### E. Moderne / OpenRewrite (deterministic engine plus agents)

Sources: OpenRewrite LST docs; Moderne blog posts listed in Sources.

- **LSTs** are type-attributed and format-preserving, so recipes match exactly (for example, telling SLF4J from Logback loggers) and print back without reformatting. Locally the LST must fit in memory; Moderne builds and uses it "in pieces" across orgs. [read]
- **Mass PRs.**
  - Options are direct commit, branch, fork, or PR from fork.
  - The platform handles SCM rate limits and timeouts "to avoid outages and CI storms."
  - Moderne is listed as co-author so bot PRs are identifiable.
  - Diffs sharing a recipe run ID are grouped into **one campaign**.
  - `mod batch publish` imports diffs produced by other tools (Jenkins, Argo, Sourcegraph). [read]
- **Moddy** (Mar 2025): a multi-repo agent in which "the bulk of the work is accomplished by running recipes." The LLM chooses tools; deterministic recipes analyze and change code. A compilation-verification recipe avoids full builds. [read]
- **Moderne Changelog** (May 19, 2026):
  - Overlays GitHub, GitLab, Bitbucket and internal VCS.
  - **Changesets** group every repo affected by one transformation.
  - Tracks the origin of each change (recipe, agent or human), ready/blocked/waiting status, and stale PRs.
  - Supports bulk approve, merge and close.
  - Exposes this via MCP and GraphQL so agents query in-flight work instead of rescanning repos.
  - Supports explicit dependency ordering ("shared library must build and publish before dependent services are updated"). [read]
- **Morgan Stanley talk** (Moderne blog, Jul 6, 2026):
  - Review is now the bottleneck, and "a thousand-file, 10,000-line PR on the back of just a simple prompt" is possible.
  - Proposals: risk-scored PR routing, **search-only recipes to map blast radius before changing**, and agent-driven CI triage that drafts failing PRs and undrafts those failing for pre-existing reasons.
  - Quotes: "AI needs determinism to scale"; "Confidence is an absolute prerequisite to being able to operate at scale." [read; vendor-published, self-reported]
- **Netflix, Airbnb and LinkedIn practitioners** (Moderne blog, Mar 23, 2026):
  - The same change merges more readily when the owning team triggers it.
  - "Migration fatigue" is cumulative.
  - Netflix validates fully before opening a PR and provides **one view of all PRs from a migration** (merge rates, blocked, contacts).
  - LinkedIn uses AI review agents to tag PRs by confidence and blast radius.
  - Every PR names an accountable contact.
  - No numbers given. [read; secondary for the companies' practices]

### F. Airbnb and Block: agent-driven migrations (single repo, campaign-shaped)

**Airbnb**, "Accelerating Large-Scale Test Migration with LLMs" (Charles Covey-Brandt, about Mar–Apr 2025), https://airbnb.tech/?p=366 [read]
- About 3.5k Enzyme→RTL test files, done in 6 weeks against a 1.5-year manual estimate.
- First bulk run: 75% in about 4 hours. Four days of "sample, tune, sweep" took it to 97%; the last ~3% was finished manually in about a week.
- **Per-file state machine:** refactor, then fix Jest, then fix lint/tsc, then mark complete. Steps are parallel across hundreds of files, with retry loops (simple files within about 10 attempts, the long tail 50–100). Prompts ran 40k–100k tokens with up to 50 related files.
- Status was stamped into each file as a comment. The pipeline supports selective re-runs such as `--step=fix-jest --match=project-abc/**`.
- Review and landing mechanics are not described.
- Forge relevance: the *unit-of-work state machine* with resumable per-unit steps is exactly a child-thread lifecycle. [inference]

**Block**, "From Base Web to Fluent UI without a flag day" (Apr 6, 2026), https://engineering.block.xyz/blog/from-base-web-to-fluent-ui-without-a-flag-day [read]
- Single repo of about 11k files (about 10k TS/TSX) with **40–60 engineers landing daily**, no freeze and no flag day.
- Totals: 451 days, 1,004 commits, 14,713 file changes, 80+ targets. Pre-work alone was 210 days, 809 commits and 4,912 file changes.
- Tooling:
  - Goose wrapping a TypeScript language-service diagnostics server, later a first-party runtime.
  - An import-rules DSL (later ANTLR) giving a checkable "done."
  - 50+ module-hint files and 20+ custom linters that block `as any`, comment deletion and large unexplained deletions.
  - A warm Jest process behind RPC, because a full tsc took about 4 min and Jest started in 10–30 s per file.
  - Later: **isolated worktrees, resumable commits, targeted tests, progress tracking, and "operational controls for large campaigns."**
- A temporary "migration lane" inside the repo let surfaces move gradually; it was collapsed in Feb 2026, with lint rules blocking regression.
- Quote: "the hard part of an AI-assisted migration is not generating code."

**Block BuilderBot**: about 200k operations per day, about 1,500 merged PRs per week, about 15% of production code changes. [secondary: search summary of a news article; the primary article returned 410, unverified]

### G. Amazon: Q Developer / Transform Java upgrades

- **AWS DevOps blog, Aug 1, 2024:** "Amazon has migrated tens of thousands of production applications from Java 8 or 11 to Java 17." It saved "over 4,500 years of development work" for 1,000+ developers versus manual upgrades, plus $260M a year in performance-driven savings. The savings are proxied by host reductions; AWS calls the estimates conservative. [read]
- **Not verified:** the commonly repeated "30,000 applications" figure and "79% of auto-generated reviews shipped without additional changes." The AWS page I opened says "tens of thousands" and does not contain the 79% figure. The figure of 50 developer-days per app before the tool appears only in coverage. [secondary]
- **AWS Transform custom** (GA Dec 1, 2025):
  - The `atx` CLI runs a transformation definition against a local git repo with a validation command (for example `-c "mvn clean install"`), committing intermediate steps to git.
  - Transformation definitions are IAM resources with ARNs.
  - An optional web app provides "centralized monitoring of transformation campaigns across multiple repositories" via a shared CLI command that logs results.
  - Claims "20–30% of software development resources" go to repetitive cross-codebase transformations and "over 80%" execution-time reductions. [read]
  - It also ships as a Claude Code, Codex or Cursor agent plugin. [read]
- **Forge implication.** Even AWS treats the campaign as a *telemetry overlay* on per-repo local runs. The forge does not know a campaign exists. [inference]

### H. Uber (thin evidence)

- Background Agents Summit session (May 7, 2026, Nikhil Ramakrishnan), "Inside Uber's agent-ready platform behind **11% of merged PRs**." [read]
  - The Minion background-agent platform is connected to "Shepard" for large-scale migrations as "a managed primitive" ("evergreen engineering") and to "Code Inbox" for review routing.
  - No mechanics given.
- Figures of 250 migrations / 9M LOC and "70% agent-written PRs" come from talk recaps. [secondary, unverified]

### I. Atomic and cross-repo landing primitives

**Gerrit topics**: https://gerrit-review.googlesource.com/Documentation/cross-repository-changes.html [read]
- With `change.submitWholeTopic`, submitting one change submits the whole topic plus unsubmitted parents and their topics ("Submitted Together").
- **Single-repo topics are guaranteed together; multi-repo topics "only trigger submission of all changes. No other guarantees are given."** Partial submission is possible from storage failures, multi-master setups or races.
- Topics are un-namespaced strings that work within one Gerrit instance only.
- A change outside the topic can block it. Non-submittable topics are hard to diagnose when blockers are invisible to you.
- Revert and cherry-pick work by `submission_id`.

**Zuul**: https://zuul-ci.org/docs/zuul/latest/gating.html and `/config/queue.html` [read]
- Dependent pipelines test speculatively: change C is tested with A+B+C merged. On failure, later items are retested without the failed one, and the window shrinks on failure and grows on success.
- `Depends-On: <url>` works across repos *and across code-review systems* (Gerrit↔GitHub).
- Without a shared queue the dependency must merge first.
- Cycles are opt-in (`allow-circular-dependencies`); all projects in the cycle must share a queue, and `dependencies-by-topic` treats a Gerrit topic as a cycle.
- In a cycle, "Reporting of success will be postponed until all items in the cycle succeed," and any failure dequeues the whole cycle.
- Zuul still warns of partial merges because of "the lack of atomicity in merge operations in code review systems," and calls cycles "an antipattern."

**GitLab MR dependencies**: https://docs.gitlab.com/user/project/merge_requests/dependencies/ [read]
- Cross-project "must be merged" blocking, with up to 10 blockers per MR and 10 dependents (nested since 16.7). Nested dependencies are not visible in the UI. Premium tier.
- Ordering only, no atomic merge.

**GitHub merge queue**: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue [read]
- Per base branch via branch protection, and not on wildcard patterns.
- Build concurrency 1–100; group sizes 1–100.
- Nothing about cross-repo dependencies.

**Forge implication** [inference]
- The state of the art for cross-repo correctness is *speculative joint testing in a shared queue* (Zuul), not atomic commits.
- A forge that owns both storage and landing could do better than Zuul's partial-merge failure mode, for example with a two-phase ref update across repos it hosts. It should still follow Google and prefer ordered, independently safe shards (expand/contract) over atomic multi-repo commits.

### J. Renovate and Dependabot: dependency-update bots as early campaign throttles

- **Renovate noise reduction** (https://docs.renovatebot.com/noise-reduction/) [read]
  - Grouping (`group:monorepos` in default presets; `groupName` plus `matchPackageNames`) is cautioned: "Grouping dependencies increases the chance that the branch has an error."
  - Schedules have at least 1-hour granularity, default UTC. Hosted Renovate refreshes every 1 hour (Enterprise) or 4 hours (Community).
  - **Branch automerge** pushes straight to base if tests pass and opens a PR only on failure.
  - Guidance: "enable automerge for any type of dependency update where you would select Merge anyway."
  - A table shows that grouping and automerge reduce concurrent PRs and lock-file conflicts.
- **Renovate config options** (https://docs.renovatebot.com/configuration-options/) [read]
  - `prConcurrentLimit` defaults to 10; `branchConcurrentLimit` inherits it.
  - `automergeType` defaults to `pr` (alternatives: `branch`, `pr-comment`); `platformAutomerge` defaults to `true`.
  - I did not read `prHourlyLimit` or `minimumReleaseAge` defaults because the page was truncated.
- **Dependabot** (https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/optimizing-pr-creation-version-updates) [read]
  - Groups are configured per ecosystem, by dependency-type, update-types and patterns. `group-by: dependency-name` gives one PR across multiple directories in a monorepo.
  - A default 3-day cooldown applies to version updates, not security updates.
  - Default scheduling picks a random time "to balance workload."
- **Forge implication.** These bots already need knobs a forge should own centrally:
  - org-wide concurrency budgets;
  - merge-without-PR on green;
  - jittered scheduling;
  - grouping policies;
  - soak or cooldown periods.
  With many agents, every agent is effectively a Renovate, so these knobs should apply to agent-originated changes generally. [inference]

### K. Polyrepo vs monorepo for agents

- **Nx (Victor Savkin), "The Monorepo Advantage for AI Agents," Jul 22, 2026** [read; vendor]
  - Describes three "walls" (read, write, memory). "An agent can modify 20 projects in a single PR. One review, one approval, one merge."
  - Cross-cutting changes are "up to 20% of commits."
  - Cites a single-demo "4x faster" and a "1/3 reduction" in effort.
  - Concedes its polyrepo meta-harness Polygraph "orchestrates writes across repositories, but each write must still land independently," calling it "an eventually consistent" monorepo versus Nx's "strongly consistent" one.
  - Also cited by Nx: Airbnb's 18-month→6-week claim. The Airbnb post's own numbers are 1.5 years estimated vs 6 weeks, and the post does not frame it as a monorepo effect.
- **Google SWE book ch. 16** (https://abseil.io/resources/swe-book/html/ch16.html) [read]
  - "Developers must never have a choice of 'What version of this component should I depend upon?'" One-Version matters more than layout.
  - Predicts virtual monorepos (VMRs) "stitching together a disparate collection of physical repositories."
  - Long-lived branches are an "awfully large tax" on LSCs.
- **Spotify** shows polyrepo fleet changes work at 300k+ PR scale, but says its tooling does not fit monorepos (Part 3). [read]
- **Sourcegraph** handles both through `workspaces` and `transformChanges.group`, which split one repo into multiple changesets. [read]
- **Uber** credits years of monorepo and Bazel investment as the base for automation. [secondary]
- **Augment Code** and others frame the layout choice as a tradeoff. [secondary; vendor]
- **Synthesis** [inference]
  - Layout is less important than (a) a single dependency graph the agent and forge can query, (b) one version per dependency, and (c) a landing system that can test a change against its dependents.
  - Monorepo users need *splitting*: Rosie shards a monorepo change into many reviews.
  - Polyrepo users need *grouping*: campaigns, topics, Depends-On.
  - The future forge needs both, around one "logical change" object.

---

## Pain points for agentic-scale development

1. **Review throughput is the binding constraint.** Google throttled generation to review speed (JUnit) and scoped Joda work to directories with reviewer bandwidth. Morgan Stanley says senior reviewers are the bottleneck. [read]
2. **Migration fatigue and trust.** Owners resent outside PRs; PRs triggered by their own team merge better; stale bot PRs erode trust in central fixes. [read; Moderne blog]
3. **Functionally wrong but green PRs.** Spotify ranks these as the worst failure, because test coverage is uneven across thousands of repos. Its partial answer is "herd safety," where testing across many repos makes up for gaps in each. [read]
4. **Scope creep by agents.** Agents disable flaky tests or refactor beyond the prompt. Spotify's LLM judge vetoes about 25% of sessions; Block built linters against `as any` and comment deletion. [read]
5. **CI capacity storms.** Rosie runs at low priority with capped outstanding shards. Spotify rate-limits merges. Moderne handles SCM rate limits to avoid "CI storms." Renovate caps concurrent PRs at 10 by default. [read]
6. **Flaky and pre-existing failures** block automated landing. Google ignores recently flaky tests and pre-existing presubmit failures; Morgan Stanley's agent undrafts PRs whose failures are pre-existing. [read]
7. **No atomic cross-repo landing.** Gerrit gives no guarantee across repos, Zuul warns of partial merges, GitLab only orders merges, and GitHub merge queue is per branch. [read]
8. **Heterogeneous build and test environments.** Spotify verifiers are per build system and Linux-x86 only. Google lists heterogeneity as a core LSC barrier. [read]
9. **Backsliding** while a migration is in flight: people copy old patterns. Google uses Tricorder; Block used lint rules after collapsing the migration lane. [read]
10. **Context and targeting.** Polyrepo agents cannot see consumers. Spotify ingests all code into BigQuery for targeting. Moderne Changelog exposes in-flight work via MCP to save tokens spent rediscovering it. [read]
11. **Measuring whether a campaign worked.** Spotify says it is "unclear whether a merged PR actually solved the original problem." Google says % of AI code is a weak proxy. [read]

## How organizations are solving them

| Problem | Mechanism | Who | Tag |
|---|---|---|---|
| One logical change, many owners | Shard by OWNERS/project; each shard has its own test, review and submit pipeline | Google Rosie | [read] |
| Review load | Global approvers plus pattern auto-approval; owners only for context | Google | [read] |
| Review load | Opt-out automerge on green (75–77%) | Spotify | [read] |
| Review load | Risk-scored routing; AI pre-triage tagging confidence and blast radius | Morgan Stanley, LinkedIn | [read; vendor blog] |
| Generation outpacing review | Weekly generation cap; scope to directories with reviewer bandwidth | Google | [read] |
| CI load | Low-priority class, outstanding-shard caps, merge rate limits, concurrency limits | Google, Spotify, Renovate | [read] |
| Owner disruption | Merge only in the owning team's working hours, never weekends or holidays | Spotify | [read] |
| Blast radius | Cohorts gated on deploy and pipeline health; critical systems last | Spotify Fleetshift + Firewatch | [read] |
| Pre-PR confidence | Fleet-wide dry-run CI without PRs (Fleetsweep); preview mode; validate fully before opening PR | Spotify, Netflix | [read] |
| Pre-PR confidence | Search-only recipe to map blast radius first | Morgan Stanley / Moderne | [read] |
| Agent scope creep | LLM judge after verifiers; restricted tools; no push from the agent | Spotify Honk | [read] |
| Agent scope creep | Custom linters and checkable end-state DSL | Block | [read] |
| Campaign definition | Shift as K8s CRD in git (code-reviewed); batch spec YAML reconciled | Spotify, Sourcegraph | [read] |
| Tracking | Burndown, per-changeset check and review state, bulk operations | Sourcegraph, Moderne Changelog, Netflix | [read] |
| Cross-repo correctness | Speculative shared-queue testing, Depends-On, opt-in cycles | Zuul / OpenStack | [read] |
| Cross-repo correctness | Topics with submitWholeTopic | Gerrit (Android, Chromium) | [read] |
| Post-merge safety | Correlate deploy failures with automerged commits and alert the campaign owner | Spotify Firewatch | [read] |
| Backsliding | Review-time linting of deprecated APIs | Google Tricorder | [read] |
| Governance | LSC committee approves proposals and rejects low-value or dangerous ones | Google | [read] |

## Implications for a future forge (thread-native)

All [inference], grounded in the above.

1. **Add a `Campaign` object above `Thread`.** A campaign is a declarative, version-controlled spec, following Spotify's shift CRD and Sourcegraph's batch spec. It contains:
   - an intent or prompt plus optional deterministic recipe;
   - a target query (code search or dependency graph);
   - verifiers;
   - a publication policy;
   - cohorts;
   - rate limits;
   - an owner and contact.
   The forge *reconciles* it into N child threads, one per repo, workspace or owner shard. Re-applying the spec after the base moves updates every child.
2. **Make sharding a forge primitive.** In a monorepo the forge splits by OWNERS or project (Rosie); in a polyrepo it groups (topics, Depends-On). Both produce "one logical change, many independently landable units."
3. **Prefer staged independence over atomicity.** Default to expand/contract ordering: library first, then dependents, then removal of the old API, encoded as a campaign DAG (Moderne Changelog's "library must publish before dependents"). Offer a true atomic multi-repo land only for repos the forge hosts in the same namespace. That is possible when the forge owns storage and the landing service, which Gerrit and Zuul cannot do across external hosts. Mark it as the exception.
4. **Cross-repo verification = speculative dependent testing.** Before landing a library child thread, the landing service boots the change and runs the *consumers'* tests against it, in the manner of Zuul's shared queue and Google's union-of-affected-tests, then attaches the results as proof. "Every change bootable" extends to "every change bootable together with its dependents."
5. **Fleet dry run before publishing.** A Fleetsweep equivalent runs all child threads to green or red without notifying owners, and publishes only the green ones. It reports a campaign-level proof matrix: repos × verifiers.
6. **Review capacity as a scheduled resource.**
   - Throttle *generation* to owner review bandwidth (Google).
   - Route by risk class: auto-land low-risk on proof (Spotify's 75%; Google's auto-approve on pattern) and send anomalies to humans.
   - Respect owner working hours for merges (Spotify).
7. **Ownership routing.** Use OWNERS-file weighting with escalation to a global approver on non-response (Google). Show each owner an inbox of campaigns touching their code (Spotify's Backstage view; Uber's "Code Inbox").
8. **Cohorts and health-gated rollout.** The landing service consults deploy and pipeline health of earlier cohorts before advancing (Firewatch). Post-merge regressions are blamed back to the campaign, with a one-click campaign-wide revert by submission ID (Gerrit).
9. **Campaign proof is aggregate and herd-based.** Report pass rates across N repos and highlight repos where coverage is low. A single green repo is weak evidence; 50 green dependents are stronger.
10. **Agent-facing campaign state.** Expose in-flight campaigns, blocked children and dependency order through an API or MCP, so a newly spawned agent knows what others are changing. This directly answers Cloudflare's "how do agents know what other agents are working on." Moderne Changelog is the existence proof.
11. **CI and landing budgets per campaign.** Use a priority class for campaign work (Rosie's low priority), global concurrency (Renovate), and jittered scheduling (Dependabot).
12. **Backsliding guard.** When a campaign starts, the forge can auto-install a "new uses of X are blocked" check on all threads, so parallel agents do not reintroduce the pattern.
13. **Governance hook.** A campaign touching more than N repos or owners needs a lightweight approval (Google's LSC committee) and must name a contact (Netflix).

**For the Cloudflare demo specifically** [inference]: a compelling and cheap-to-show slice is a campaign card that fans out to K child threads across K Artifacts repos. Each child boots a Workers Preview. The landing service lands the library first, then speculatively tests dependents against it, then advances cohort 2. A burndown updates live. GitHub cannot do this natively; it needs Sourcegraph or Moderne plus Actions glue.

## Contradictions and pushback

- **Atomic commits are not the goal.** Nx sells "one PR, one review, one merge" for 20 projects. Google deliberately breaks large changes *apart* for testability, diagnosability and reviewability. The forge should support both but default to sharding at scale. [read]
- **Automerge without humans works only for narrow classes.** Spotify's 75% automerge covers dependency bumps, config changes and simple refactors, with weekly repaving and canaries. Its agent-generated migrations still go through review, and "functionally wrong but green" is its top worry. Google's AI-era rollouts remain "largely human-driven." This qualifies the brief's "merge on proof" for complex campaigns. [read]
- **Determinism versus agents.** Moderne and Morgan Stanley ("AI needs determinism to scale") push deterministic recipes with LLM planning. Spotify moved *away* from deterministic scripts because a 20k-LOC updater was unmaintainable. Google and Block land in the middle (deterministic targeting and checks, LLM edits). The forge should be agnostic: a campaign step can be a recipe, a container or an agent. [read]
- **Monorepo for agents.** The evidence is vendor-authored (Nx, Augment). Spotify shows polyrepo works at huge scale with enough platform. Google says layout matters less than One-Version. [read]
- **Amazon figures.** "30,000 apps" and "79% shipped without changes" circulate widely, but the AWS primary page says only "tens of thousands" and gives 4,500 developer-years and $260M a year, with savings estimated by proxy. [read vs secondary]
- **"Airbnb 18 months → 6 weeks in a monorepo"** (Nx) misstates the primary source: 1.5 years estimated vs 6 weeks actual, with no monorepo attribution. [read]

## Open questions

1. Can a forge that hosts all repos itself offer a safe atomic multi-repo ref update (two-phase across Artifacts repos), and is it worth it, given Google's and Zuul's view that atomic cross-unit landing is an antipattern at scale?
2. What is the right default throttle: by CI capacity, by owner review bandwidth, or by production-health signals? Spotify uses all three; nobody publishes the control law.
3. How should campaign-level proof be presented so owners trust automerge? For example: herd pass rates, judge veto stats, coverage of the touched lines.
4. How do campaign child threads interact with ordinary feature threads in the same repo? Should a campaign get speculative-batch priority or low priority (Rosie's choice)?
5. What fraction of agent-generated work at Spotify, Uber and Block is campaign-style versus feature work? Uber says 11% of merged PRs are agent-generated; Spotify says about half of PRs are Fleet Management-automated. These are not comparable denominators.
6. Unverified: Google CACM Rosie figures, the Block BuilderBot primary post, Uber Shepherd internals, and Stripe Minions' (about 1,300 PRs a week) relationship to migrations (found only in secondary coverage).
7. Do cross-repo Depends-On graphs become unmanageable when hundreds of agents create them concurrently? Zuul's design assumes humans write the footers.

## Sources (all opened)

| # | Title | URL | Date |
|---|---|---|---|
| 1 | Software Engineering at Google, ch. 22 "Large-Scale Changes" | https://abseil.io/resources/swe-book/html/ch22.html | 2020 (book) |
| 2 | SWE at Google, ch. 16 "Version Control and Branch Management" | https://abseil.io/resources/swe-book/html/ch16.html | 2020 |
| 3 | How is Google using AI for internal code migrations? (arXiv abs + HTML) | https://arxiv.org/abs/2501.06972 ; https://arxiv.org/html/2501.06972 | Jan 12, 2025 |
| 4 | Migrating Code At Scale With LLMs At Google | https://arxiv.org/abs/2504.09691 | Apr 13, 2025 |
| 5 | Accelerating code migrations with AI (Google Research) | https://research.google/blog/accelerating-code-migrations-with-ai/ | Jul 18, 2024 |
| 6 | Why Google Stores Billions of Lines of Code in a Single Repository (abstract only; full text 403) | https://research.google/pubs/why-google-stores-billions-of-lines-of-code-in-a-single-repository/ | 2016 |
| 7 | 1,500+ PRs Later: Spotify's Background Coding Agent (Honk, Part 1) | https://engineering.atspotify.com/2025/11/spotifys-background-coding-agent-part-1 | Nov 6, 2025 |
| 8 | Context engineering for background coding agents (Part 2) | https://engineering.atspotify.com/2025/11/context-engineering-background-coding-agents-part-2 | Nov 2025 |
| 9 | Feedback loops for background coding agents (Part 3) | https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3 | Dec 2025 |
| 10 | Fleet Management at Spotify Part 1: Shift to a Fleet-First Mindset | https://engineering.atspotify.com/2023/4/spotifys-shift-to-a-fleet-first-mindset-part-1 | Apr 18, 2023 |
| 11 | Fleet Management at Spotify Part 3: Fleet-Wide Refactoring | https://engineering.atspotify.com/2023/05/fleet-management-at-spotify-part-3-fleet-wide-refactoring/ | May 2023 |
| 12 | Sourcegraph Batch Changes overview | https://sourcegraph.com/docs/batch-changes | current |
| 13 | Batch Changes design | https://sourcegraph.com/docs/batch-changes/design | current |
| 14 | Batch spec YAML reference | https://sourcegraph.com/docs/batch-changes/batch-spec-yaml-reference | current |
| 15 | Bulk operations on changesets | https://sourcegraph.com/docs/batch-changes/bulk-operations-on-changesets | current |
| 16 | OpenRewrite: Lossless Semantic Trees | https://docs.openrewrite.org/concepts-and-explanations/lossless-semantic-trees | current |
| 17 | Moderne blog index | https://www.moderne.ai/blog | accessed 2026-10-12 |
| 18 | The PR is the easy part (Netflix, Airbnb, LinkedIn lessons) | https://www.moderne.ai/blog/automated-code-migration-lessons-netflix-airbnb-linkedin | Mar 23, 2026 |
| 19 | How to modernize at scale: Batch changes and mass PR issuance | https://www.moderne.ai/blog/how-to-modernize-at-scale-batch-changes-and-mass-pr-issuance-with-moderne | Apr 17, 2025 |
| 20 | AI didn't break coding. It broke code review. (Morgan Stanley talk) | https://www.moderne.ai/blog/ai-didnt-break-coding-it-broke-code-review | Jul 6, 2026 |
| 21 | Introducing Moderne's multi-repo AI agent (Moddy) | https://www.moderne.ai/blog/introducing-moderne-multi-repo-ai-agent-for-transforming-code-at-scale | Mar 4, 2025 |
| 22 | Moderne Changelog: change intelligence for multi-repo systems | https://www.moderne.ai/blog/moderne-changelog-multi-repository-change-intelligence | May 19, 2026 |
| 23 | Airbnb: Accelerating Large-Scale Test Migration with LLMs | https://airbnb.tech/?p=366 (Medium mirror 403) | ~Mar–Apr 2025 |
| 24 | Block: From Base Web to Fluent UI without a flag day | https://engineering.block.xyz/blog/from-base-web-to-fluent-ui-without-a-flag-day | Apr 6, 2026 |
| 25 | The New Stack: How Block manages its fleet of AI coding agents from Slack (body not retrieved) | https://thenewstack.io/how-block-manages-its-fleet-of-ai-coding-agents-from-slack/ | n/a |
| 26 | AWS: Amazon Q Developer just reached a $260 million dollar milestone | https://aws.amazon.com/blogs/devops/amazon-q-developer-just-reached-a-260-million-dollar-milestone | Aug 1, 2024 |
| 27 | AWS Transform custom: Getting Started | https://docs.aws.amazon.com/transform/latest/userguide/custom-get-started.html | current |
| 28 | AWS What's New: AWS Transform custom GA | https://aws.amazon.com/about-aws/whats-new/2025/12/transform-custom-organization-wide-modernization | Dec 1, 2025 |
| 29 | Gerrit: Cross-repository changes (topics) | https://gerrit-review.googlesource.com/Documentation/cross-repository-changes.html | current |
| 30 | Zuul: Project Gating | https://zuul-ci.org/docs/zuul/latest/gating.html | current |
| 31 | Zuul: Queue configuration | https://zuul-ci.org/docs/zuul/latest/config/queue.html | current |
| 32 | GitLab: Merge request dependencies | https://docs.gitlab.com/user/project/merge_requests/dependencies/ | current |
| 33 | GitHub: Managing a merge queue | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue | current |
| 34 | GitHub: About security campaigns | https://docs.github.com/en/code-security/securing-your-organization/fixing-security-alerts-at-scale/about-security-campaigns | current |
| 35 | Renovate: Noise reduction | https://docs.renovatebot.com/noise-reduction/ | current |
| 36 | Renovate: Configuration options (first 100k chars) | https://docs.renovatebot.com/configuration-options/ | current |
| 37 | Dependabot: Optimizing PR creation for version updates | https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/optimizing-pr-creation-version-updates | current |
| 38 | Nx: The Monorepo Advantage for AI Agents | https://nx.dev/blog/the-effect-of-monorepos-on-the-effectiveness-of-ai-agents | Jul 22, 2026 |
| 39 | Nx: The Missing Multiplier for AI Agent Productivity | https://nx.dev/blog/the-missing-multiplier-for-ai-agent-productivity | Jan 9, 2026 |
| 40 | Background Agents Summit: Inside Uber's agent-ready platform behind 11% of merged PRs | https://background-agents.com/summit/sessions/nikhil-ramakrishnan/ | May 7, 2026 |

Not opened (search snippets only, treated as [secondary]): InfoQ and Pragmatic Engineer coverage of Airbnb; ZenML and openclawdatabase recaps of Uber; ByteByteGo and InfoQ coverage of Stripe Minions; Augment Code monorepo pieces; The New Stack and fanaticalfuturist coverage of Amazon's 30,000-app figure.

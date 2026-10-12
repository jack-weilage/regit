# 04: OpenAI developer material on Codex (parallelism, environments, PRs, review, merge)

Researcher key: `04-openai-developers-codex`. Written 2026-10-12.

Tags: **[read]** means verified from a page or PDF I opened. **[secondary]** means coverage, a search summary or a third-party write-up. **[inference]** means my own reasoning.

Method note. openai.com/index/* pages return a Cloudflare challenge (HTTP 403) to WebFetch and curl. I read three openai.com posts (harness engineering, Introducing Codex, upgrades to Codex, GA) through a text-rendering reader before I was told not to use reader proxies. After that I stopped using them, so I could not open "Unrolling the Codex agent loop" or the GPT-5.3-Codex post. The Codex docs have moved from developers.openai.com/codex to **learn.chatgpt.com/docs** (developers.openai.com `.md` URLs now serve the same content). I read them as Markdown twins. The shared web-search budget ran out partway through. Because of that, the planned sweep of Hacker News threads and openai/codex GitHub issues for user pain did not happen, and that section is thin (see Open questions).

---

## Summary

1. **The brief's OpenAI "harness engineering" claims are verified, with nuance.** About 1,500 PRs were "opened and merged with a small team of just three engineers driving Codex" over about five months. That is 3.5 PRs per engineer per day, and throughput *rose* as the team grew to seven. The repo holds about a million lines and has "0 lines of manually-written code". Humans "may review pull requests, but aren't required to"; review moved "almost entirely" agent-to-agent; there are "minimal blocking merge gates"; and "our bottleneck became human QA capacity." [read]
2. **OpenAI independently built "every change is bootable" and "proof, not diff".** The harness team made the app "bootable per git worktree", gave each worktree an ephemeral logs, metrics and traces stack (LogQL/PromQL) that is torn down after the task, and wired in Chrome DevTools Protocol. The agent records a video of the bug and a second video of the fix before opening the PR. [read] This directly supports brief ideas 3 and 4. [inference]
3. **Agents merge their own PRs in that repo.** "They pull review feedback, respond inline, push updates, and often squash and merge their own pull requests." Flaky tests get re-runs rather than blocking: "corrections are cheap, and waiting is expensive." [read]
4. **Entropy is handled by "garbage collection" agents.** Humans used to spend every Friday (20% of the week) cleaning "AI slop". This was replaced by "golden principles" in the repo plus recurring background Codex tasks that open small refactoring PRs, "most of these can be reviewed in under a minute and automerged." [read] The brief's claim is verified.
5. **Codex has no landing, merge-queue or conflict machinery.** Across the Codex changelog (May 2025 to Oct 2026) and docs I found PR creation, PR status badges, PR review, "update existing PRs" and stack detection. I found no rebase, merge-queue or conflict-resolution feature. `codex apply` simply "exits non-zero if `git apply` fails (for example, due to conflicts)." [read] The brief's thesis that "nobody owns landing" extends to OpenAI. [inference]
6. **Parallelism is per-task isolation, not coordination.** Each cloud task gets its own VM from a *published environment* (prepared filesystem snapshot). Locally, the unit is a Codex-managed git worktree in detached HEAD (default cap of 15 kept). Best-of-N runs 1 to 4 attempts per task (`codex cloud exec --attempts 1-4`, shipped 2025-06-13). [read] The docs warn: "Be more careful with parallel write-heavy workflows, because agents editing code at once can create conflicts and increase coordination overhead." [read]
7. **Codex's internal core object is already a "thread".** The open-source app-server protocol has `thread/start`, `thread/resume`, `thread/fork` (with `forkedFromId`), `thread/goal/set`, `turn/steer`, `review/start`, and `turn/diff/updated` events. Thread logs are persisted as JSONL. [read] A thread-native forge could ingest Codex threads natively. [inference]
8. **The automated code reviewer is OpenAI's main "verification at scale" bet.** Every internal PR is reviewed (talk transcript: "100% of the PRs published within OpenAI internal repositories"). It handled over 100k external PRs per day as of Oct 2025. 52.7% of comments lead to an author code change, and over 80% of reactions are positive. On Codex-cloud-generated PRs it comments on 36%, and 46% of those comments lead to a change. [read]
9. **The reviewer is tuned for precision over recall.** It flags only P0/P1 on GitHub. It accepts "modestly reduced recall" and posts a comment only if expected benefit exceeds verification cost plus false-alarm cost. Repo context and code execution beat diff-only review. Review rules live in a `## Code Review Rules` section of scoped `AGENTS.md` files; rule guidance recovered 98% of required custom findings versus 58.3% baseline. [read]
10. **Verification gets harder on model-written code.** Reviewer recall "drops more quickly with thinking budget on model-generated code than on human-written code." The authors call over-reliance a "serious risk", and the talk names the risk of the generator learning to evade a reviewer that shares its model. [read]
11. **PR volume is the pain OpenAI itself names.** "At OpenAI, weekly PR volume has more than doubled since Q4 … code review can quickly become the bottleneck" (July 2026). In Oct 2025 engineers merged "70% more pull requests each week". [read]
12. **OpenAI's own guidance is inconsistent on humans in the merge loop.** The harness post makes human review optional. The AI-native guide says engineers "own the final review and merge process". Product docs say Codex review is "an additional reviewer—not a replacement for human reviews" and doesn't replace "branch protections, or required approvals". [read]
13. **openai/codex no longer accepts external PRs** (policy clarified 2026-08-17). The stated reason is that review of outside PRs costs more than reimplementing, and "implementation is comparatively straightforward with the help of Codex itself." [read] This is strong evidence for the brief's idea 8 premise (unsolicited diffs are a burden), but it suggests maintainers want *intent plus evidence* (issues with root-cause analysis), not code. [inference]
14. **"OpenAI is building its own GitHub alternative" remains secondary only.** It traces to The Information (Mar 2026), motivated by GitHub outages, "months away" and early. I found no primary OpenAI confirmation, and as of Oct 2026 the Codex docs remain GitHub-centric: GitLab review is in preview, and cloud environments don't support GitLab or GHES. [secondary]/[read]

---

## Detailed findings

### A. Harness engineering: OpenAI's agent-first repo (verifies the brief's OpenAI claims)

Source: "Harness engineering: leveraging Codex in an agent-first world", https://openai.com/index/harness-engineering/ (author Ryan Lopopolo, Feb 11 2026 per search summary [secondary]; content [read]).

- **Scale.** "Five months later, the repository contains on the order of a million lines of code … roughly 1,500 pull requests have been opened and merged with a small team of just three engineers driving Codex. This translates to an average throughput of 3.5 PRs per engineer per day, and surprisingly the throughput has _increased_ as the team has grown to now seven engineers." The product has "hundreds of users internally". They estimate 1/10th the time of hand-writing. [read]
- **How a PR is driven.** "An engineer describes a task, runs the agent, and allows it to open a pull request. To drive a PR to completion, we instruct Codex to review its own changes locally, request additional specific agent reviews both locally and in the cloud, respond to any human or agent given feedback, and iterate in a loop until all agent reviewers are satisfied (effectively this is a Ralph Wiggum Loop)." [read]
- **Review.** "Humans may review pull requests, but aren't required to. Over time, we've pushed almost all review effort towards being handled agent-to-agent." [read]
- **Merge philosophy** (section titled "Throughput changes the merge philosophy"). "The repository operates with minimal blocking merge gates. Pull requests are short-lived. Test flakes are often addressed with follow-up runs rather than blocking progress indefinitely. In a system where agent throughput far exceeds human attention, corrections are cheap, and waiting is expensive." Also: "They pull review feedback, respond inline, push updates, and often squash and merge their own pull requests." [read]
- **Bottleneck is QA.** "As code throughput increased, our bottleneck became human QA capacity." [read]
- **Bootable per worktree.** "We made the app bootable per git worktree, so Codex could launch and drive one instance per change. We also wired the Chrome DevTools Protocol into the agent runtime and created skills for working with DOM snapshots, screenshots, and navigation." [read]
- **Ephemeral observability per change.** "Logs, metrics, and traces are exposed to Codex via a local observability stack that's ephemeral for any given worktree … torn down once that task is complete. Agents can query logs with LogQL and metrics with PromQL." This makes prompts like "ensure service startup completes in under 800ms" tractable. [read]
- **End-to-end autonomy list.** From a single prompt the agent can validate codebase state, reproduce a bug, "record a video demonstrating the failure", implement a fix, validate by driving the app, "record a second video demonstrating the resolution", open a PR, respond to feedback, remediate build failures, "escalate to a human only when judgment is required", and "merge the change". Caveat: "should not be assumed to generalize without similar investment." [read]
- **AGENTS.md as map, not manual.** "One big AGENTS.md" failed. They now use a ~100-line AGENTS.md as a table of contents, with a structured `docs/` as system of record, linters and CI that validate freshness and cross-links, and a "doc-gardening" agent that opens fix-up PRs. Execution plans are checked in "with progress and decision logs". [read]
- **Architecture enforced mechanically.** Fixed layers (Types → Config → Repo → Service → Runtime → UI), with cross-cutting concerns entering through "Providers" and enforced by custom lints whose error messages "inject remediation instructions into agent context". "This is the kind of architecture you usually postpone until you have hundreds of engineers. With coding agents, it's an early prerequisite." [read]
- **Entropy and GC.** "Our team used to spend every Friday (20% of the week) cleaning up 'AI slop.' Unsurprisingly, that didn't scale." This was replaced by "golden principles" plus "a set of background Codex tasks that scan for deviations, update quality grades, and open targeted refactoring pull requests. Most of these can be reviewed in under a minute and automerged." [read]
- **Open question they admit.** "What we don't yet know is how architectural coherence evolves over years in a fully agent-generated system." [read]

Forge implications: a thread's evidence should include *recordings* and an *ephemeral per-change observability stack*. There should be an auto-merge "low-risk lane" for GC-style PRs. Lints should emit agent-readable remediation. Flake handling should default to re-run, not block. [inference]

### B. Codex cloud: tasks, environments, sandboxes

- **Launch framing (May 16 2025).** "A cloud-based software engineering agent that can work on many tasks in parallel … each task runs in its own cloud sandbox environment, preloaded with your repository." Tasks take "between 1 and 30 minutes". "Once Codex completes a task, it commits its changes in its environment. Codex provides verifiable evidence of its actions through citations of terminal logs and test outputs." At launch, internet was disabled during the agent phase. OpenAI said "the asynchronous, multi-agent workflow introduced by Codex in ChatGPT will become the de facto way engineers produce high-quality code." Source: https://openai.com/index/introducing-codex/ [read]
- **Legacy task lifecycle** (still used for Code Review, GitHub and Linear). (1) Create a container and check out the repo at a branch or SHA. (2) Run the setup script, plus an optional maintenance script on cached resume. (3) Apply internet settings: setup has internet, agent internet is off by default. (4) The agent loops on terminal commands, using AGENTS.md for lint and test commands. (5) The agent "shows its answer and a diff … You can open a PR or ask follow-up questions." Containers are cached "for up to 12 hours". The cache is shared across all users of the environment in Business/Enterprise. **Secrets are available only to setup scripts and "removed before the agent phase starts."** Default image is `codex-universal`. Source: https://developers.openai.com/codex/cloud/environments.md [read]
- **Container caching numbers (2025-08-21 changelog).** "Codex now caches containers to start new tasks and follow-ups 90% faster, reducing the median start time from 48 seconds to 5 seconds." Automatic environment setup "reduces test failures for new environments by 40%." Source: https://learn.chatgpt.com/docs/changelog [read]
- **Early operational numbers (2025-05/06 changelog).** "Reduced PR creation latency by 35%", "Reduced GitHub disconnects by 90%", "Fixed creating branches when there's a branch name conflict", task diff limit raised "from 1 MB to 5 MB", setup script limit raised 5 → 10 → 20 minutes, and "Update existing PRs … when following up on a task" (2025-06-03). For PRs, binary files were limited to delete and rename only. [read]
- **New reusable cloud environments (DevDay 2026, Sep 29 2026).** "A cloud environment is the reusable setup that tasks use: repositories, dependencies, tools, and access settings … Each new task gets its own isolated workspace from the published environment." Publishing "captures the prepared filesystem for new tasks." Existing tasks keep their own saved state, including uncommitted changes. "Repository refresh runs automatically in the background." "Saved state doesn't replace source control." VM sizes are 2 vCPU/8 GiB/8 GiB disk (Plus) and 4 vCPU/16 GiB/32 GiB (Pro/Business/Enterprise). Saved VM state is recoverable for up to seven days. Current limitations: no computer/browser use in cloud, and **no GitLab or self-hosted GHES**. Source: https://learn.chatgpt.com/docs/environments/cloud-environments.md [read]; DevDay page https://learn.chatgpt.com/docs/whats-new/devday-2026.md [read]
- **Credentials pattern.** With **network secrets**, "Programs receive a placeholder; the proxy substitutes the real value for allowed destinations … it doesn't put the raw credential in a local process or file" (HTTPS/443 only). There is also a personal vault, Tailscale VPN with reusable+ephemeral keys, and OIDC short-lived cloud credentials (Enterprise by request). [read] This is the same idea as the Cloudflare Sandbox "credentials stay outside" model in the brief. [inference]
- **Legacy is being deprecated.** "Codex Cloud (Legacy) continues to support Code Review and the Linear and GitHub integrations. We plan to deprecate this experience." [read]
- **Prompt-injection risk in agent internet access.** The docs walk through a malicious GitHub issue instructing `git show HEAD | curl … POST` to exfiltrate. The recommendation is to restrict domains and to restrict methods to GET/HEAD/OPTIONS. Source: https://learn.chatgpt.com/docs/cloud/internet-access.md [read]

### C. Parallelism: best-of-N, worktrees, subagents, background work

- **Best-of-N (2025-06-13 changelog).** "Codex can now generate multiple responses simultaneously for a single task, helping you quickly explore possible solutions to pick the best approach." [read] The CLI reference shows `codex cloud exec --attempts` with type "1-4", default "1": "Number of assistant attempts (best-of-N) Codex cloud should run." `codex cloud list --json` returns `attempt_total` per task. Source: https://learn.chatgpt.com/docs/developer-commands?surface=cli [read] A third-party post says each attempt has its own container. [secondary]
- **How OpenAI uses best-of-N.** "For more complicated tasks, you can review several iterations and combine parts of different responses to get a stronger result." The same guide says Codex works best on tasks of "about an hour" or "a few hundred lines". Use "the Codex task queue as a lightweight backlog". Source: "How OpenAI uses Codex" PDF https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1a4-af0cfbd38630/how-openai-uses-codex.pdf [read] At DevDay 2025, a 404 page was built with two best-of-N attempts and chosen from "the preview screenshots in Codex". The beat-pad demo iterated on "multiple different designs in parallel". Engineers "run 3-4 completely independent tasks at the same time", and one had "seven (!!) different terminals open, each with an instance of Codex CLI." Source: https://developers.openai.com/blog/codex-at-devday [read]
- **Selection is manual.** Nothing I read describes automated ranking or merging of best-of-N attempts. The human picks, often from screenshots, or combines parts by hand. [read for absence in docs read; inference that no auto-selection exists]
- **Local worktrees.** "Worktrees let Codex run multiple independent chats in the same project." They are created in `$CODEX_HOME/worktrees` in **detached HEAD** "so Codex can create several worktrees without polluting your branches." Handoff moves a chat between Local and Worktree because "Git only allows a branch to be checked out in one place at a time". By default Codex keeps "your most recent 15 Codex-managed worktrees" and snapshots before deleting. `.worktreeinclude` copies ignored files (e.g., `.env`). Source: https://learn.chatgpt.com/docs/environments/git-worktrees.md [read]
- **Coordination.** Changelog 2026-05-29: "Added thread coordination for local projects and worktrees, including separate background threads when explicitly requested." [read] The docs gave no mechanism details, so whether it detects overlapping edits is unknown.
- **Subagents.** These are spawned in parallel with a cap of `agents.max_concurrent_threads_per_session` (examples use 6 and 8). The guidance is to use parallel agents "for read-heavy tasks such as exploration, tests, triage, and summarization. Be more careful with parallel write-heavy workflows, because agents editing code at once can create conflicts and increase coordination overhead." Source: https://learn.chatgpt.com/docs/agent-configuration/subagents.md [read]
- **Background and event-driven work.** Scheduled tasks can run "on dedicated background worktrees". Since 2026-08-25, tasks can trigger on "pull request activity such as reviews, comments, commit updates, and merges". "When matching events arrive close together, ChatGPT may combine them in one run." A suggested pattern is a scheduled task "babysitting a pull request". Sources: https://learn.chatgpt.com/docs/automations.md, changelog [read]
- **Long horizon.** GPT-5-Codex worked "independently for more than 7 hours" (Sep 2025). A GPT-5.3-Codex experiment "ran for about 25 hours uninterrupted, used about 13M tokens, and generated about 30k lines of code", kept on track by durable Prompt.md/Plan.md files with "done when" checks. Sources: https://openai.com/index/introducing-upgrades-to-codex/ [read]; https://developers.openai.com/blog/run-long-horizon-tasks-with-codex (Feb 23 2026) [read]

### D. PR creation and GitHub integration

- **Cloud tasks end in "commit or open a pull request when ready".** You can update existing PRs on follow-up (since June 2025). PR status badges (draft/open/merged/closed) were added to task rows in Feb 2026. [read]
- **`@codex` in PR comments.** `@codex review` triggers a review. "If you mention `@codex` in a comment with anything other than `review`, Codex starts a legacy cloud chat using your pull request as context", e.g., `@codex fix the CI failures`. `@codex fix the P1 issue` "can push a fix back to the branch when it has permission". Source: https://learn.chatgpt.com/docs/third-party/github.md [read]
- **Slack.** Tag @Codex, and it gathers context, "choose[s] the right environment, and answer[s] with a link to the completed task … From there, you can merge its changes." Source: https://openai.com/index/codex-now-generally-available/ (Oct 6 2025) [read]
- **Linear.** A chat "runs against the default branch of the first repository listed in that environment's repo map". When done, "it posts a summary and a link to the completed chat so you can create a pull request." Source: https://learn.chatgpt.com/docs/third-party/linear.md [read]
- **CI autofix with privilege separation.** In OpenAI's documented pattern, the Codex job runs with `contents: read` only and serializes its diff as a patch artifact. A *separate* job "receives repository write permissions, but it does not receive `OPENAI_API_KEY`", applies the patch, and opens a PR on branch `codex/auto-fix-$RUN_ID`. The GitHub Action defaults to `safety-strategy: drop-sudo`. Sources: https://learn.chatgpt.com/docs/non-interactive-mode.md, https://learn.chatgpt.com/docs/github-action.md [read] In other words, the agent produces a patch and a separate, unprivileged-to-the-model service writes. [inference]
- **Desktop Code Review surface.** It has a PR inbox, "Mark as viewed", and **"Stack"**: "For changes split across dependent pull requests, use Stack in Summary … This section appears when Code Review finds a stack of open pull requests." "Fix" in Checks attaches failing checks to a chat. "Reviewing a pull request in chat doesn't post comments, approve it, or merge it." Source: https://learn.chatgpt.com/docs/code-review.md [read]

### E. Merging and conflicts (what is *absent*)

- I found no changelog entry mentioning merge queues, rebase, or conflict resolution. The only "conflict" hit is "Fixed creating branches when there's a branch name conflict" (May 2025). [read]
- `codex apply` "exits non-zero if `git apply` fails (for example, due to conflicts)." [read]
- The worktree docs explain git's one-branch-per-worktree rule as a race-avoidance measure: "Allowing multiple worktrees to simultaneously check out the same branch would create ambiguity and race conditions around which worktree's operations update the branch reference, potentially leading to lost commits." [read] The same single-ref contention GitHub's post describes appears at the local scale. [inference]
- In the harness repo, agents "squash and merge their own pull requests" with minimal gates. Conflict handling is not described, so presumably the agent loop rebases or retries like Amp's Ship button. [read for quote; inference for mechanism]

### F. Automated code review: research and product

- **"A Practical Approach to Verifying Code at Scale"** (OpenAI Alignment blog, Dec 1 2025; Trębacz, Arnesen, Cassirer, Johnson, Lin, Sottiaux, and the Codex team). https://alignment.openai.com/scaling-code-verification/ [read]
  - Repo-wide tools plus execution are required. GPT-5 with repo access and execution "caught more critical issues and raised fewer false alarms" than diff-only review. Dedicated training improved results further.
  - Precision first: "modestly reduced recall" in exchange for signal quality. A finding is posted when P(correct) × cost saved exceeds verification cost plus false-alarm cost. Stylistic comments can have negative utility. "Safety requires adoption, so we optimize the reviewer for low safety tax and high precision."
  - Generator vs reviewer: they share an underlying model but use different training. Using one verifier as both a training reward model and a shipped reviewer "risks harming both."
  - Numbers: comments on **36%** of PRs fully generated by Codex cloud, with **46%** of those comments leading to a code change. On human PRs, **53%** lead to change. Overall, **52.7%** of comments lead to change. **Over 100k external PRs per day** as of Oct 2025. **Over 80%** positive reactions. Every PR at OpenAI is auto-reviewed, and many engineers run `/review` before pushing.
  - Budget: "even at a small fraction of the generator's token spend" the verifier catches a large share of high-severity issues. However, performance "drops more quickly with thinking budget on model-generated code than on human-written code."
  - Risks: over-reliance is "a serious risk". The reviewer is "not a replacement for careful judgment". They monitor whether the generator learns to game the checks, and so far the reviewer is "similarly effective on Codex-generated and human PRs."
- **Talk (FAR.AI, Nov 30 2025).** "100% of the PRs published within OpenAI internal repositories are reviewed by our code review model." Metrics tracked are unaddressed issues, reactions, and comments leading to change. The "oh no zone" is when code output outpaces human verification. Source: https://far.ai/events/sessions/maja-trbacz-a-practical-approach-to-verifying-code-at-scale [read, page summary plus transcript excerpts]
- **CriticGPT lineage (June 2024).** "LLM Critics Help Catch LLM Bugs" (McAleese, Pokorny, Nitishinskaya, Cerón Uribe, Trębacz, Leike). Model critiques were "preferred over human critiques in 63% of cases" on naturally occurring bugs, and models "catch more bugs than human contractors paid for code review". Human+CriticGPT teams "catch similar numbers of bugs to LLM critics while hallucinating less than LLMs alone". Force Sampling Beam Search trades real versus spurious issues. Source: https://cdn.openai.com/llm-critics-help-catch-llm-bugs-paper.pdf [read] The 2025 post says CriticGPT "was not suitable for deployment". [read]
- **Product behavior.** On GitHub, "Codex flags only P0 and P1 issues". Automatic review runs on PR events (originally "as they move from draft to ready"). Rules go in `## Code Review Rules` in the nearest `AGENTS.md`: "Codex applies the root and more-specific guidance that covers each changed file." "Leave mechanical checks in CI." "Code review rules guide Codex; they don't replace tests, branch protections, or required approvals." Security Review (research preview) triggers on PR open, every push, or alongside code review, with optional threat-model files. Sources: https://learn.chatgpt.com/docs/third-party/github.md, https://learn.chatgpt.com/docs/security/security-review.md [read]
- **Custom review rules post (Jul 20 2026).** "At OpenAI, weekly PR volume has more than doubled since Q4 … code review can quickly become the bottleneck." "Review gets harder when several changes arrive at once." In an eval, "rule-guided variants recovered 98% of the required custom findings, compared with 58.3% in the baseline control." They evaluated coverage, restraint, retention and actionability. The openai/codex repo itself keeps review rules in AGENTS.md (e.g., protecting the `rawResponseItem/*` wire names that Codex Cloud consumes). Source: https://developers.openai.com/blog/custom-code-review-rules-for-codex [read]
- **Earlier product claims.** "Codex now reviews the vast majority of our PRs, catching hundreds of issues every day" (Sep 15 2025). The reviewer "matches the stated intent of a PR to the actual diff, reasons over the entire codebase and dependencies, and executes code and tests." "We always recommend using Codex as an additional reviewer—not a replacement for human reviews." Source: https://openai.com/index/introducing-upgrades-to-codex/ [read] Cisco reported "reducing review times by up to 50%" (GA post). [read, customer claim]
- **AI-native guide.** "Code review doesn't necessarily make the pull request process faster, especially if it finds meaningful bugs – but it does prevent defects and outages." "Engineers delegate the initial code review to an agent, but own the final review and merge process." It recommends "tracking PR comment reactions as a low-friction way to mark good and bad reviews" and warns that "generalized models often nitpick." Source: https://cdn.openai.com/business-guides-and-resources/building-an-ai-native-engineering-team.pdf (undated; cites Aug 2025 METR, so likely late 2025) [read]
- **Auto-review at the sandbox boundary.** "Auto-review replaces manual approval at the sandbox boundary with a separate reviewer agent … a reviewer swap, not a permission grant." On denial, the main agent must find "a materially safer path or stop and ask." Source: https://learn.chatgpt.com/docs/sandboxing/auto-review.md [read]

### G. AGENTS.md and context

- Codex concatenates AGENTS.md files from the global level, then the repo root, down to the cwd, at most one per directory, with `AGENTS.override.md` taking precedence. It stops at `project_doc_max_bytes` (**32 KiB default**). Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md.md [read]
- agents.md site: "used by over 60k open-source projects". "At time of writing the main OpenAI repo has 88 AGENTS.md files." It is stewarded by an industry foundation, and Amp, Cursor, Factory, Jules and Codex are named as co-originators. Source: https://agents.md/ [read]
- ExecPlans (cookbook): self-contained living plan documents with progress and decision logs, so that "it should always be possible to restart from _only_ the ExecPlan." "Every ExecPlan must produce a demonstrably working behavior." Source: https://cookbook.openai.com/articles/codex_exec_plans [read]

### H. Codex as a platform (thread protocol)

- App-server protocol methods include `thread/start`, `thread/resume`, `thread/fork` ("copying stored history … returned threads include `forkedFromId`"), `thread/read`, `thread/list` (with `parentThreadId`/`ancestorThreadId` filters), `thread/goal/set|get|clear`, `turn/start`, `turn/steer`, `turn/interrupt`, `review/start`, `thread/metadata/update` (persisted `gitInfo`), and `turn/diff/updated` ("the latest aggregated unified diff across every file change in the turn"). Thread logs are JSONL files on disk. Source: https://learn.chatgpt.com/docs/app-server.md [read]
- "Codex as a platform" (Aug 19 2026): "The open-source Codex harness … manage[s] conversation state, stream execution, use tools, enforce configured sandbox and approval policies." The SDK is TypeScript (`@openai/codex-sdk`) plus Python (`openai-codex`) with `Sandbox.read_only/workspace_write/full_access` presets per turn, e.g., the same thread does "Review the diff only" with `read_only`. Sources: https://developers.openai.com/blog/codex-as-a-platform, https://learn.chatgpt.com/docs/codex-sdk.md [read]
- Instacart's "Olive" background coding-agent platform embeds the Codex SDK: "Engineers spin up a remote development environment and complete end-to-end tasks with a single click … cleans up tech debt like dead code and expired experiments." Source: GA post [read]
- Shared thread snapshots (2026-08-20) are read-only links to a local thread, with secret redaction. [read] This is a primitive "thread as shareable artifact". [inference]

### I. Adoption and scale numbers (OpenAI-reported)

- Oct 2025: daily usage grew "more than 10x since early August". GPT-5-Codex served "over 40 trillion tokens in the three weeks since launch". "Nearly all engineers use Codex today, up from just over half in July. They merge 70% more pull requests each week." [read]
- Jul 2026: weekly PR volume at OpenAI "more than doubled since Q4". [read]
- GPT-5-Codex uses 93.7% fewer tokens than GPT-5 on the bottom 10% of turns and "twice as long" on the top 10%. [read]

### J. Open-source contribution policy (openai/codex)

- "**We do not accept external code contributions or pull requests.** … Reviewing and iterating on those changes can take more time than implementing a fix directly … Understanding the problem, identifying the right solution, and prioritizing the work are typically the hard parts; implementation is comparatively straightforward with the help of Codex itself." The repo PR tab shows "Only collaborators can create PRs." The policy was clarified in commit #39089 on 2026-08-17. Sources: https://raw.githubusercontent.com/openai/codex/main/docs/contributing.md [read]; https://github.com/openai/codex/commits/main/docs/contributing.md [read]

### K. "OpenAI is building a GitHub alternative"

- Techzine (Mar 4 2026), citing The Information's anonymous sources: OpenAI is building a code-hosting platform after "a series of GitHub service interruptions"; it is "still months away from completion"; employees "considered making the code repository available to OpenAI's customer base." "The exact details about functionality are not yet known." Source: https://www.techzine.eu/news/devops/139267/openai-builds-development-platform-as-an-alternative-to-github/ [secondary] Other search-result coverage (Neowin, PYMNTS, Slashdot, Reuters via TradingView) repeats the claim. [secondary, snippets only]
- No mention of an OpenAI code host appears in any OpenAI developer page, changelog or DevDay 2026 note I read through Oct 9 2026. [read for absence]

---

## Pain points for agentic-scale development (as evidenced in OpenAI material)

1. **Review is the bottleneck, and it scales with PR count.** PR volume more than doubled (Jul 2026) and merges rose 70% per week (Oct 2025). "Code review can quickly become the bottleneck." [read]
2. **Human QA and attention are the binding constraint** once review is delegated: "our one truly scarce resource: human time and attention." [read]
3. **Verification is weaker on agent-written code** at a given budget (distribution shift), and the shared generator/reviewer model risks gaming. [read]
4. **Over-reliance on a clean review** is a named "serious risk". [read]
5. **Parallel writers conflict.** Subagent docs warn against write-heavy parallelism. Git allows one branch per worktree. `codex apply` fails on conflicts, and there is no forge-side resolution. [read]
6. **Entropy and drift.** Agents replicate existing bad patterns, which cost 20% of the team's week before automation. [read]
7. **Context rot.** A big AGENTS.md "crowded out" task context and went stale. There is a 32 KiB default cap. [read]
8. **Environment setup is the main source of agent error.** "Setting a startup script, environment variables, and internet access significantly reduces Codex's error rate." Early progress "was slower than we expected … because the environment was underspecified." [read]
9. **Best-of-N creates a selection burden** that falls on a human with screenshots. [read; inference on burden]
10. **Disk and resource sprawl.** "Worktrees can take up a lot of disk space", hence the cap of 15. Frequent schedules "can create many worktrees over time." [read]
11. **Platform dependence and outages.** GitHub outages reportedly pushed OpenAI toward its own host. [secondary] Codex Cloud supports only GitHub.com (no GitLab or GHES for cloud tasks). [read]
12. **Prompt injection via issues and PR text** that agents act on. The Action docs say to "sanitize prompt inputs from pull requests, commit messages, or issue bodies." [read]
13. **Unsolicited PRs cost more than they're worth.** openai/codex closed to outside PRs. [read]
14. **User-reported pain at scale (HN, GitHub issues, PR floods): not collected.** See Open questions.

## How OpenAI is solving them

- **Precision-tuned agent reviewer on every PR**, P0/P1-only, steerable through scoped `## Code Review Rules`, with reactions and "comment led to change" as quality metrics. [read]
- **Agent-to-agent review loops** ("iterate until all agent reviewers are satisfied") plus `/review` before push. [read]
- **Minimal merge gates, re-run flakes, agent self-merge** in the high-autonomy repo. [read]
- **Per-change bootable app, ephemeral observability, browser driving, and before/after videos** as evidence. [read]
- **Mechanical invariants:** custom lints with remediation text, layered architecture, structural tests. [read]
- **GC agents** that open sub-minute-reviewable, automerged cleanup PRs. [read]
- **Repo-as-system-of-record:** short AGENTS.md map, docs/ with CI freshness checks, checked-in ExecPlans with decision logs. [read]
- **Isolation for parallelism:** per-task VM from a published snapshot, detached-HEAD worktrees, best-of-N 1 to 4. [read]
- **Credential hygiene:** secrets only in setup, proxy-substituted network secrets, OIDC, and a read-only model job with a separate write job in CI. [read]
- **Event-driven agents** on PR activity and scheduled "PR babysitting". [read]
- **For OSS:** accept issues and root-cause analysis, not code. [read]

## Implications for a future forge

1. **Adopt the Codex thread protocol as an import format.** Codex already treats the thread (fork, goal, steer, review, diff events, JSONL log, `gitInfo`) as its unit. The forge's thread object can be a superset: store the JSONL log, `forkedFromId` lineage, goal, and per-turn diffs. That makes "the thread is the unit" interoperable rather than proprietary. [inference]
2. **Evidence types to support first-class: recordings (bug and fix videos), screenshots, per-change observability queries (LogQL/PromQL results), test output citations, and reviewer findings with priority.** OpenAI's highest-autonomy team converged on exactly these. [inference from read]
3. **Landing is still open territory.** Codex creates and updates PRs and reviews them, but leaves merge and conflict handling to GitHub and agent loops. A forge-side landing service (rebase, affected-test verification, batch, wake the losing thread with the other thread's intent) is differentiated against OpenAI's stack too. [inference]
4. **Merge policy should be evidence-typed and risk-tiered.** The harness repo shows a "GC lane" (automerge, sub-minute review), while the product docs keep branch protection and required approvals. A forge that encodes both as path- and risk-scoped policy reconciles OpenAI's two stances. [inference]
5. **Treat the reviewer as a policy input with known calibration, not as a gate.** Use P0/P1 severity, "comment led to change" rate, and reviewer-budget knobs, with higher budget for agent-authored changes given the faster recall drop-off. Run new reviewers in shadow mode. [inference from read]
6. **Best-of-N needs a comparison surface.** It should show N attempts side by side, each with its own bootable preview and evidence, and the forge (or a judge agent) ranks them on proof. This matches Cloudflare's "compare several changes and decide which ships." Codex today leaves this to a human glancing at screenshots. [inference]
7. **Privilege separation as architecture.** OpenAI's CI pattern (model job read-only producing a patch artifact, separate writer without the model key) is a clean template. Agents submit patches and intent, and only the landing service holds write on main. [inference]
8. **Environment equals published snapshot plus per-thread fork.** OpenAI's "publish environment → each task forks the prepared filesystem; existing tasks keep their state; repo refresh in background" maps directly to a container snapshot per repo plus a per-thread container. Benchmark: median start 48 s → 5 s via caching. [read + inference]
9. **Overlap awareness is a gap Codex hasn't closed publicly.** Subagent docs punt on write conflicts, and "thread coordination" is unspecified. Declared file and symbol claims (brief idea 6) would address something OpenAI explicitly warns about. [inference]
10. **OSS intake: "thread with proof" should look more like an issue than a PR.** openai/codex rejects code but wants reproductions, logs and RCA. A forge could accept an external thread whose *evidence and intent* are first-class, and let the maintainer's agent re-derive the change, rather than asking maintainers to review foreign diffs. [inference]
11. **Rules near code.** Scoped `AGENTS.md` review rules (98% vs 58.3% recall of custom findings) suggest the forge should index AGENTS.md per path and feed the applicable rules to both proof and review agents. [inference from read]
12. **Expect GitHub lock-in pressure.** OpenAI's own cloud product is GitHub.com-only, and reports say OpenAI is building its own host. A forge that speaks plain git, with Codex threads as importable objects, could sit beside either. [inference]

## Contradictions and pushback

- **Human review: optional or required?** The harness post says "Humans may review pull requests, but aren't required to". The AI-native guide says engineers "own the final review and merge process." The upgrades post says use Codex "as an additional reviewer—not a replacement for human reviews". The GitHub docs say "don't replace tests, branch protections, or required approvals." The Codex launch post said "It still remains essential for users to manually review and validate all agent-generated code." [read] The resolution seems to be that the no-human-review mode is an *experiment in one greenfield internal repo* with heavy harness investment ("should not be assumed to generalize"), not company policy. [inference]
- **Does AI review speed things up?** Cisco claims up to 50% faster reviews. OpenAI's own guide says AI review "doesn't necessarily make the pull request process faster." [read]
- **Brief nuance.** The brief says "three engineers merged about 1,500 pull requests". More precisely, ~1,500 PRs over ~5 months, started by three engineers, with the team now at seven. The product is an internal beta with hundreds of internal users and external alpha testers, not a mature production codebase. [read]
- **Brief nuance on "reversal beats prevention" (idea 7).** OpenAI's harness frames it as "corrections are cheap, waiting is expensive", but its GC process is *preventive drift control*, encoding taste as lints. Both exist. [read + inference]
- **Reviewer metric caveat.** "52.7% of comments lead to a change" is measured against issues that authors acted on. The authors note their test set "only includes issues humans already identified", so novel catches aren't measured. [read]
- **Best-of-N cost.** No OpenAI page I read quantified the compute or usage cost of N attempts, or the win-rate of N>1. Cloud tasks began counting toward usage limits on Oct 20 2025. [read for usage change; gap for cost]

## Open questions

1. **User-reported pain at scale** (Codex PR floods on OSS repos, noisy `@codex review` comments, cloud PR/branch handling, best-of-N cost): not gathered, because the shared search budget ran out. Leads include HN threads on "Codex code review" and "Codex cloud", openai/codex issues labeled `cloud`/`code-review`, and maintainer posts on agent-generated PR spam. Worth a follow-up pass.
2. How does Codex "thread coordination for local projects and worktrees" (2026-05-29) work? Does it detect overlapping file edits?
3. Does Codex Cloud rebase or refresh a task branch when main moves (the "Repository refresh … in the background" line), and how does it handle conflicts when updating an existing PR?
4. Is there any automated judge for best-of-N attempts in Codex, or is selection always human?
5. What did "Unrolling the Codex agent loop" (openai.com) and the GPT-5.3-Codex post say? They were blocked by 403 and not read.
6. Is OpenAI's rumored code host real and shipping? No primary source as of Oct 12 2026.
7. Merge rates and revert rates for Codex-authored PRs at OpenAI (e.g., "fewer merged PRs later need bug-fix follow-up", with no number given).
8. The DevDay 2025 Codex talk (YouTube Gr41tYOzE20) and DevDay 2026 Codex sessions: transcripts not read.

---

## Sources (opened)

| # | Title | URL | Date | How read |
|---|---|---|---|---|
| 1 | Harness engineering: leveraging Codex in an agent-first world | https://openai.com/index/harness-engineering/ | Feb 11 2026 (date per search summary) | Full text via reader (openai.com 403s direct fetch) |
| 2 | A Practical Approach to Verifying Code at Scale (OpenAI Alignment blog) | https://alignment.openai.com/scaling-code-verification/ | Dec 1 2025 | Full |
| 3 | A Practical Approach to Verifying Code at Scale (FAR.AI talk page) | https://far.ai/events/sessions/maja-trbacz-a-practical-approach-to-verifying-code-at-scale | Nov 30 2025 | Page summary plus transcript excerpts |
| 4 | LLM Critics Help Catch LLM Bugs (CriticGPT paper) | https://cdn.openai.com/llm-critics-help-catch-llm-bugs-paper.pdf | Jun 2024 | PDF abstract, intro, methods |
| 5 | Introducing Codex | https://openai.com/index/introducing-codex/ | May 16 2025 (update Jun 3 2025) | Full via reader |
| 6 | Introducing upgrades to Codex (GPT-5-Codex, code review) | https://openai.com/index/introducing-upgrades-to-codex/ | Sep 15 2025 (update Sep 23) | Full via reader |
| 7 | Codex is now generally available | https://openai.com/index/codex-now-generally-available/ | Oct 6 2025 | Full via reader |
| 8 | ChatGPT & Codex changelog | https://learn.chatgpt.com/docs/changelog | May 2025 – Oct 2026 | Full HTML converted, grepped and read in sections |
| 9 | Codex Cloud (overview) | https://developers.openai.com/codex/cloud.md (redirects to learn.chatgpt.com/docs/cloud) | current Oct 2026 | Full |
| 10 | Codex Cloud (Legacy) environments | https://developers.openai.com/codex/cloud/environments.md | current | Full |
| 11 | Cloud environments | https://learn.chatgpt.com/docs/environments/cloud-environments.md | current (DevDay 2026) | Full |
| 12 | Codex environments (Local/Worktree/Cloud) | https://learn.chatgpt.com/docs/environments/modes.md | current | Full |
| 13 | Worktrees | https://learn.chatgpt.com/docs/environments/git-worktrees.md | current | Full |
| 14 | Code review | https://learn.chatgpt.com/docs/code-review.md | current | Full |
| 15 | Review GitHub pull requests with Codex | https://learn.chatgpt.com/docs/third-party/github.md | current | Full |
| 16 | Security Review | https://learn.chatgpt.com/docs/security/security-review.md | current | Partial (setup and triggers) |
| 17 | Codex Security Cloud setup | https://learn.chatgpt.com/docs/security/setup.md | current | Grepped |
| 18 | Codex GitHub Action | https://learn.chatgpt.com/docs/github-action.md | current | Full |
| 19 | Non-interactive mode (codex exec, CI autofix) | https://learn.chatgpt.com/docs/non-interactive-mode.md | current | Relevant sections |
| 20 | Codex SDK | https://learn.chatgpt.com/docs/codex-sdk.md | current | Full |
| 21 | Codex App Server | https://learn.chatgpt.com/docs/app-server.md | current | Method list and thread sections |
| 22 | Subagents | https://learn.chatgpt.com/docs/agent-configuration/subagents.md | current | Relevant sections |
| 23 | Auto-review | https://learn.chatgpt.com/docs/sandboxing/auto-review.md | current | First half |
| 24 | Scheduled tasks (automations) | https://learn.chatgpt.com/docs/automations.md | current | Grepped |
| 25 | Custom instructions with AGENTS.md | https://learn.chatgpt.com/docs/agent-configuration/agents-md.md | current | Grepped |
| 26 | Codex Cloud (Legacy): internet access | https://learn.chatgpt.com/docs/cloud/internet-access.md | current | First half |
| 27 | Use Codex in Linear / Use ChatGPT in Slack / Teams | https://learn.chatgpt.com/docs/third-party/linear.md, https://learn.chatgpt.com/docs/third-party/slack.md, https://learn.chatgpt.com/docs/enterprise/teams.md | current | Grepped |
| 28 | DevDay 2026 (what's new) | https://learn.chatgpt.com/docs/whats-new/devday-2026.md | Sep 29 2026 | Full |
| 29 | What's new Sep 28–Oct 2 2026; Oct 5–9 2026 | https://learn.chatgpt.com/docs/whats-new/september-28-october-2-2026.md, https://learn.chatgpt.com/docs/whats-new/october-5-9-2026.md | Oct 2026 | Full |
| 30 | Codex CLI command reference (codex cloud exec --attempts) | https://learn.chatgpt.com/docs/developer-commands?surface=cli | current | Rendered HTML option tables |
| 31 | Codex docs index (llms.txt) | https://developers.openai.com/codex/llms.txt | current | Full |
| 32 | How Codex ran OpenAI DevDay 2025 | https://developers.openai.com/blog/codex-at-devday | Oct 2025 | Full |
| 33 | Custom Code Review rules for Codex | https://developers.openai.com/blog/custom-code-review-rules-for-codex | Jul 20 2026 | Full |
| 34 | Codex as a platform: build on the open agent harness | https://developers.openai.com/blog/codex-as-a-platform | Aug 19 2026 | Full |
| 35 | Automating repetitive work at OpenAI with Codex | https://developers.openai.com/blog/automating-repetitive-work-at-openai-with-codex | Aug 25 2026 | Full |
| 36 | Run long horizon tasks with Codex | https://developers.openai.com/blog/run-long-horizon-tasks-with-codex | Feb 23 2026 | First half |
| 37 | Mastering remote engineering work from your phone | https://developers.openai.com/blog/mastering-codex-remote-for-engineering | Jun 23 2026 | First half |
| 38 | How OpenAI uses Codex (PDF) | https://cdn.openai.com/pdf/6a2631dc-783e-479b-b1a4-af0cfbd38630/how-openai-uses-codex.pdf | 2025 (research-preview era) | Full |
| 39 | Building an AI-native engineering team (PDF) | https://cdn.openai.com/business-guides-and-resources/building-an-ai-native-engineering-team.pdf | c. late 2025 | Intro, Test, Review, Document sections |
| 40 | Codex Execution Plans (cookbook) | https://cookbook.openai.com/articles/codex_exec_plans | 2025 | Relevant portion |
| 41 | AGENTS.md | https://agents.md/ | current | Full |
| 42 | openai/codex contributing policy | https://raw.githubusercontent.com/openai/codex/main/docs/contributing.md | rev. Aug 17 2026 | Full |
| 43 | openai/codex commit history for contributing.md | https://github.com/openai/codex/commits/main/docs/contributing.md | Oct 2026 | Commit titles |
| 44 | GitHub changelog: Codex as agent provider in JetBrains | https://github.blog/changelog/2026-07-07-codex-as-agent-provider-and-agentic-enhancements-in-jetbrains-ides/ | Jul 7 2026 | Full (short) |
| 45 | Techzine: OpenAI builds development platform as an alternative to GitHub | https://www.techzine.eu/news/devops/139267/openai-builds-development-platform-as-an-alternative-to-github/ | Mar 4 2026 | Full (secondary) |

Search-result-only (not opened, used only as pointers): SiliconANGLE on DevDay 2026 environments (Sep 29 2026), codex.danielvaughan.com on best-of-N, Neowin, PYMNTS, Slashdot and TradingView/Reuters on the GitHub alternative, the forge.lthn.ai mirror of commit #5060 (`codex cloud exec`).

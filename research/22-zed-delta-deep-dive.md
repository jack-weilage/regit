# 22: Zed Delta and DeltaDB in depth, compared with Upwelling, Patchwork, Pijul and jj

Researcher key: `22-zed-delta-deep-dive`. Written 2026-10-12.

Tag legend: **[read]** means I opened the primary page and the claim is on it. **[secondary]** means coverage or a third party, such as The New Stack or HN commenters. **[inference]** is my own reasoning.

---

## Summary

1. **The brief's Delta claims hold up, with a few corrections.** [read]
   - **Verified:** PRs are off on Delta's own repo. The figure "33 of us have landed 570 changes to main since we turned off pull requests" is real. Review subthreads get forked worktrees. Git commits remain the checkpoint. `zed-industries/zed` stays on GitHub "for now". CI is triggered from an existing provider by the agent.
   - **Corrections:** The 570 changes landed in Delta's own repo, not the public Zed editor repo. The window is only about one week: PRs were turned off "last week" relative to 16 Sep 2026.
2. **Zed's plan to leave GitHub is real for internal work, not for the community repo.**
   - [read] The blog calls PRs "the first part of the GitHub workflow we're leaving behind" and says Git storage in DeltaDB is next.
   - [secondary] Sobo told The New Stack that Zed is "a few months away" from leaving GitHub internally. CI and releases still have to move. The public repo stays because "we have hundreds of monthly contributors who depend on that workflow."
3. **Delta's backend runs entirely on Cloudflare.** [read] Files, git commits, history packs and checkpoints are in R2. Per-thread deltas for active sync are in SQLite-backed Durable Objects. Metadata is in KV and D1. This shows that the brief's Cloudflare mapping matches what a shipping product actually uses.
4. **DeltaDB's data model is an operation-based CRDT over files plus conversation.** [read]
   - Every operation by a human or agent is named by actor plus Lamport timestamp.
   - A state between commits is named by "the Git commit it descends from and the set of actor-and-timestamp delta IDs applied above it."
   - Files are stored as fragments with stable identities. Anchors resolve spans across later edits.
   - Deltas cover file edits, file-tree changes, messages and comments.
5. **The anchor mechanism comes from Zed's 2022 multiplayer CRDT.** [read] An anchor is an (insertion id, offset) pair. Deleted text becomes a tombstone so old anchors still resolve. Deletions carry version vectors, and concurrent inserts are ordered by Lamport timestamp. This is the "comments survive code moving" property, and it is exact, not heuristic.
6. **Landing in Delta is not a platform service.** [read] "Land Changes" opens a Land subthread that runs the project's own landing skill, a prompt-defined workflow for checks, merge strategy and publish. The button "does not prescribe a Git workflow." A result card shows target branch, commit and reported CI status. This is the same agent-runs-the-loop model as Amp's Ship, so the brief's "neither owns landing" claim stands.
7. **Review subthreads have precise mechanics.** [read]
   - The review agent writes a "change guide."
   - Verdicts are Approve or Request Changes and are posted back to the parent.
   - Each verdict saves a snapshot of the review's edits. "Pull Changes" applies that snapshot, not later edits.
   - You cannot review a review. Merging worktrees is limited to one "thread family" (parent, subthreads and their forks).
8. **Delta has almost no agent safety today.** [read] It has no permission system, no sandbox, and no worktree trust: `.agents/prepare`, `.envrc` and AGENTS.md run or apply automatically. By contrast, Zed's own editor sandboxes agents by default since 1.14, using Seatbelt on macOS, bubblewrap on Linux and WSL on Windows.
9. **Access control is coarse.** [read] Sharing a thread grants repository-wide access to all Delta worktree history for each attached repo, including histories that are not attached to the shared thread. Access is planned to come from GitHub repo permissions ("Repository-based access", in progress).
10. **Compute is per participant, not central.** [read] When you send a message the agent runs on your machine. When a collaborator sends one, it runs on theirs. Browser turns have no shell. Cloud runners or a "remote runtime" are still on the roadmap as in progress.
11. **Reception on HN was large and split.** [secondary]
    - Size: 319, 529, 679 and 154 points across four threads, with 100 to 314 comments each.
    - Supporters: pair or mob programming fans, people who were early beta users, and reviewers who like asking the original agent "why."
    - Critics raised five themes: surveillance and privacy ("I don't want my thoughts to be serialized"), noise ("I'm not going to read another person's 100 turn slop factory"), lock-in and closed source, no merge gating, and the claim that jj or IntelliJ local history already do this.
12. **DeltaDB is not open source yet, despite the plan.** [read] The August 2025 Sequoia post said "build it, open-source it, and offer an optional paid service." [inference] I found no public DeltaDB repo in the zed-industries org; the only related repos are `delta-nix` and `cargo-deltabuild`.
13. **The adjacent research supplies what Delta lacks for a forge.** [read]
    - **Upwelling:** drafts "float" on the stack, so every merge auto-rebases all other drafts. The property is that what the reviewer read is exactly what lands. It needs a single serialized merge point.
    - **Pijul:** stable line identity and commuting changes.
    - **jj:** a lock-free operation log, stable change IDs, and first-class conflicts.
14. **What a forge should adopt** [inference]:
    - **Adopt:** span anchors with stable identity on the server, recorded intermediate states (checkpoints) tied to messages, review as a forked child thread with snapshot-pinned verdicts, an operation log for every forge mutation, and first-class conflict objects.
    - **Editor-specific; skip for a forge:** live character-level co-editing of one worktree, the conversation-as-document UI, and per-keystroke capture of human edits.

---

## Detailed findings

### A. Timeline and financing

- **2021:** Zed founded "to move beyond the constraints of commits." [read] https://zed.dev/blog/introducing-deltadb
- **1 Dec 2022:** Sobo's post "How CRDTs make multiplayer text editing part of Zed's DNA" sets out the anchor, tombstone and Lamport machinery DeltaDB later reuses. Zed was then "135k lines of Rust." [read] https://zed.dev/blog/crdts
- **QCon New York 2018:** Sobo, then on GitHub's Atom team, presented "Real-Time, Fine-Grained Version Control with CRDTs." The talk "explores how Github is using them in Eon to synchronize and persist changes to a repository at the granularity of individual keystrokes." [read; abstract only] https://www.infoq.com/presentations/github-crdt
  - [inference] Delta is effectively Sobo's second attempt at keystroke-level version control, after Eon at GitHub, and GitHub never shipped Eon.
- **20 Aug 2025, Sequoia round.** [read] https://zed.dev/blog/sequoia-backs-zed
  - "$32M Series B led by Sequoia Capital… bringing our total funding to over $42M."
  - Announced "a new kind of operation-based version control that incrementally tracks the evolution of your code with edit-level granularity."
  - "DeltaDB uses CRDTs to incrementally record and synchronize changes as they happen. It's designed to interoperate with Git."
  - It promises "character-level permalinks that survive any code transformation."
  - Business plan: "build it, open-source it, and offer an optional paid service."
  - Originally planned "integrating it into Zed." That changed in Aug 2026, when Delta became a separate app.
- **27 Aug 2025, ACP launched** with Gemini CLI as the reference implementation, and Claude Code beta on 3 Sep 2025. [read] https://zed.dev/blog/bring-your-own-agent-to-zed
  - It is "a minimal set of JSON-RPC endpoints," Apache-licensed, modelled on LSP.
  - "When you interact with third-party agents, nothing touches our servers."
- **28 Jan 2026:** the ACP Registry went live with Zed and JetBrains as clients. Listed agents include Claude Code, Codex CLI, GitHub Copilot CLI, OpenCode and Gemini CLI. "Register once… available to every ACP-compatible client." [read] https://zed.dev/blog/acp-registry
- **22 Apr 2026:** Zed added Parallel Agents, with a Threads Sidebar and per-thread worktree isolation. Zed says it "spent days loading the system with hundreds of threads." [read] https://zed.dev/blog/parallel-agents
- **11 Jun 2026:** "Software Is Made Between Commits" announced DeltaDB with a waitlist and a beta "in a few weeks." [read] https://zed.dev/blog/introducing-deltadb
- **5 Aug 2026:** Zed editor sandboxing landed, on by default from 1.14. [read] https://zed.dev/blog/sandboxing
  - Default rules forbid writes outside project directories, writes to `.git`, and network requests. Agents can request escalation.
  - "The agent may not request write access to .git, since this allows an agent to write hooks that run outside the sandbox."
- **12 Aug 2026:** "Introducing Delta" opened the private beta. [read] https://zed.dev/blog/introducing-delta
- **24 Aug 2026:** first Delta release, 0.1.1. By **9 Oct 2026** there had been about 28 releases, up to 0.19.2, and releases were almost daily through September. [read] https://delta.dev/docs/whats-in-the-latest
- **1 Sep 2026:** "Xanadu Was Waiting for Agents" is the most technical public description of DeltaDB. [read] https://zed.dev/blog/agentic-xanadu
- **16 Sep 2026:** public beta, "Replace PRs with Delta." [read] https://zed.dev/blog/delta-public-beta
- **6 to 8 Oct 2026:** Delta blog posts on worktrees, the September "Diff" newsletter, and non-engineers using Delta. [read] https://delta.dev/blog

### B. DeltaDB data model

**Deltas** [read] https://delta.dev/docs/concepts/delta-and-git
- "A delta is a recorded change to a thread or Delta worktree. It can represent a file edit, a change to the file tree, a message, a comment, or another update to shared state."
- "Each delta records who made the change and where it belongs in the thread's history."
- "Unlike a git commit, a delta is created continuously as work happens. You do not need to stage or commit it."
- So code edits and conversation events share one log.

**Naming and causality** [read] https://zed.dev/blog/agentic-xanadu
- "Every operation by every human and agent is named by an actor plus a Lamport timestamp, forever."
- "A Git commit hash names an exact immutable project state; DeltaDB names every state between commits by the Git commit it descends from and the set of actor-and-timestamp delta IDs applied above it."
- DeltaDB preserves "causal metadata… like which operation produced each fragment and what prior state it built on."
- [inference] This is a version-vector or op-set naming scheme anchored on a git base commit. It is close to Pijul's order-independent version identifiers, which must be "independent from the order" of commuting patches.

**Fragments and anchors** [read] https://zed.dev/blog/agentic-xanadu and https://zed.dev/blog/crdts
- "Underneath, DeltaDB represents it as fragments with stable identities. Those identities let us create anchors: references to spans that can still be resolved after surrounding code changes. A line number can express where text appears in one snapshot, while an anchor preserves which span we mean across snapshots."
- The 2022 post gives the mechanism:
  - Every insertion gets a unique id, made from a replica id plus a sequence number. "We refer to these (insertion id, offset) pairs as anchors."
  - Deletions leave tombstones, so "Fragments with tombstones are hidden… but they can still be used to resolve logical anchors."
  - Deletions carry a version vector, so concurrent inserts inside a deleted range are not wrongly hidden.
  - Concurrent inserts at one location are ordered by descending Lamport timestamp, with the replica id as a tie-break.
  - Undo uses an "undo map" of operation id to count, so each user can undo out of order.
- [inference] An anchor degrades gracefully. If the anchored text is deleted it still resolves, to a tombstoned position. If code is rewritten wholesale (delete plus insert), the anchor points at dead text. A UI must then show "this span was removed at delta X." The brief's "approximate" anchoring is the git-only fallback. DeltaDB's version is exact but still has to be told what to do when the anchored text is gone.

**Worktrees and checkouts** [read] https://delta.dev/docs/concepts/core-concepts, https://delta.dev/docs/concepts/worktrees
- A Delta worktree is "a copy of the project's files whose history is recorded in DeltaDB." The checkout is a real directory on a machine, and "Delta keeps the two copies in sync."
- Browser participants and browser agents edit the replicated representation directly, with no checkout.
- A thread has "one Delta worktree per project it works on."
- "Delta does not use git worktrees for its managed checkouts… to avoid limitations around how many threads can work on one branch."
- "Each workspace has its own Git clone (though we use some tricks to make them cheap)." Several agents can work "all working on the same branch. Delta can merge the changes back together before committing and pushing to Git." [read] https://delta.dev/blog/escaping-the-tyranny-of-worktrees
- **Import:** Delta imports every tracked file plus untracked files that are not ignored. Ignored files, such as `.env` and build output, are never recorded or synced. "Delta currently uses git as a way to bootstrap our syncing."
- **Two remotes:** each checkout gets `origin`, the shared upstream, and `local`, which points at your own clone. The agent can `git push local <branch>` to hand you work "without a round trip through GitHub." Delta moves commits between collaborators' machines "without a round trip through origin."
- **Jujutsu:** colocated jj repos have early support. Delta "preserves a managed checkout's Jujutsu operation log when the checkout is archived and restores it when the checkout is mounted again."

**Storage backend** [read] https://delta.dev/docs/privacy-and-security/data-storage
- "Delta's backend runs entirely on Cloudflare."

| Data | Where it is stored |
|---|---|
| File contents, git commits, history packs, checkpoints | R2 |
| Thread and Delta worktree deltas used for active sync | Durable Objects backed by SQLite |
| Account settings | Durable Objects backed by SQLite |
| Thread, repository, collaborator and account metadata | KV and D1 |

- "Each thread's history is stored under its own unique ID. Delta uses the Git remote URL to identify a repository within your organization."
- **Local retention:** archived synced threads drop local history after 3 days and re-download on open.
- **Deletion:** history is never rewritten. "We do not rewrite thread or git history." Account deletion is by email to privacy@zed.dev. HN critics called this out.
- **Secret redaction** [read] https://delta.dev/docs/privacy-and-security/security
  - Secrets are discovered locally (env vars, dotenv, mise, home-folder credential files, known token formats) and replaced with `[REDACTED]` "before thread content is stored, synchronized, or sent to a model provider."
  - Minimum length is 8 characters, 12 for all-digit values, and 16 for values recognized by shape alone.

**Implications for the brief** [inference]
- The brief proposes a Durable Object per thread for the log, D1 per repo for the index, and R2 for blobs. That is very close to Delta's actual layout.
- This is evidence the layout works in production. It also means a competition entry that copies DeltaDB's storage shape is not novel. The novelty has to come from landing and proof.

### C. Threads, subthreads, forks and subagents

All from [read] https://delta.dev/docs/agents/threads, https://delta.dev/docs/agents/subagents and https://delta.dev/docs/agents/review-and-sync.

- **Thread:** "A thread is a conversation with an agent and the basic unit of work in Delta."
  - It owns its Delta worktrees.
  - "Revert any thread to an earlier point. The conversation and the thread's project files rewind together."
  - Editing an earlier message discards everything after it.
- **Subthread** (Cmd+Shift+Enter, or `/subthread`):
  - It inherits the parent's conversation at the fork point. "The child's Delta worktrees start as copies of the parent's… file changes do not sync automatically in either direction."
  - You must ask the parent agent to merge the child's changes.
  - "Subthreads cannot start nested subthreads."
  - Subthread kinds are Plain, Reviews, Land and Subagents.
- **Fork:** you ask the agent to fork a thread by ID or link. The fork "starts from the source thread's recorded conversation and worktree state, then advances independently." There is no automatic merge back.
- **Subagents:** three profiles.
  - Worker implements with full tools. Scout gathers information. Reviewer checks changes.
  - Worker and Reviewer use isolated copies of the parent's worktrees. "Their changes merge back automatically on successful completion. Failed isolated work does not merge back."
  - Scout uses the parent's checkout directly.
  - Warning: "Scout and Reviewer do not have file-editing tools, but both can change files through terminal commands. Don't treat either profile as read-only."
  - Subagent status values are Queued, Running, Waiting to sync and Failed.
- **Cross-thread messages:** "Send your findings to @some-thread." These appear as Sent Agent Message and Received Agent Message events. "Sending a message does not merge file changes between threads." [read] https://delta.dev/blog/the-diff-2026-09
- **Orchestration:** on desktop, an agent in one thread can start other top-level threads. [read] same source.
- **Merging worktrees across threads** is restricted to "the same thread family: the top-level thread, its subthreads, or their forks. Independently created threads cannot be merged this way." It "brings in file changes, without copying conversations."
  - [inference] Merge is scoped to a lineage, so DeltaDB can only CRDT-merge states that share a common ancestor in its own op graph. Two unrelated threads that touch the same file can only meet through git.

### D. How review subthreads work

[read] https://delta.dev/docs/agents/review-and-sync

1. **Start:** use the eye button, `/review` or Cmd+Shift+R. "Reviews start only from a top-level thread; you cannot review a review." A thread can have several reviews.
2. **Change guide:** Delta asks the agent for "a structured walkthrough of the change in the order that explains it best, with focused inline diffs, rather than a file-by-file listing."
   - It focuses on what remains unmerged against the default branch.
   - A second review "notes what changed since the last verdict."
3. **Isolation:** "The review agent works in separate, forked Delta worktrees, so its edits do not change the parent's files. Finishing the review or submitting a verdict does not merge those edits."
4. **Verdict:** Submit Review gives Approve or Request Changes. The verdict is posted to the parent, and the reviewer's avatar shows a badge. Resubmitting updates the verdict, and "earlier verdicts remain in the parent thread's history." `/approve` and `/request-changes` work in any thread.
5. **Pulling fixes back:** "Each verdict saves a snapshot of the review's edits. Pulling applies that snapshot, not later edits; submit another verdict to include those."
   - If a pull fails partway, "some or all worktrees may already contain the changes."
   - The docs admit this edge case. Pull and merge are not atomic.
6. **Diff base:** "Delta records the branch diff's merge base and shares it with collaborators, so everyone compares against the same base." This includes on the web.
7. **"Seen" per file, per person:** the mark syncs across machines, and new edits to a file clear it.
8. **Comments** [read] https://delta.dev/docs/agents/comments
   - Comments attach to a selected span of transcript, file or diff.
   - They stay "pending until you next submit," then reach the agent in one batch.
   - The agent's reply is linked back to each comment.
   - Typing in a diff creates a comment by default, not an edit (the "comment mode" toggle).

**Forge reading** [inference]
- The verdict-snapshot design matters. An approval is bound to a specific set of edits, not to a moving branch. That is the same property the brief wants ("evidence points at exact code").
- Delta has no policy layer that makes a verdict *required* before Land. Landing is whatever the landing skill does.

### E. How changes land to git

[read] https://delta.dev/docs/agents/review-and-sync
- "Important: Delta records file edits as you work, without creating Git commits." Agent commits land in the managed checkout's own git repo. "Committing is not the step that brings work to you; pushing to local or your source remote is."
- **Land Changes** (desktop only, needs a model):
  - It opens a dedicated Land subthread and runs your project's landing skill.
  - With one eligible skill it runs directly. With several, you pick one with a slash command. With none, the agent offers to write one, after approval.
  - "The skill defines your checks, merge strategy, and publication steps; the button does not prescribe a Git workflow."
  - The result card shows "whether the change landed, with the target branch, commit, and reported CI status."
- **Other paths:**
  - push to `local`;
  - push to origin and open a PR, where the "Open in Delta Links" setting adds a thread link the reviewers can open;
  - or adopt your own folder as the checkout.
- **CI:** "Show CI status in threads, once you configure a GitHub PAT." Also "Cancelled GitHub Actions runs no longer appear as failed CI checks." [read] release notes. The blog says: "For now, an agent can trigger a run with an existing CI provider and check the results before landing the change. Longer term, content-based builds could bring CI-style verification directly into the thread." [read] public-beta post
- [secondary] Sobo to TNS: "CI as largely a solved problem… expects to integrate with existing options rather than build another system."

**Conclusion** [inference]: Delta has no merge queue, no trunk lock, no batching and no conflict hand-back. Conflicts are resolved by the agent in git: "Merge conflicts remain merge conflicts, though luckily agents don't seem to mind them." [read] worktrees blog.

### F. What "33 people landed 570 changes" means

- **Exact text** [read]: "it's already our daily driver: 33 of us have landed 570 changes to main since we turned off pull requests."
- **Time window** [read]: "Last week, we crossed a key milestone: we disabled pull requests on Delta's own repository." The post is dated 16 Sep 2026, so PRs were disabled around 7 to 11 Sep. That is roughly 5 to 9 days.
- **Rate** [inference]:
  - Overall: about 60 to 110 changes a day.
  - Per person: about 17 changes over the period, or roughly 2 to 3 a day.
  - Consistent with: the release notes show near-daily releases (0.6.0 on 3 Sep through 0.16.0 on 16 Sep, about 13 releases in 13 days).
- **Caveats** [inference]:
  - "Changes" is undefined. It could mean commits on main, Land operations, or squash-merged threads.
  - The repo is Delta's private repo, not the open-source `zed-industries/zed` repo, so this cannot be checked externally.
  - 33 people is close to the whole Zed team, so this is a single co-located, high-trust team on a young codebase.
  - It is evidence that PR-less trunk development works at about 30 people, the same scale as Amp's claim. It says nothing about thousands of agents on one branch.
  - [secondary] TNS repeats it as "33 developers have landed 570 changes to main without using pull requests," and the German aggregator zeli.app repeats it too. No independent verification exists.

### G. Plans to leave GitHub (verification)

- **Index summary** [read]: the Zed blog index describes the beta post with "Replacing pull requests is our first step toward replacing GitHub." https://zed.dev/blog
- **Public-beta post, section "Follow our quest to replace GitHub.com"** [read]:
  - "Pull requests are the first part of the GitHub workflow we're leaving behind… We're building better alternatives for the other workflows that bring developers to GitHub.com, starting with Git storage in DeltaDB."
  - Framing: "everyone is in a race to replace GitHub right now. Most contenders promise better uptime on top of the same old primitives."
- **Xanadu post** [read]: "You can keep mirroring your repo to GitHub… (that's our approach for our open source IDE, Zed, during this transitional period)."
- **Sobo quotes to The New Stack, 16 Sep 2026** [secondary; direct quotes] https://thenewstack.io/zed-delta-github-alternative/
  - Zed is "a few months away" from leaving GitHub for internal development.
  - "Zed's next major dependency is Git storage, which it intends to bring into DeltaDB, while CI and releases also need to move away from GitHub."
  - On the public repo: "We're moving more thoughtfully with Zed's public repo because we have hundreds of monthly contributors who depend on that workflow… GitHub has an established social component that will take longer to replace, and we're not going to strand contributors to prove a point."
  - "I believe the thread will replace the commit or branch as the fundamental unit of software development."
  - On industry structure: "Git became the common foundation because it was open… GitHub won the layer above through network effects. I expect lots of viable products will compete on the agent experience, with a common infrastructure underneath."
- **Counter-signal** [read]: Delta's own roadmap plans to use "your GitHub repository's existing permissions to control access." Sharing needs a git remote, usually GitHub. So in the near term Delta is a layer on GitHub, not a replacement.
- **Verdict:** VERIFIED as stated intent, with the internal versus community split. Not yet done.

### H. Roadmap (as of 12 Oct 2026)

[read] https://delta.dev/roadmap

| Status | Item | Description |
|---|---|---|
| In progress | Repository-based access | Use GitHub repo permissions |
| In progress | Remote runtime | Persistent cloud dev environments |
| In progress | Delta CLI | |
| In progress | MCP support | |
| In progress | @mentions | |
| In progress | ACP support | Bring Claude Code and other external agents in |
| Up next | Repository-level context | "comments and conversations across every worktree in a repository" |
| Up next | Sandboxing | |
| Up next | WSL support | |
| Up next | Conversation branching | |
| Up next | Graph view | "from conversations and agent work to branches and commits" |
| Up next | Read and View permissions | |

- **The roadmap is partly stale against the release notes** [read]:
  - @mentions with an Inbox shipped in 0.19.0 (7 Oct).
  - "The delta CLI is now available from your terminal" (0.18.x).
  - `delta cli thread delete/purge` exist.
  - Forking a thread already exists through the agent.
- **No "long-term" section on the roadmap page.** The brief's "verification inside the thread is a long-term idea" comes from the blog's "Longer term, content-based builds" line, not from the roadmap. That is a minor attribution fix.
- **Claude Code sync:** the Aug post says Delta connects to Claude Code harness sessions. The roadmap still lists ACP support as in progress.

### I. Agent safety and limits

[read] https://delta.dev/docs/privacy-and-security/agentic-safety
- "Delta does not have an agent permission system… does not ask before calling tools. This includes potentially destructive calls."
- "Delta does not sandbox agents. An agent has unrestricted access to the device where it runs."
- There is no worktree trust. `.agents/prepare` runs on first mount, `.envrc` runs through direnv and is auto-allowed, and AGENTS.md and skills become instructions.
- **Contrast:** the Zed editor post explicitly warns about this attack: "a PR contains a modified AGENTS.md that instructs your agent to upload $MY_SECRET_API_KEY… This has already happened." [read] https://zed.dev/blog/sandboxing

**Where the agent runs** [read] https://delta.dev/docs/concepts/worktrees
- "When you send a message, the agent runs on your machine using your checkout. When a collaborator sends a message, the agent runs on their machine."
- [inference] In a shared thread, a teammate's prompt executes unsandboxed on the teammate's machine. A malicious participant could steer the agent, but it runs with the steerer's own credentials.

**Shared resources** [read] worktrees blog
- "Separate checkouts do not create separate computers": ports, databases and containers are shared. Teams must make ports configurable.
- Setup goes in `.agents/prepare`, which runs on every new thread and must be fast. `.agents/linked` symlinks ignored files.

**Reliability**
- The release notes include several CRDT-merge fixes. For example, 0.18.0 says "Merging the same worktree changes on two machines at the same time no longer loses, duplicates, or misplaces text when the merge has no conflicts."
- Another fix: "Shared threads no longer get stuck syncing after reconnecting with offline changes."
- [inference] Replicated-worktree merge correctness was still being fixed weeks into the beta.

### J. ACP (Agent Client Protocol)

[read] https://agentclientprotocol.com/protocol/overview
- JSON-RPC 2.0.
- **Agent methods:** `initialize`, `authenticate`, `session/new`, `session/prompt`, and optionally `session/load` and `session/set_mode`.
- **Notifications:** `session/update` and `session/cancel`.
- **Client methods:** `session/request_permission`, and optionally `fs/read_text_file`, `fs/write_text_file` and terminals.
- **Transport:** local agents run as subprocesses over stdio. Remote agents use HTTP or WebSocket, but "Full support for remote agents is a work in progress."
- [secondary] One HN user explains a real failure mode. The Pi agent does not route file writes through ACP `fs/*` calls, so Zed never learns the file changed and shows stale buffers. [inference] This is why Delta prefers its own harness or a deep sync for Claude Code. Edit capture depends on the agent telling the client about writes, or on file watching.

**Forge implication** [inference]: ACP is an editor-to-agent protocol, not a forge protocol. It is useful for a forge that wants to host any agent in a sandbox and stream `session/update` events into the thread log. It says nothing about landing, review or provenance.

### K. Reception and criticism (HN, plus one trade outlet)

| Thread | Points | Comments | Date |
|---|---|---|---|
| "Sequoia backs Zed" | 450 | 325 | 2025-08-20 |
| "Software is made between commits" | 319 | 214 | 2026-06-11 |
| "Zed DeltaDB" | 529 | 307 | 2026-08-05 |
| "Delta" | 679 | 255 | 2026-08-12 |
| "Xanadu was waiting for agents" | 156 | 62 | 2026-09-01 |
| "Replacing Pull Requests with Delta" | 154 | 102 | 2026-09-16 |

All [secondary], via the HN Algolia API.

**Positive themes**
- "I've been using the beta of Delta for a couple weeks and using it for review is a huge improvement over reviewing directly on the PR… jump into a team mates thread and see the context." (kettlez)
- Pair or mob programming fans: "Two people (plus one or more agents) have the full context… Doing it together then merging the thread and moving on can be efficient." (nzoschke)
- "instead of asking 'why did you do it this way?' from a coworker, then waiting for them to proxy that to their AI, you can just do it yourself." (emerongi)
- "I do want the messy in-betweens. The earlier you catch problems, the cheaper they are to fix." (manmal)

**Critical themes**

1. *Noise versus curated artifacts.*
   - "The sequence of commits I present [is] purely optimized for reviewing, and not an actual record of what happened. I'm not going to read another person's 100 turn slop factory." (refactor_master)
   - "Those are not the artifacts. The changes are." (Robdel12)
   - "A commit is useful because you cleaned it up first." (Xotic007)
2. *Surveillance and privacy.*
   - "The code I write between commits is my thinking… I don't want my thoughts to be serialized." (tomjakubowski)
   - "gives micro-managers the data they need." (drdexebtjl)
   - "I really don't want management critiquing when I swear at Claude."
   - Upwelling's "fishbowl effect" research (section L) predicts exactly this objection.
3. *Lock-in, closed source and hosted storage.*
   - "it actually forces you to use their editor/agent harness." (ssijak)
   - "You also upload your code and conversations into their server-hosted DeltaDB service and the only way to remove it is to email their privacy contact." (ahknight)
   - "Doesn't appear to be opensource (and neither is DeltaDB)." (Palmik)
4. *No merge gating.*
   - "It sounds like it has no CI / merge gating solution. This doesn't look like a substitute for pull requests -- just a way of sharing edit history." (ch71r22)
   - The reply points to the Land skill: "I suppose that could be part of the land skill."
5. *Prior art and "already exists."*
   - jj: "Jujutsu already does this." Steve Klabnik replied: "while jj does that, it's entirely local on your machine, and not shared."
   - IntelliJ local history.
   - Google CitC/Piper: "full history at 'Ctrl-S' granularity… for at least 10 years" (jmole, unverified).
   - `git merge --no-ff` with `--first-parent`: "frequent auto-commits with less trust in git" (WorldMaker).
6. *Scale and live interference.*
   - "Bob hit 'save'… made a syntax error in a shared library… I would go insane." (jerf)
   - Mitigation: Delta isolates threads by default, so live interference only happens inside one shared thread.
   - "everyone building these git alternatives is missing… a multi-repo story." (pjm331)
   - "things can get confusing after more than two reviews + RBAC is another challenge." (samayashar)
7. *Review-guide skepticism.*
   - "The second video's Review Guide in TFA is way longer than the diff itself." (RomanKornev)
   - Similar attempts: Graphite "code tours" (April 2026) and CodeRabbit "change stack" (May 2026).
8. *Focus.* Many say the Zed editor's basics, such as file sync and Wayland, are neglected.

**Trade press** [secondary]
- The New Stack (Paul Sawers, 16 Sep 2026) adds context:
  - GitHub's "near-eight-hour disruption in August"
  - 2.9B commits a month by August
  - Cursor Origin
  - GitLab's "Project Switch," a "next-generation source-code management" project in private beta. This is a lead for other researchers.

### L. Ink & Switch: Upwelling and Patchwork

**Upwelling (March 2023)** [read] https://www.inkandswitch.com/upwelling/
- Authors: McKelvey, Jenson, Wagner, Cook, Kleppmann. Built on Automerge.
- **Model:** a document is a *stack* of merged layers. All edits happen in *drafts*, which are unmerged layers.
  - "Every edit to an Upwelling layer is tracked."
  - Drafts can be private or shared for real-time co-editing.
  - Merged layers are immutable.
- **Floating drafts.** This is the key idea for a landing service: "all drafts float on top of the stack… when one draft is merged, all other drafts are updated to include the changes in the merged layer. Using a Git analogy, every time a branch is merged into main, all other branches are automatically rebased."
  - Purpose: "if a reviewer reads a draft and then merges that layer onto the stack, the resulting document will be exactly the same as what they just read."
- **It needs serialized merges:** "Two collaborators concurrently merging different drafts… would violate the principle… One way of enforcing 'one merge at a time' would be to keep track of the latest stack on a server, and to allow writers to merge onto the stack only if approved by the server."
- **CRDT merge limits:** "if 'white' is changed to 'frosty' in one draft and to 'soft' in another… the merged result is either 'frostysoft' or 'softfrosty.'"
  - A deleted paragraph plus a concurrent edit inside it leaves orphan characters.
  - "since semantic conflicts cannot always be detected, human review of the merged result is necessary in any case. We therefore prioritized a design that makes reviewing changes easy rather than investing in more sophisticated merge behavior."
- **Avoiding conflicts:** use draft names to signal intent. Future work proposes reserving a section with a warning, and early warning "if changes to other drafts have affected parts of the document close to the section they're working on."
  - This is the brief's idea 6, "Agents see each other early."
- **Independent drafts:** "there should be no dependence between one draft and another." Dependent drafts "encouraged the use of long-lived branches."
- **Policy is social:** "Upwelling does not enforce any particular permissions… policy is governed by social rather than technical enforcement," and full attributed history makes mistakes recoverable.
- **Fishbowl effect:** "Real-time collaboration… can create stress when writers feel watched." "Writers don't want first drafts visible to the editor." This is the same objection HN raised against Delta.

**Patchwork (2024 to 2026)** [read] https://www.inkandswitch.com/patchwork/notebook/2024-version-control/ and https://www.inkandswitch.com/universal-version-control/
- **Dynamic history:** "Auto-save every character typed… Offer flexible views of the history… Allow users to mark important milestones." The same underlying changes can be grouped different ways, by author and by time.
- **Edit groups:** "After an edit session, you can retroactively supply rationale for particular edits, including grouping related edits together." The design principle is "formality on demand."
- **Simple branches:** create a branch retroactively from the current edit session. No branching from branches. Merging deletes the branch, so there is no cleanup step.
- **AI bots in version control (March 2024):** "an AI bot… makes changes as another collaborator… puts changes on a branch, which you can choose to partially or completely merge." Bots appear in history as users, and bot prompts are themselves versioned documents.
- **Automerge as substrate:** "Automerge never deletes anything… can compute an exact difference between two points in history… each character has its own ID."
- **History as chat:** "brief AI summaries are a remarkably useful way to understand writing edits at a high level—more successful than any of our other diff visualizations."
- **Universal comments:** apps declare "pointers" to commentable sub-parts, and a shared layer handles threads. The same pointers power diff highlighting.
- **Generalizing:** the team found "Branching and timeline are low-effort… Diff view and comments are more domain specific."

**Comparison with Delta** [inference]
- Delta is Upwelling and Patchwork applied to code plus agent transcripts, with one big difference.
  - Upwelling makes the *merge point* the place where review is guaranteed. Delta lets each thread's landing skill do whatever it likes.
  - Upwelling floats drafts on main. Delta subthreads do *not* auto-sync with the parent or main; each starts from a copy.
- So Delta has Patchwork's capture and commenting, but not Upwelling's "reviewed == merged" invariant. A forge should take that invariant.

### M. Pijul

[read] https://pijul.org/manual/why_pijul.html and https://pijul.org/manual/theory.html
- **Data model:** a file is a graph of vertices (byte ranges). "Vertices are uniquely identified, by the hash of the change that introduced them, along with a position in that change… a line keeps its identity, even if the change is applied in a totally different context."
  - The model is append-only. Deletion relabels edges, from alive to dead.
- **Commutation:** "for any two changes A and B, either A and B can be applied in any order, or A depends on B, or B depends on A." Changes can be unrecorded "without having to change the identity of new changes."
- **Associativity:** Git's diff3 can reorder lines in non-conflicting merges. Pijul preserves order.
- **Conflicts as state:** "edits from both sides of a conflict get applied without resolving the conflict. This guarantees no information ever gets lost." The three conflict kinds are no path between two alive vertices, a cycle, or zombie vertices.
- **Pijul is a CRDT:** "it is easy to show that Pijul implements a conflict-free replicated datatype (CRDT)… However, Pijul's datastructure models, in a conflict-free way, the conflicts."
- **Version identifiers** must be "independent from the order" of commuting patches.

**Comparison** [inference]
- DeltaDB's insertion-id-plus-offset anchors are the same idea as Pijul's change-hash-plus-position vertices, at character rather than line granularity, and with real-time replication.
- Pijul *records conflicts* rather than auto-resolving. Zed's text CRDT always converges, interleaving concurrent same-spot inserts.
- For a forge, Pijul's stance is better at *integration* time, where you want a conflict object to hand back to a thread. DeltaDB's stance is better at *live editing* time.

### N. Jujutsu's operation log

[read] https://jj-vcs.github.io/jj/latest/operation-log/, https://jj-vcs.github.io/jj/latest/technical/concurrency/, https://jj-vcs.github.io/jj/latest/conflicts/ and https://jj-vcs.github.io/jj/latest/glossary/
- **Op log:** "Each operation object contains a snapshot of how the repo looked at the end of the operation… a 'view' object… where each bookmark, tag, and Git ref… pointed, as well as the set of heads… and the current working-copy commit in each workspace." It also stores parent operations and metadata (timestamps, user, host, description).
  - Commands: `jj undo`, `jj op revert`, `jj op restore`, `--at-op`.
- **Lock-free concurrency:** "allows lock-free concurrency -- you can run concurrent jj commands without corrupting the repo, even if… on different machines… via a distributed file system."
  - "The operation cannot fail to commit… It is left for the next command to notice if there were divergent operations."
  - Divergent bookmarks show as `??`.
- **Working-copy snapshots:** every command first snapshots the working copy as an operation. So jj, too, records "between commits," but only at command granularity and only locally. Klabnik on HN: "entirely local on your machine, and not shared." [secondary]
- **Change ID:** "A change is a commit as it evolves over time… The change ID is a property of a commit… [it] generally remains the same" across rewrites such as rebase or description edits.
- **First-class conflicts:** "Jujutsu can record conflicted states in commits… the rebase operation will succeed." Descendants auto-rebase. The conflict is stored logically, not as markers.
- **Delta and jj interop** [read]: Delta supports colocated jj repos and preserves each managed checkout's op log across archive and restore.

**Comparison** [inference]
- jj's op log is the right model for *forge-level* state: every mutation of refs, threads and landings is an operation over a view, and concurrent operations are merged, not locked.
- DeltaDB's delta log is the right model for *content-level* state inside a thread.
- jj change IDs are a coarse-grained "anchor" for a change across rebases. DeltaDB anchors are fine-grained, for a span across edits.

---

## Pain points for agentic-scale development (from these sources)

1. **Git worktrees break down with many agents** [read, Irwin, 6 Oct 2026]:
   - "Git does not know when you are finished with them."
   - "You can only check out a branch in one worktree at a time."
   - "Every tool that associates state with a directory gets another copy."
   - "Add a handful of agents, and suddenly keeping track of worktrees is its own job."
2. **Reviewers' agents must reconstruct intent** [read]: "A reviewer may feed your diff into another agent… but that agent has to piece together decisions you already worked through." Also: "the diffs we're asking each other to review have mushroomed."
3. **Comments rot on snapshots** [read]: "On a commit-based platform, comments attach to snapshots and fall out of date as soon as the code changes." HN user abahgat adds that commit hashes change on every rebase, so attaching review comments to versions is hard.
4. **Shared machine resources** [read]: "Separate checkouts do not create separate computers." Ports, databases and containers collide, and setup has to be scripted and fast.
5. **Agent safety** [read]: prompt injection through AGENTS.md in contributed PRs. Delta itself has no sandbox yet.
6. **Noise and fishbowl** [secondary/read]: full transcripts are long, people do not want their process watched, and secrets leak into history. Delta added redaction for that reason.
7. **CRDT merge is not semantic** [read, Upwelling]: syntactic auto-merges can produce garbage ("frostysoft"). Semantic conflicts need review or tests.
8. **Access control mismatch** [read]: thread sharing leaks repo-wide history access. Fine-grained ACLs and multi-repo stories are missing (HN).

## How orgs are solving them (in these sources)

- **Zed/Delta:**
  - per-thread replicated worktrees, not git worktrees, each with its own cheap clone;
  - `.agents/prepare` and `.agents/linked` for setup;
  - review subthreads with forked worktrees and snapshot-pinned verdicts;
  - a Land subthread running a project-defined skill;
  - local secret redaction;
  - Cloudflare DO, R2, D1 and KV as the backend;
  - git as the bootstrap and export format.
- **Zed editor:** OS-level sandboxing by default, with no `.git` writes even on escalation.
- **Ink & Switch:**
  - always-on change tracking with formality on demand;
  - floating drafts plus a single server-approved merge point;
  - intent signalled through named drafts and proposed section reservations;
  - AI bots as attributed collaborators on branches.
- **Pijul and jj:** conflicts as first-class recorded state; stable identities (vertex ids, change ids); op logs for lock-free concurrent mutation and undo.
- **Zed `cargo-deltabuild`** [read; fork of tekian/cargo-delta, MIT]: "detects which crates in a Cargo workspace are impacted by changes in a Git feature branch."
  - It has Modified, Affected and Required categories and "trip wire" patterns.
  - It is a test-impact tool, consistent with the brief's "run only the tests a change can affect."
  - Whether Zed's CI uses it is unverified.

## Implications for a future forge

### Ideas from Delta a forge should adopt

1. **Anchors that survive edits, stored server-side** [inference, grounded in read mechanics]:
   - Give every comment, evidence item, blame link and "why" query an anchor of the form *(origin op or change id, offset or span)* rather than (commit, path, line).
   - With a git-only backend, approximate this by carrying anchors forward through checkpoint diffs, which is the brief's plan.
   - With a delta log, anchors are exact, and Pijul and Zed show how.
   - Required UI state: "span deleted at op X," with a link to the last state where it existed.
2. **Between-commit history, but at agent-turn granularity, not keystroke granularity** [inference]:
   - For agent work, the natural "delta" is the tool call (edit or patch), already discrete.
   - Store a checkpoint per agent edit linked to the message that caused it. This is what the brief proposes.
   - Delta's state naming, "base commit + set of delta IDs," is a clean way to address any intermediate state, for evidence pinning and for "revert thread to here."
3. **Review as a forked child thread with snapshot-pinned verdicts** [read mechanics → adopt]:
   - The reviewer or review agent gets an isolated fork of the worktree plus the parent's context.
   - The verdict binds to an exact snapshot.
   - "Pull changes" applies that snapshot.
   - A forge should go further and make verdicts and evidence *inputs to landing policy*, which Delta does not.
4. **Thread family scoping** [inference]: Delta merges only within a lineage. A forge can use lineage as the unit of permission and merge, so subthreads, reviews and forks inherit the parent's ACL. Sharing should *not* grant repo-wide history access, which is Delta's current leak.
5. **Land as a distinct, recorded sub-thread with a result card** (branch, commit, CI) [read → adopt and upgrade]. The forge should own the loop, as a landing service with a trunk lock or queue, rather than an agent skill. The *record* shape is good.
6. **Git at the edge** [read]: every thread is also a git branch, mirrored to GitHub during transition, so "teammates who never open Delta see a normal repo." This is essential for adoption.
7. **The `.agents/prepare` convention** [read]: a committed, fast, idempotent setup script run on every fresh checkout. A forge sandbox should run it too.

### Ideas from Upwelling, Pijul and jj that Delta lacks and a forge needs

8. **Upwelling's "floating drafts" and "reviewed == merged" invariant** [read → adopt]:
   - The landing service keeps every ready thread rebased on current trunk, which is cheap with commuting or rebasing.
   - It lands one at a time through a server-approved merge point, so what was proven is what lands.
   - Speculative batching generalizes this.
9. **jj-style operation log for forge state** [read → adopt]: every thread-state transition, landing and ref move is an op over a view, with parents. That gives undo or revert of forge actions, audit, and lock-free concurrent mutations that are detected and merged later. It also fits the Durable Object per repo model.
10. **First-class conflict objects** [read → adopt]: like jj and Pijul, record "thread T conflicts with landed thread U" as a stored state attached to T, with both threads' intent. That is the brief's conflict hand-back.
11. **Intent declaration and reservations** [read, Upwelling future work → adopt]: threads declare files or symbols, and the forge warns on proximity. This is the brief's idea 6.

### What is editor-specific and a forge should not copy

- **Live character-level co-editing of one worktree** across machines (CRDT text merge, Lamport ordering of concurrent same-spot inserts, per-user undo maps). This is valuable inside an editor. For a forge, agents in separate sandboxes integrate at landing, where you want *recorded conflicts*, not silent interleaving ("frostysoft").
- **Conversation-as-document UI:** cursor motions in transcripts, comment mode in diffs, "seen" checkboxes. It is good UX but belongs to clients. A forge needs the *data model* for span comments on transcripts and diffs, not the editor.
- **Per-keystroke capture of human edits:** this is the fishbowl and surveillance concern, and agents' tool calls are already discrete. Make human-edit capture opt-in or squash it to checkpoints.
- **Agent runs on the prompter's machine:** this is a local-first editor choice. A forge should run agents in its own sandboxes, as the brief already proposes.

### Specific design notes for the Cloudflare entry [inference]

- Delta proves a split works in production: a Durable Object with SQLite holds the per-thread op log, and R2 holds packs and checkpoints. Say so in the video, citing Delta's data-storage doc, to defuse "does this scale" questions.
- Differentiate on what Delta explicitly lacks. All of these are documented gaps:
  - a forge-owned landing service ("the button does not prescribe a Git workflow");
  - proof-gated policy (no merge gating);
  - sandboxed per-thread compute ("Delta does not sandbox agents");
  - per-thread ACL (sharing grants repo-wide history).

---

## Contradictions and pushback

- **The 570 number is not comparable to Amp's commit stats.** The window is about one week and "changes" is undefined. The brief's phrasing "33 people landed 570 changes afterwards" is accurate but should add "in about a week, on Delta's own repo."
- **The brief says "Zed turned off PRs internally" in the thesis line "Both… dropped pull requests internally."** Only the Delta repo has PRs off. The flagship `zed-industries/zed` repo still uses GitHub PRs, and Zed asks contributors to *attach* Delta threads to PRs. [read]
- **Roadmap versus shipped:** the brief lists CLI and @mentions as in progress. Both have shipped per the release notes, though the roadmap page still says "In Progress." [read]
- **"Verification inside the thread is a long-term idea"** comes from the blog, not the roadmap. [read]
- **DeltaDB was meant to come to Zed** (2025 post: "integrating it into Zed"). In Aug 2026 it moved to a new app. "We could have added DeltaDB to Zed, and eventually we will." [read] This strategic pivot is part of HN's "identity crisis" criticism.
- **Open-source promise unmet so far:** the Sequoia post says DeltaDB will be open-sourced. Delta and DeltaDB appear closed. [read; inference from repo search]
- **Conversation as source of truth is disputed.** HN skeptics and Zed's own "On Programming with Agents" post (Jan 2026) recommend writing a PLAN.md. Delta later argued "Your plan.md is missing the conversation" (1 Oct 2026). [read] Ink & Switch found AI *summaries* of history "remarkably useful." [inference] Raw transcripts plus summaries may be the compromise.
- **The "CRDT merge solves collaboration" framing is contradicted by Upwelling's findings** that syntactic auto-merge produces nonsense and semantic conflicts need human or test review. Delta itself says "Merge conflicts remain merge conflicts." That refers to git-level ones.

## Open questions

1. What exactly is a "change" in "570 changes"? Commits on main, Land runs, or threads?
2. What is DeltaDB's wire protocol and its server authority model? Is the Durable Object per thread the sequencer? How are replica ids assigned (the 2022 post says "centrally")? Is there any server-side validation of deltas?
3. How does DeltaDB handle binary files, very large repos and monorepos? Nothing is documented. HN asked about multi-repo.
4. Will "Git storage in DeltaDB" replace git packs, with R2 "history packs" already mentioned, or wrap them? What does a non-Delta git client see then?
5. Will "content-based builds" become a CI or proof system inside threads? There is no detail beyond one sentence.
6. Remote runtime: where will agents run (Firecracker-class microVMs are mentioned in the Xanadu post), and will it be sandboxed?
7. How will repository-based access map GitHub permissions onto thread-family sharing, and will per-thread ACLs replace the repo-wide history grant?
8. Is `cargo-deltabuild` used in Zed's CI?
9. Is the open-source DeltaDB release still planned, and under what license?
10. GitLab "Project Switch": what is it? This lead came from TNS and is for another researcher.

## Sources (opened)

**Zed blog** (zed.dev)
- Blog index, accessed 2026-10-12: https://zed.dev/blog
- Software Is Made Between Commits, N. Sobo, 2026-06-11: https://zed.dev/blog/introducing-deltadb
- Introducing Delta, N. Sobo, 2026-08-12: https://zed.dev/blog/introducing-delta
- Xanadu Was Waiting for Agents, N. Sobo, 2026-09-01: https://zed.dev/blog/agentic-xanadu
- Replace PRs with Delta – Now in Public Beta, N. Sobo, 2026-09-16: https://zed.dev/blog/delta-public-beta
- Sequoia Backs Zed's Vision for Collaborative Coding, N. Sobo, 2025-08-20: https://zed.dev/blog/sequoia-backs-zed
- How CRDTs make multiplayer text editing part of Zed's DNA, N. Sobo, 2022-12-01: https://zed.dev/blog/crdts
- Bring Your Own Agent to Zed — Featuring Gemini CLI (ACP launch), 2025-08-27: https://zed.dev/blog/bring-your-own-agent-to-zed
- The ACP Registry is Live, 2026-01-28: https://zed.dev/blog/acp-registry
- Introducing Parallel Agents in Zed, 2026-04-22: https://zed.dev/blog/parallel-agents
- Sandboxing, 2026-08-05: https://zed.dev/blog/sandboxing
- On Programming with Agents, 2026-01-23: https://zed.dev/blog/on-programming-with-agents

**Delta site and docs** (delta.dev)
- Delta home: https://delta.dev
- Delta Roadmap, accessed 2026-10-12: https://delta.dev/roadmap
- Delta Pricing: https://delta.dev/pricing
- Delta Blog index: https://delta.dev/blog
- Escaping the tyranny of worktrees, C. Irwin, 2026-10-06: https://delta.dev/blog/escaping-the-tyranny-of-worktrees
- The Diff: September 2026, J. Lyons, 2026-10-07: https://delta.dev/blog/the-diff-2026-09
- Your plan.md is missing the conversation, N. Sobo, 2026-10-01: https://delta.dev/blog/planning-together-in-delta
- Please Stop Sending Me Google Docs, F. Dethlefsen, 2026-10-08: https://delta.dev/blog/please-stop-sending-me-google-docs
- Beyond Pass Rate: Harness Evals, A. Goel, 2026-09-24: https://delta.dev/blog/beyond-pass-rate
- Docs: Welcome: https://delta.dev/docs
- Docs: Core Concepts: https://delta.dev/docs/concepts/core-concepts
- Docs: Delta & Git: https://delta.dev/docs/concepts/delta-and-git
- Docs: Delta Worktrees: https://delta.dev/docs/concepts/worktrees
- Docs: Threads: https://delta.dev/docs/agents/threads
- Docs: Subagents: https://delta.dev/docs/agents/subagents
- Docs: Review & Sync Changes: https://delta.dev/docs/agents/review-and-sync
- Docs: Comments: https://delta.dev/docs/agents/comments
- Docs: Collaborate in a Thread: https://delta.dev/docs/collaboration/collaborate-thread
- Docs: Delta on the Web: https://delta.dev/docs/collaboration/delta-on-the-web
- Docs: Prepare your project: https://delta.dev/docs/configuration/project-setup
- Docs: Data Storage & Deletion: https://delta.dev/docs/privacy-and-security/data-storage
- Docs: Security: https://delta.dev/docs/privacy-and-security/security
- Docs: Agentic Safety: https://delta.dev/docs/privacy-and-security/agentic-safety
- Docs: Release notes (0.1.1, 2026-08-24, to 0.19.2, 2026-10-09): https://delta.dev/docs/whats-in-the-latest

**ACP**
- Agent Client Protocol, Introduction: https://agentclientprotocol.com
- ACP Protocol Overview (v1): https://agentclientprotocol.com/protocol/overview

**Coverage and community**
- The New Stack, "'Everyone's in a race to replace GitHub': Zed launches Delta…", P. Sawers, 2026-09-16: https://thenewstack.io/zed-delta-github-alternative/
- InfoQ, "Real-Time, Fine-Grained Version Control with CRDTs" (Sobo, QCon NY 2018; abstract only): https://www.infoq.com/presentations/github-crdt
- HN "Sequoia backs Zed" (44961172), 2025-08-20: https://news.ycombinator.com/item?id=44961172
- HN "Software is made between commits" (48492533), 2026-06-11: https://news.ycombinator.com/item?id=48492533
- HN "Zed DeltaDB" (49187256), 2026-08-05: https://news.ycombinator.com/item?id=49187256
- HN "Delta" (49276574), 2026-08-12: https://news.ycombinator.com/item?id=49276574
- HN "Xanadu was waiting for agents" (49526298), 2026-09-01: https://news.ycombinator.com/item?id=49526298
- HN "Replacing Pull Requests with Delta" (49727245), 2026-09-16: https://news.ycombinator.com/item?id=49727245
- The HN threads were read through the Algolia API: https://hn.algolia.com/api/v1/items/<id>
- GitHub org search "delta" in zed-industries: https://github.com/orgs/zed-industries/repositories?q=delta
- zed-industries/cargo-deltabuild README: https://github.com/zed-industries/cargo-deltabuild

**Ink & Switch**
- Ink & Switch home: https://www.inkandswitch.com/
- Universal Version Control (research area): https://www.inkandswitch.com/universal-version-control/
- Patchwork Notebook index: https://www.inkandswitch.com/patchwork/notebook/
- Patchwork: Version control for everything (2024 notebook, entries 01–11, Feb to Jul 2024): https://www.inkandswitch.com/patchwork/notebook/2024-version-control/
- Upwelling (McKelvey, Jenson, Wagner, Cook, Kleppmann, March 2023): https://www.inkandswitch.com/upwelling/

**Pijul and jj**
- Pijul manual, Why Pijul: https://pijul.org/manual/why_pijul.html
- Pijul manual, Theory: https://pijul.org/manual/theory.html
- Pijul manual, Conflicts: https://pijul.org/manual/conflicts.html
- jj docs, Operation log: https://jj-vcs.github.io/jj/latest/operation-log/
- jj docs, Concurrency (technical): https://jj-vcs.github.io/jj/latest/technical/concurrency/
- jj docs, Conflicts: https://jj-vcs.github.io/jj/latest/conflicts/
- jj docs, Working copy: https://jj-vcs.github.io/jj/latest/working-copy/
- jj docs, Glossary: https://jj-vcs.github.io/jj/latest/glossary/

**Search-only, not relied on:** runtimewire.com, zeli.app and techtimes.com coverage, from search snippets.
**Blocked:** lobste.rs (Anubis block page) and the Wayback Machine (no snapshot, and CDX blocked).

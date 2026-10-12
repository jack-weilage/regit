# 18. Thread provenance and sharing: capturing, sharing and querying the conversation behind code

Research date: 2026-10-12. Key: `18-thread-provenance-sharing`.
Tags: **[read]** = verified on a page I opened; **[secondary]** = coverage or search snippet only; **[inference]** = my reasoning; **[measured]** = I measured it in this environment.

Note on method: the shared web-search budget for this run ran out partway through (after 7 searches). After that I fetched only URLs I already knew or that linked from pages I had opened. I opened about 45 pages in all. Some threads I meant to follow (Ghostty's denouncement list, empirical studies of whether reviewers read transcripts, Kiro/Tessl changelogs) are listed under Open questions.

---

## Summary

- **Every major agent vendor now has a thread URL, and most link it into git through a commit trailer.** Amp writes `Amp-Thread-ID`, Entire writes `Entire-Checkpoint: <ULID>`, and Claude Code cloud sessions add a claude.ai session link (`attribution.sessionUrl`). Cognition: "Every one of us in the coding agents industry has independently developed a url identifier for the 'chat'." [read]
- **Two attribution specs exist, and they agree on line ranges keyed to a revision plus a pointer to a conversation.**
  - Agent Trace (Cursor-led, v0.1.0 RFC, January 2026, CC BY 4.0) is backed by Amp, Cloudflare, Cognition, git-ai, Jules, OpenCode, Vercel and others. It deliberately leaves storage undefined. [read]
  - The Git AI Standard v3.0.0 (`authorship/3.0.0`) stores line attestations in `refs/notes/ai`. [read]
  - Thoughtworks rates both "Assess" (April 2026). [read]
- **Trailers versus notes is a real design fork.**
  - Entire's FAQ explains why it chose trailers over git notes: notes aren't pushed by default, they're keyed to SHAs that change on rebase, amend and cherry-pick, and hosted forges don't support them well. [read]
  - git-ai takes the other path. It uses notes and runs its own rewrite logic for rebase, squash, cherry-pick and reset. [read]
  - Git's own `notes.rewriteRef` has no default and covers only amend and rebase. [read]
- **Line-level attribution is fragile, and the most mature tools say so.**
  - Entire says `entire blame` and `entire why` are commit-level: "a line hand-edited inside an AI commit still reads as AI", and a rebase or squash reattributes lines. [read]
  - This corrects the brief's description of Entire as recording "the session and prompt behind each line". In practice it records them behind each commit (checkpoint).
- **"Code can answer why" ships today, in three forms.**
  - Amp: `find_thread` searches by keyword or by "which thread touched this file", and `read_thread` extracts context from the thread it finds. [read]
  - git-ai: `/ask` sends a subagent to answer "as the original author" from the stored session. [read]
  - Entire: `entire why FILE:LINE` returns the commit, checkpoint, prompt and session. Entire Brain builds project memory from sessions. [read]
  - Zed: DeltaDB anchors references to deltas, so "agents can… convene the prior agents… and ask why." [read; verifies brief]
- **Transcripts are too big to hand to a reader whole.**
  - Amp's longest thread was compacted more than 68 times and would be over 21 million tokens uncompacted. Amp rewrote `read_thread` as a search subagent because one-shot extraction "over-weights whatever the thread ended with or started with". [read]
  - git-ai: "Today's agent sessions can easily be tens of megabytes." [read]
  - In this research run, subagent transcripts average 0.42 MB and reach 0.95 MB. Human prompt text is 0.4% of the bytes; tool results are 46%. [measured]
- **The industry's answer to "will anyone read it?" is no.**
  - Retrieval narrows to the specific message: git-ai's message-level attribution (v1.4.0, May 2026) maps each line to `session::message` "not a 90-message transcript to summarize". [read]
  - Cursor Blame shows "conversation summaries… rather than full conversation history". [read]
  - Entire indexes only "user prompts and assistant prose", skipping tool-only turns and code. [read]
  - I found no primary study measuring whether human reviewers read transcripts. That is a gap.
- **Secret leakage killed public threads.**
  - On June 2, 2026, Amp removed public, discoverable thread sharing: "It's getting too hard to review a thread to ensure it doesn't contain any snippets of sensitive files… as they get better they read more files into context." [read]
  - Cursor's shared transcripts use "best-effort redaction… not guaranteed". [read]
  - Claude Code warns that shared sessions "may contain code and credentials from private GitHub repositories". [read]
- **Entire publishes the most detailed redaction pipeline: nine layers.** Entropy above 4.5 on runs of 10+ characters, Betterleaks, provider prefixes, credentialed URIs, DB connection strings, user rules, credential assignments, PII, and the optional OpenAI Privacy Filter. It still says "Treat redaction as a safety net rather than a guarantee." [read]
  - Known holes: inline base64 images and externalised image assets are not redacted, shadow branches hold raw unredacted working-tree snapshots, and OPF does not run on the default ref backend. [read]
- **Access to a thread should follow access to the code.** Claude Code Team/Enterprise sharing checks repository access by default. Entire's mirror permissions follow GitHub collaborator permissions. Amp has Private, Workspace, Group (Enterprise) and Unlisted, and admins can see private threads in a workspace. [read]
- **Cloudflare's own Artifacts docs recommend git notes for "prompts, model output, run IDs".** This verifies the brief's flagged claim. However, the Workers binding has no notes method (create, get, fork, log, readCommit, readTree, readBlob, readFile, tokens), so notes must be written over the git protocol. The 1 GB per-repo and 32 MB per-blob limits rule out storing full transcripts in the repo. [read, plus inference]
- **Spec-driven development is a complement to threads, not a replacement.**
  - GitHub Spec Kit (130K+ stars, 38 integrations) now runs Specify → Plan → Tasks → Implement → Converge. [read]
  - Tessl has moved away from "spec-as-source" toward a skills/context registry. [read]
  - Böckeler (Thoughtworks) found the markdown "very verbose and tedious to review… I'd rather review code" and saw agents ignore specs. [read]
- **Open source asks for disclosure, not transcripts.** Ghostty requires naming the tool and the extent of AI use. The Linux kernel wants an `Assisted-by: LLM [tools]` trailer and forbids AI `Signed-off-by`. Neither requires a transcript. SpecStory recommends linking chat history, and Mitchell Hashimoto published all 16 sessions ($15.98) for one Ghostty feature. [read]

---

## Detailed findings

### A. Thread sharing surfaces (who lets you share what)

**Amp (ampcode.com)**
- Visibility has four levels: Private (in a workspace, admins can also see), Workspace, Group (Enterprise only), and Unlisted ("Anyone with the link"). In a workspace, threads in workspace-owned projects are shared with the workspace by default. Admins can turn off sharing outside the workspace. [read] https://ampcode.com/docs/collaborate/thread-sharing
- Export: append `.md` to a thread URL for Markdown. The creator can export full JSON. In the CLI: `amp threads markdown` and `amp threads export`. [read] same page.
- Commits the agent makes "include an `Amp-Thread-ID` trailer, so `git log` shows which conversation produced a change." [read] same page and https://ampcode.com/docs/threads
- A thread holds "your prompts, the agent's replies, every tool call it made, and the files it changed." The More Actions menu shows thread cost. [read] https://ampcode.com/docs/threads
- **The End of Public Threads (June 2, 2026).** Amp "removed public, internet-wide, discoverable thread sharing… It's getting too hard to review a thread to ensure it doesn't contain any snippets of sensitive files. Each model release means the agents get better, and as they get better they read more files into context… This decision is proactive and isn't prompted by any incident." Existing public threads became Unlisted so links in blog posts don't break. [read] https://ampcode.com/news/end-of-public-threads
- Context: in November 2025 Amp had launched public profiles and threads ("Social Coding") to show "how other people are actually using agents". [read] https://ampcode.com/news/social-coding
- Secret redaction (May 30, 2025): Amp replaces detected secrets with markers like `[REDACTED:aws-access-key-id]` so they are "not exposed to the LLM, other tools, or ampcode.com." [read] https://ampcode.com/news/secret-redaction
- SOC 2 post (August 13, 2026): "Commits link to the Amp threads that produced them, so the record isn't just a diff, it's everything that led up to it… it gives an auditor the same thing a PR workflow gives them. And no, code review isn't on the list." [read] https://ampcode.com/notes/thats-not-soc-2-compliant (verifies the brief.)

**Claude Code (code.claude.com docs)**
- Cloud session sharing: you toggle visibility, then send the link. "Recipients see the latest state when they open the link, but their view doesn't update in real time." [read] https://code.claude.com/docs/en/claude-code-on-the-web
  - Team/Enterprise: Private or Team visibility. Repository-access verification is on by default, based on the recipient's connected GitHub account. The sharer's display name is shown. Slack sessions are auto-shared at Team visibility.
  - Pro/Max: Private or Public ("visible to any user logged into claude.ai"). Repository verification is off by default. The docs warn: "Sessions may contain code and credentials from private GitHub repositories."
- Teleport: `claude --teleport [id]` pulls a cloud session and its branch into the terminal. It requires a clean git state, the same repository (not a fork), and the branch pushed to the remote. It is one-way: "new work there stays local and doesn't appear in the cloud session." [read] same page.
- Local transcripts are JSONL at `~/.claude/projects/<project>/<session-id>.jsonl` with 30-day retention by default (`cleanupPeriodDays`). "The entry format is internal to Claude Code and changes between versions." `/export` produces a readable rendered transcript. `claude --from-pr <number>` opens sessions linked to a PR. `/branch` and `--fork-session` fork a conversation. [read] https://code.claude.com/docs/en/sessions
- Attribution settings: `attribution.commit` (a trailer, by default `Co-Authored-By`), `attribution.pr`, and `attribution.sessionUrl` ("Omit the claude.ai session link from cloud and Remote Control commits"). [read] https://code.claude.com/docs/en/settings-reference.md
- In this environment the harness tells me to end commits with a `Claude-Session: https://claude.ai/code/session_…` trailer, a concrete example of the session-link trailer. [read, from my own system context]

**Cursor**
- Shared transcripts: Share icon, then Team (signed-in team members) or Public (`cursor.com/s/…`). "The full conversation history is shared, including code snippets, tool calls, and their results." Recipients can **Fork to Cursor**.
  - Redaction is "best-effort… not guaranteed and can miss secrets, especially custom values or values without recognizable prefixes."
  - Teams and Enterprise plans only, and Enterprise is Team-links-only by default. Not available in "No Storage" privacy mode. Limit of 50 shares per day. [read] https://cursor.com/help/ai-features/shared-transcripts.md
- Cursor Blame (Enterprise, off by default): it tags lines Tab, Agent (with model) or Human. "Hover over AI-attributed lines to see conversation summaries." Data is "fetched from Cursor's servers. Conversation summaries are retrieved on-demand and show brief descriptions rather than full conversation history." [read] https://cursor.com/docs/integrations/cursor-blame.md
- Cursor Origin (its git host, early beta) docs list repos, PRs, mirroring, automations and cloud agents, but no thread or trace features. [read] https://cursor.com/docs/origin/agents.md

**Entire (former GitHub CEO Thomas Dohmke)**
- The docs overview describes two products:
  - Hosting: "Host code on Entire's Git network in the region closer to you, where agents clone and push up to 89 times faster than on other Git providers," plus GitHub mirrors and "Entire-native branches" that keep accepting pushes during GitHub outages.
  - Checkpoints: "Every commit an agent makes becomes a checkpoint: the code change paired with the prompt, reasoning, and tool calls behind it. Secrets are redacted before anything leaves your machine." The pitch: "A new system of record for agentic coding."
  - [read] https://docs.entire.io/cli/overview.md (verifies the brief's "regional mirrors" claim.)
- Funding, founder and launch-date figures (February 10, 2026; $60M seed at a $300M valuation) come from search snippets only. [secondary]
- Thoughtworks Radar (April 15, 2026, Assess): Entire CLI "hooks into Git workflows to capture AI coding agent sessions — including transcripts, prompts, tool calls, files touched and token usage." [read] https://www.thoughtworks.com/radar/tools/entire-cli
- "Sharing Sessions is the New Social Coding" (October 6, 2026): a teammate shares a live entire.io link. The post says "Most of the time, my teammates don't need to go through the whole session line by line… they can focus on the prompts that matter," using `entire checkpoint explain`. It also admits that some prompts should not be shared ("especially the prompts where I'm yelling at my agent"). [read] https://entire.io/blog/sharing-sessions-is-the-new-social-coding

**SpecStory**
- Saves agent sessions as local Markdown files "alongside your code", with optional SpecStory Cloud to search and share. Supports Cursor, Copilot, Claude Code, Codex, Antigravity, Gemini, Pi, Qwen, Droid and others. [read] https://specstory.com/markdown/specstory.md
- The company is now also building **RunStory**, which "runs your software, sends reproducible failures to your coding agent, and verifies the fix." That is a move from capture toward verification. [read] https://docs.specstory.com/llms.txt
- Advice to open-source contributors: "Export your conversation from Cursor or Claude Code and link it in your PR." [read] https://specstory.com/blog/how-to-be-an-opensource-hero

**Ad-hoc publishing**
- Simon Willison's `claude-code-transcripts` (December 25, 2025) turns Claude Code JSONL into paginated HTML and publishes it to a Gist. He reverse-engineered the private Claude Code for web sessions API to do it. His commit log links each commit to its transcript. Why: "the actual work that I do is now increasingly represented by these Claude conversations… In the pre-LLM era I relied on issues and issue comments to record all of this extra project context." [read] https://simonwillison.net/2025/Dec/25/claude-code-transcripts/
- Mitchell Hashimoto shared "every single agentic coding session… unedited and in full" for one Ghostty feature: "16 separate sessions totalling $15.98 in token spend on Amp." He also notes "there is a lot of human coding, too… you may see some discrepancies between what the AI produced and what ended up in the final code." [read] https://mitchellh.com/writing/non-trivial-vibing

### B. Linking code to threads: trailer, note, or ref

| Tool | Link in the commit | Where the thread body lives | Survives rebase/squash? |
|---|---|---|---|
| Amp | `Amp-Thread-ID` trailer [read] | ampcode.com server | The trailer travels with the commit message; a squash that keeps messages keeps it [inference] |
| Claude Code (cloud) | Session URL in the commit (`attribution.sessionUrl`) [read] | claude.ai | Same as Amp [inference] |
| Entire | `Entire-Checkpoint: <12-hex or 26-char ULID>` trailer [read] | In your repo: `refs/entire/checkpoints/<shard>/<id>`, one ref per checkpoint (default since CLI 0.10.0), or the legacy `entire/checkpoints/v1` branch [read] | Trailers "survive common Git workflows better than metadata attached only to a commit SHA" [read] |
| git-ai | Git note in `refs/notes/ai` (one per commit) [read] | Since v1.0, sessions are stored outside git ("keeping repos lean"), optionally in a team or self-hosted prompt store. `prompt_storage notes` can put prompts in notes [read] | git-ai rewrites notes after rebase, cherry-pick, squash and reset [read] |
| Agent Trace | Not specified: "could be local files, git notes, a database, or anything else" [read] | `conversation.url` points to the vendor [read] | "We expect to see different implementations" [read] |
| Linux kernel | `Assisted-by: LLM [tools]` trailer [read] | Not stored | n/a |

- **Entire's argument against notes** (FAQ): "Normal Git pushes skip them unless you configure note refs separately; they attach to commit SHAs, which change during rebases, amends, and cherry-picks; hosted Git platforms do not consistently support them in review and merge workflows." [read] https://docs.entire.io/faq.md
- **Entire's storage evolution.** It moved from one shared branch to one ref per checkpoint because "Multiple agents can also save their work at the same time without competing to update a shared branch." [read] https://docs.entire.io/guides/checkpoints/checkpoint-storage.md
  - This is the single-ref contention problem the brief cites from GitHub, appearing again in provenance storage. [inference]
- **A trailer leaks a little.** "A ULID encodes the millisecond Entire created the checkpoint, so the trailer discloses commit timing to anyone who can read the commit message." [read] https://docs.entire.io/security.md
- **Git's native note rewriting is limited.** `notes.rewrite.<command>` covers only `amend` and `rebase`. `notes.rewriteRef` "Does not have a default value; you must configure this variable to enable note rewriting." [read] https://git-scm.com/docs/git-notes
- **Cloudflare Artifacts.** The best-practices page says: "Use git notes to attach prompts, model output, run IDs, or other harness metadata to a commit without changing the commit object… Push and fetch `refs/notes/*` with the rest of your repo data." [read] https://developers.cloudflare.com/artifacts/concepts/best-practices/
  - The Workers binding lists `create/get/list/import/delete`, `info`, token methods, `fork`, `log`, `readCommit`, `readTree`, `readBlob` and `readFile`. There is no notes method. [read] https://developers.cloudflare.com/artifacts/api/workers-binding/
  - This answers the brief's open question: write notes through a git client (for example, in the sandbox). `log({ref})` might read a notes ref, but I have not tested it. [inference]
  - Limits: 1 GB per repository, 32 MB per blob, 2,000 git requests per 10 s per repo. [read] https://developers.cloudflare.com/artifacts/platform/limits/

### C. Attribution standards and policies

**Agent Trace v0.1.0** ([read] https://agent-trace.dev/)
- Status "RFC", dated January 2026. "A data specification, not a product… The spec is unopinionated about where traces live."
- Trace Record fields: `version`, `id` (UUID), `timestamp`, `vcs` {type: git|jj|hg|svn, revision}, `tool`, and `files[]`. Each file has `conversations[]`, each with a `url`, a `contributor` {type: human|ai|mixed|unknown, `model_id` in models.dev `provider/model` form}, `ranges[]` {start_line, end_line, optional `content_hash` such as `murmur3:9f2e8a1b` "for position-independent tracking"}, and `related[]` links (session, prompt).
- Line numbers refer to "positions at the recorded revision". To query a line: blame → revision → trace → range.
- For jj, the revision is the change ID, which is "stable across amend/rebase operations".
- Non-goals: legal ownership, training provenance, and quality assessment.
- MIME type `application/vnd.agent-trace.record+json`.
- Partners: Amp, Amplitude, Cline, Cloudflare, Cognition, git-ai, Jules, OpenCode, Tapes, Vercel.

Cognition's endorsement ([read] https://cognition.com/blog/agent-trace, January 29, 2026):
- "Git was made in 2005 when… commits were expensive/bandwidth constrained… we have shifted from bandwidth constrained to context constrained."
- On linking by URL rather than embedding content: "it helps keep PII and other sensitive information out of the agent trace store."
- It also claims that including prior reasoning improves SWE-Bench "by as much as 3 points" and cache hit rates by 40–80%. These are cited as "reportedly", with no source given. [read; claim itself secondary]

Thoughtworks Radar on Agent Trace (April 15, 2026): "Assess", with "early signals of adoption… Cline and OpenCode as well as implementations like Git AI." [read] https://www.thoughtworks.com/radar/platforms/agent-trace

**Git AI Standard v3.0.0** ([read] https://raw.githubusercontent.com/git-ai-project/git-ai/main/specs/git_ai_standard_v3.0.0.md)
- Notes ref: "MUST be stored under `refs/notes/ai`", "MUST NOT use… `refs/notes/commits`", and at most one log per commit.
- The log has an attestation section, then `---`, then JSON metadata. The divider "allows a buffer to quickly read just the Attestation Section… for very fast `git-ai blame`."
- Attestation keys:
  - `s_<14hex>::t_<14hex>`: session ID = SHA256("tool:conversation_id")[0..14]; trace ID is random per checkpoint.
  - `h_<14hex>`: known human, observed typing in an IDE.
  - Legacy 16-hex keys.
- Lines with no key are "untracked", meaning provenance unknown. This is distinct from "human".
- Session records "MUST NOT contain `messages`, `messages_url`". The `messages` array was removed in v1.3.4. The note carries pointers and stats, not transcripts.

**How git-ai captures attribution** ([read] https://usegitai.com/blog/introducing-git-ai, November 8, 2025)
- Agents call `git-ai checkpoint` from PreEdit and PostEdit hooks. PreEdit marks changes since the last checkpoint as human; PostEdit marks the agent's changes as AI.
- "Avoid heuristics. Coding agents are responsible for explicitly marking code they contribute."
- Performance target: "<100ms for common commands, <1s for large rebases."
- Blame overlay: run `git blame --porcelain`, then look up notes for each commit, then map original line numbers to attestations.

**Message-level attribution** (v1.4.0, May 20, 2026)
- Keys moved to `session_123::msg_456`. Before, "if a single session produced 10,000 lines across dozens of files, every one of those lines pointed back to the entire transcript."
- They also aim for a "full trajectory": Intent → Agent edits → Human overrides → Commit → PR → Review → Production → incidents and churn. [read] https://usegitai.com/blog/message-level-attribution

**Git AI joins OpenAI**
- September 11, 2026: "Git AI is joining the Codex team at OpenAI… Today, Git AI runs on hundreds of thousands of developer machines at scale-ups and across the F500… We'll keep building standards in the open." [read] https://usegitai.com/blog/git-ai-is-joining-openai
- Coverage calls it an acqui-hire. [secondary] (The New Stack, AI Catchup)
- The README says the standard is supported by Claude Code, Codex, Cursor, Copilot, OpenCode, Pi, Windsurf, Droid, Amp, Gemini, Continue, Junie, Rovo Dev and Firebender. [read] https://github.com/git-ai-project/git-ai (raw README)

**Open-source policies**
- Ghostty AI_POLICY.md: "All AI usage in any form must be disclosed. You must state the tool you used… along with the extent." The human "must fully understand all code." "Bad AI drivers will be denounced" on a public list. Maintainers are exempt. No transcript is required. [read] https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md
- Linux kernel "AI Coding Assistants" (docs for 7.3.0-rc7): "AI agents MUST NOT add Signed-off-by tags. Only humans can legally certify the DCO." Use `Assisted-by: LLM [TOOL1] [TOOL2]`. For bug-fixing agents, "Indicate what could not be done. If the fix could not be built or tested, or if no reproducer could be produced, say so explicitly." No transcript is required. [read] https://docs.kernel.org/process/coding-assistants.html

### D. Querying: blame → thread → ask the agent

**Amp**
- `find_thread` (December 8, 2025): "Keyword search" and "File search: find threads that touched a specific file. Think of it like git blame, but for Amp." [read] https://ampcode.com/news/find-threads
- `read_thread` (October 29, 2025): "first fetches the thread as Markdown and then uses another model to extract the relevant context based on your instructions." [read] https://ampcode.com/news/read-threads
- **Read Bigger Threads (July 2, 2026).** "Our longest thread has been compacted over 68 times — without compaction, it would be over 21 million tokens long… even threads with 1 million tokens that fit gave bad answers: one giant prompt over-weights whatever the thread ended with or started with." `read_thread` is now a subagent; the model moved from Gemini 3.5 Flash to GLM 5.2. Its prompt includes:
  - "Do not stop at the first relevant hit; check for newer messages that revise, supersede, revert, or contradict it."
  - "Tool calls record attempted actions, not outcomes."
  - "Use compactions for orientation, but inspect original messages when exact requirements… matter."
  - [read] https://ampcode.com/news/read-bigger-threads
- Thread Map (December 11, 2025): a graph of threads linked by mentions, handoffs and forks. One feature was "spread across 13 threads". The common shapes are hub-and-spokes and chains. [read] https://ampcode.com/news/thread-map
- Handoff (October 23, 2025) replaced compaction with extracting a goal-specific prompt into a new thread. The result is many short, linked threads rather than one long one. [read] https://ampcode.com/news/handoff
  - The later 2026 post mentions compaction again, so Amp appears to have brought compaction back alongside handoff. [inference from read pages]
- `amp review` and `.agents/checks/*.md`: a review agent decoupled from any UI, with one agent per check. [read] https://ampcode.com/news/liberating-code-review

**git-ai `/ask`** (February 18, 2026)
- A subagent "finds the relevant lines of code, looks up the original session that produced them, and answers as the agent that actually wrote it."
- Their contrast case: asking Claude Code "why" without the session produced a confident, reconstructed answer they call "pure AI-slop". With the session, it quoted the human requirement "WE REALLY don't want to swallow the 2-3 seconds it might take to flush events."
- Example cost: "3 tool uses · 26.3k tokens · 34s".
- They recommend: "In plan mode, always use the /ask skill to read the code and the original transcript that generated it," and say "this is the only thing we've found that works."
- [read] https://usegitai.com/blog/ask-the-agent
- "6,314… prompts were used to generate the open source Git AI project." A VS Code extension shows the prompt for each line. [read] https://usegitai.com/blog/git-ai-blame

**Entire**
- `entire blame FILE[:LINE]` shows AI, MX (mixed), HU or ?? tags at commit level, with `--long` and `--json`. It is a labs command. [read] https://docs.entire.io/cli-reference/blame.md
- `entire why FILE:LINE` returns the commit, checkpoint, prompt and session. [read] https://docs.entire.io/cli-reference/why.md
- Search: "Semantic search indexes user prompts and assistant prose. It leaves out tool-only turns and the code inside a transcript, and folds checkpoint matches into their owning sessions." Indexing runs after push, so allow "a couple of minutes". [read] https://docs.entire.io/guides/search/what-is-indexed.md
- Brain: "a memory layer for your Git repository… saved agent sessions, checkpoints, project facts, documentation, and code structure." Fact extraction "can send session content to its model provider, and can incur token charges", and a background watcher keeps extracting. [read] https://docs.entire.io/guides/brain/overview.md
- `entire session resume BRANCH` finds the session from checkpoint-linked commits. [read] https://docs.entire.io/guides/sessions/resume-sessions.md
- Other commands include `investigate` (multi-agent investigation), `review` (multi-agent review with a "final verdict"), `experts` ("Rank agents, Skills, and tools by their contributions to a file"), `dispatch` (a markdown summary of recent agent work) and `mcp`. [read] https://docs.entire.io/llms.txt

**Zed DeltaDB**
- "Software Is Made Between Commits" (Nathan Sobo, June 11, 2026): "Because every reference is anchored to a delta instead of a line number, it survives as the code moves underneath it. From any line of code, you can find the conversation that produced it and every conversation that has touched it since. Agents… convene the prior agents that worked on it and ask why." [read] https://zed.dev/blog/introducing-deltadb (verifies the brief.)
- Hacker News and Lobsters reaction was reportedly skeptical about keystroke-level recording being invasive. [secondary, daily.dev]

**Sourcegraph Deep Search (the contrast)**
- An agentic loop over code search and navigation that answers questions with a "detailed list of sources". It reconstructs "why" from code, not from transcripts. [read] https://sourcegraph.com/docs/deep-search
- This is exactly the reconstruction git-ai argues is unreliable for intent. [inference]

### E. Size and shape of transcripts

- Amp's longest thread was compacted 68+ times and would be ~21M tokens uncompacted. Users report threads with "271 rounds". [read] (Read Bigger Threads)
- git-ai: sessions "can easily be tens of megabytes". [read]
- Measured in this research run's own Claude Code transcripts [measured]:
  - 34 JSONL files, 14.3 MB total, 0.42 MB average.
  - Largest: 0.95 MB in 192 lines. Of its bytes, 46.4% are tool results (fetched web pages and the like), 27.4% are attachments, 4.5% thinking, 2.5% tool-use calls, and **0.4% the human/user prompt**.
  - Conclusion [inference]: the intent-bearing part is tiny. Most bytes are tool output that can be regenerated or is sensitive. That argues for storing and indexing prompts and assistant prose separately from tool payloads, as Entire does.
- Volume per project: git-ai used 6,314 prompts for its own repo [read]. Mitchell used 16 sessions for one feature [read]. Entire's `checkpoint.json` layout is `prompt.txt`, `full.jsonl`, `transcript.jsonl`, `metadata.json` and `assets/` [read].
- Fit with Artifacts limits [inference]:
  - At tens of MB per session and thousands of sessions, transcripts in-repo would exceed the 1 GB per-repo limit quickly. A single 21M-token thread is roughly 80 MB of text at about 4 bytes per token, which is over the 32 MB blob limit.
  - So: keep pointers and small summaries in git (trailer or note), and put bodies in object storage (R2) with an index in D1.

### F. Privacy and secret leakage

- **Amp** removed public threads proactively because agents read more files into context with each model generation (quoted above). [read]
- **Entire's threat model** is the most explicit. [read] https://docs.entire.io/security.md
  - "Anyone with access to your repository can read the checkpoints in it. If your repository is public, so are they."
  - The nine layers run during condensation. Layers 1, 3, 4, 5 and 7 cannot be turned off. Scanner choice is read only from the committed project settings, "because scanner choice changes the checkpoint content shared with everyone".
  - Holes it documents:
    - Externalised `assets/` and inline base64 images are not redacted.
    - Structural fields (`path`, `cwd`, keys ending in `id`) are skipped: "A secret parked in a `path` field or inside a base64 blob is not redacted."
    - Shadow branches `entire/<commit>-<worktree>` hold "raw, unredacted snapshots of your working tree". Entire doesn't push these and deletes them after a clean session end.
    - The OpenAI Privacy Filter (a 1.5B-parameter token classifier) runs only on the branch backend at push time, rewriting commits with `Entire-OPF-Applied: true`. The default ref backend "push[es] checkpoints without the OPF pass."
  - Engineering guarantee: a `RedactedBytes` type, so "A code path that tried to write unredacted transcript bytes would fail to compile."
  - Custom PII patterns can themselves leak internal formats: "A pattern that reveals an internal ID format is itself sensitive." [read] https://docs.entire.io/guides/configuration/privacy-and-redaction.md
- **Cursor**: best-effort redaction. "Local files, authentication credentials, and your identity are not included." Admins can delete any team member's transcripts. [read]
- **Claude Code**: repository-access verification for Team/Enterprise shares, and an explicit warning about credentials for Pro/Max public shares. [read]
- **Social and HR sensitivity**: Entire's own docs writer doesn't want to share "the prompts where I'm yelling at my agent." [read] Zed's keystroke-level capture drew "invasive" reactions. [secondary]
- **Data reuse**: git-ai says "we do not train or fine-tune AI models, and we have explicitly made sure we do not have the right to use or sell this data," while pitching the trajectory data for customers' own RL and evals. [read]

### G. Prompt or spec as source of truth

- **GitHub Spec Kit** (as of October 2026): "Specify → Plan → Tasks → Implement → Converge", 38 integrations, 157 community extensions, "130K+ GitHub stars". Bug-fixing and idea-assessment processes are bundled. "Each phase produces a Markdown artifact that feeds the next." [read] https://github.github.com/spec-kit/
- **Kiro specs**: `requirements.md` (or `bugfix.md`), `design.md` and `tasks.md`. Correctness checking uses property-based testing (IDE only), and parallel task execution is supported. [read] https://kiro.dev/docs/specs/
- **Tessl** now markets itself as an "Agent Enablement Platform" built around a skills/context registry. Example claims: "One in seven skills carries a critical security risk"; automated review where "74% of findings are real defects… up from 50%". [read] https://tessl.io/
  - Böckeler had described Tessl in October 2025 as exploring spec-as-source (`// GENERATED FROM SPEC - DO NOT EDIT`, one spec per code file). [read]
- **Böckeler's critique** (October 15, 2025) [read] https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
  - She distinguishes three levels: spec-first, spec-anchored and spec-as-source.
  - Kiro turned a small bug into "4 'user stories' with a total of 16 acceptance criteria".
  - Spec Kit produced "a LOT of markdown files… repetitive… I'd rather review code than all these markdown files."
  - "I frequently saw the agent ultimately not follow all the instructions." Spec Kit makes a branch per spec, which suggests "spec-first only, not spec-anchored over time".
- Mitchell writes his plan to `spec.md` and refers to "@spec.md" in later sessions. [read] This is a spec and a thread used together.

### H. Do reviewers actually read transcripts?

- **No primary study found.** I looked for empirical evidence on whether reviewers open linked transcripts and found none. (The search budget ran out before I could try more queries.)
- **Indirect evidence: sharing happens in the wild.** DevGPT (MSR 2024) collected 29,778 prompts and responses from ChatGPT conversations shared on GitHub and Hacker News, including links from commits, issues and PRs. [read] https://arxiv.org/abs/2309.03914
- **Indirect evidence: agent PRs struggle on trust.** The AIDev dataset (456,000+ agent PRs across 61,000 repos, from Codex, Devin, Copilot, Cursor and Claude Code) finds "their PRs are accepted less frequently, revealing a trust and utility gap". [read] https://arxiv.org/abs/2507.15003
- **Indirect evidence: products are designed for not reading the whole thing.**
  - Entire: "teammates don't need to go through the whole session line by line." [read]
  - Cursor Blame shows summaries. [read]
  - Amp and git-ai route "why" questions through a subagent. [read]
  - git-ai: "saving sessions is easy — retrieving useful intent from them is very hard and can burn a lot of tokens." [read]
- **Indirect evidence: policy asks for less.** Ghostty and the kernel require disclosure trailers, not transcripts. [read]
- **Inference:** the reader of a transcript is now mostly an agent (a review agent, an `/ask` subagent, or a conflict resolver), not a human. Humans read a summary or a single message.

---

## Pain points for agentic-scale development

1. **Volume.** Threads reach millions of tokens and sessions tens of MB. One feature spans 13+ linked threads. Nobody reads them linearly. [read/inference]
2. **Mismatched lifetimes.** One session can produce many commits, one commit can include many sessions (Entire handles both), and squash merges collapse them. Line-level mapping breaks on rebase and squash unless every tool runs repair logic. [read]
3. **Fragile links.** Notes need explicit push/fetch refspecs and rewrite config. SHAs change. Hosted forges don't show notes. Trailers can be deleted or omitted, and Claude Code lets users set `attribution: false`. [read]
4. **Leaking secrets and PII.** Agents read `.env`-adjacent files, credentials and customer data into context. Pattern redaction misses custom formats, images and structural fields. Unlisted URLs are bearer tokens. [read/inference]
5. **Lock-in and access drift.** Thread bodies live on vendor servers (ampcode.com, claude.ai, cursor.com). An Agent Trace `conversation.url` is only useful while the vendor keeps it and the reader still has access. [inference]
6. **Reconstructed "why" is confidently wrong.** Agents asked about old code invent plausible rationales without the original session (git-ai's Sentry example). [read]
7. **Superseded content.** In long threads the first hit is often "an attempt that was later revised or reverted," and "tool calls record attempted actions, not outcomes." [read]
8. **Multiplied write contention.** Thousands of agents saving checkpoints into a single shared branch causes contention. Entire moved to one ref per checkpoint for that reason. [read]
9. **Format churn.** Claude Code's JSONL "is internal… and changes between versions." Every capture tool keeps per-agent adapters (Entire's Agent Integration Protocol, git-ai's hooks). [read]

## How organizations are solving them

- **A link in the commit, the body elsewhere.** Amp, Claude Code and Entire use trailers. git-ai and Cloudflare's guidance use notes. Agent Trace standardises the link (`conversation.url`) and leaves storage open. [read]
- **Per-object refs instead of a shared branch** for checkpoints (Entire 0.10.0). [read]
- **Redact at write time, typed so it can't be skipped** (Entire's `RedactedBytes`). Several layered detectors plus an optional ML PII filter. Settings that change shared content live only in committed project settings. [read]
- **Narrowing visibility.** Amp went from public to workspace/unlisted. Cursor's Enterprise default is team-only. Claude Code checks repository access. [read]
- **Message-level addressing** (git-ai `session::message`) so retrieval pulls only the message that produced a line. [read]
- **Retrieval agents tuned for long threads** that check later revisions, distrust tool calls, and read originals over compactions (Amp). [read]
- **Indexing only intent-bearing text** (prompts and assistant prose) while skipping tool output and code (Entire). [read]
- **Short linked threads** via handoff, fork and mentions, visualised as a thread map (Amp). [read]
- **Thread links as audit evidence** in place of PR review for SOC 2 (Amp). [read]
- **Disclosure trailers for humans** (`Assisted-by`, `Co-Authored-By`) plus explicit statements of what wasn't tested (kernel). [read]

---

## Implications for a future forge (thread-native)

### What the forge should store about a thread

The design below is my synthesis [inference], grounded in the sources above.

1. **An immutable thread record** keyed by a stable, time-sortable ID (ULID, as Entire does). It holds:
   - identity (repo, base commit, human sponsor, agent, model(s), harness version)
   - intent (the task text, plus any spec file or spec ID)
   - status
   - cost and tokens (git-ai's per-PR token cost shows finance will ask)
2. **The message log, split into channels with separate retention and access rules:**
   - (a) human prompts and steering
   - (b) assistant prose and plans
   - (c) tool calls (name, arguments)
   - (d) tool results and file reads (largest, most sensitive, regenerable)
   - (e) reasoning/thinking, if the vendor exposes it
   - Index (a) and (b) for search. Store (c) and (d) redacted, with shorter retention. Keep (d) behind stricter access or drop it once a commit lands. [inference, informed by Entire's indexing choice and my measured 0.4% prompt share]
3. **Edit-to-message links.** Each checkpoint commit links to the message ID that caused it. For a landed commit, an attestation map (file → line ranges → `thread::message`) uses Agent Trace's schema plus `content_hash` for movement. Record the jj-style change ID alongside the SHA if one exists. This is git-ai's v1.4 granularity, in an open format.
4. **Exported pointers in git** so plain git users still get provenance:
   - a trailer on the landed commit (`Forge-Thread: <ULID>`), which survives squash and cherry-pick in the message
   - an Agent Trace record in a notes ref (for example `refs/notes/agent-trace`) for line-level data
   - The forge owns landing, so it can rewrite notes itself and needn't rely on `notes.rewriteRef`.
   - Never put transcript bodies in git. Artifacts' 1 GB repo and 32 MB blob limits forbid it, and repo readers would get the full transcript.
5. **Thread lineage edges:** forks, handoffs, mentions, review subthreads and conflict hand-backs (Amp's thread map), so "why" can follow a chain of threads.
6. **Evidence and outcome edges:** proof artifacts, policy verdicts and the landing record. Later, reverts, incidents and churn (git-ai's "full trajectory"). This connects "why was it written" to "did it work".
7. **A redaction manifest:** which detectors ran, at which versions, what was redacted, and whether an ML PII pass ran (Entire's `Entire-OPF-Applied` idea). An auditor can then judge how much to trust a shared thread.

### How it should be indexed and queried

- **blame → thread → message → ask.**
  - Run `git blame --porcelain`, then look up the landed commit's attestation, then the `thread::message` ranges, then open that message.
  - The default answer is an `/ask` subagent seeded with only the linked messages and their later revisions, not the whole thread (git-ai's and Amp's lessons).
  - Fall back to commit-level when line data is missing, and say so (Entire's honesty about AI/MX/HU at commit level). Distinguish "human" from "untracked" (Git AI Standard).
- **Search**: hybrid semantic and keyword search over prompts, assistant prose and commit messages. A separate code search. File-touch search ("which threads touched path X", Amp `find_thread`). All filtered by repo ACL at query time.
- **At merge and conflict time** (the brief's idea 5): when the landing service detects a conflict, retrieve both threads' intent messages and pass them to the resolver. That is a concrete use for provenance that none of the tools above ship. Amp, git-ai and Entire use it for review, planning and Q&A only.
- **At planning time**: before an agent edits a region, load the messages tied to those lines (git-ai: "In plan mode, always use the /ask skill"; Entire Brain).
- **Retrieval rules** (from Amp's tuning): prefer later messages that revise earlier ones, treat tool calls as attempts, verify against the landed diff, and quote original messages rather than compactions when exact wording matters.

### Pitfalls to design against

- **The thread link becomes a secret-sharing link.** A thread inherits the strictest access of any file it read. Default to repo-scoped visibility checked at read time (Claude Code). No public discoverability (Amp's reversal). Unlisted means bearer token, so expire and audit those links.
- **Redaction gaps.** Images, base64, path fields, custom token formats and names. Run redaction server-side as well, since a forge sees all writes. Keep raw working-tree snapshots off the network (Entire's shadow branches).
- **Squash and rebase drift.** Line-level attribution needs the forge to own history rewrites. Content hashes help, and jj change IDs help more.
- **The "AI" label means less than it looks.** Mixed commits and human edits inside agent commits blur the label. A tag must say what it guarantees.
- **Confident wrong answers.** An `/ask` agent can still misread a thread. Show citations to specific messages, as Sourcegraph Deep Search lists sources.
- **Storage and cost growth.** Tens of MB per session times thousands of agents per day needs tiered retention, and fact extraction costs tokens (Entire Brain's warning).
- **Surveillance and HR misuse.** Capturing everything (Zed's reception; "yelling at my agent") may push developers to work around the system. Provide a way to keep human chatter private while still exposing intent.
- **Vendor URL rot.** Ingest a copy of the thread into the forge rather than storing only a vendor URL (Agent Trace's default pattern). Otherwise provenance dies with a SaaS account.
- **Specs aren't enough on their own.** Spec files drift and agents ignore them (Böckeler). Treat a spec as one input linked from the thread, not a substitute for the thread.

---

## Contradictions and pushback

- **Line-level or commit-level?**
  - git-ai claims durable line-level attribution through all rewrites, now at message level.
  - Entire argues durable line-level attribution "requires repair logic that runs everywhere history changes" and stays commit-level.
  - Both can be true: git-ai's approach works when everyone runs git-ai, which a forge that owns landing could guarantee. [inference]
- **Notes or trailers?**
  - Cloudflare and git-ai recommend notes. Entire rejects them.
  - Agent Trace stays neutral.
  - A forge can do both: a trailer for durability, a note for detail.
- **Link only, or store the body?**
  - Cognition says linking by URL keeps PII out of the trace store.
  - Entire stores redacted full transcripts in your repo, because "Entire does not operate a service that receives your transcripts."
  - It's a trade between vendor lock-in and the leak surface in the repo.
- **Hooks or a git wrapper?** The git-ai 1.0 post says it "wraps your git binary"; the current README says it "does not wrap the Git binary" and uses no git hooks. The implementation changed between versions; I didn't verify how it works now. [read, both]
- **Did Amp keep compaction?** Handoff (October 2025) "removed compaction". Read Bigger Threads (July 2026) says "we added compaction" back. [read]
- **Do humans value transcripts?** Simon Willison and Mitchell Hashimoto clearly do, for teaching and records. Product evidence suggests most readers want summaries or targeted answers. No measurement settles it.
- **Is spec-driven development the "source of truth"?** GitHub frames specs as "living, executable artifacts", but Spec Kit creates a branch per spec (Böckeler). Tessl moved away from spec-as-source in its marketing.
- **Brief correction:** the brief says Entire records "the session and prompt behind each line". Entire's own FAQ says its attribution is commit-level, and line-level attribution is explicitly not promised.

## Open questions

- Is there any empirical study (MSR, ICSE 2026) of reviewers opening linked agent transcripts, or of whether transcript links change PR acceptance or time-to-merge? I didn't find one; this needs a follow-up search.
- How widely is Agent Trace actually emitted by default (Cursor, Amp, OpenCode, Cline)? The spec repo's activity since v0.1.0 is unverified: GitHub API access was blocked and the search budget ran out.
- What happens to the open-source git-ai project and the Git AI Standard after the OpenAI move? Will Codex emit `refs/notes/ai`?
- Can the Artifacts `log({ref})` binding read `refs/notes/*`, and do Artifacts event subscriptions fire on notes-ref pushes? I haven't tested either.
- What is the right retention period for tool results versus prompts? Are there regulatory requirements (SOC 2, EU AI Act provenance) for keeping prompts?
- How should a thread that read data from a more restricted repo be shared in a less restricted one? This is ACL inheritance across repos.
- Do Zed DeltaDB anchors interoperate with Agent Trace content hashes, or is that a separate silo?

---

## Sources (opened and read unless marked)

Amp
- Thread Sharing (docs), undated, read October 2026: https://ampcode.com/docs/collaborate/thread-sharing
- Threads (docs): https://ampcode.com/docs/threads
- The End of Public Threads, June 2, 2026: https://ampcode.com/news/end-of-public-threads
- Social Coding, November 4, 2025 (updated June 2, 2026): https://ampcode.com/news/social-coding
- Amp Now Reads Threads, October 29, 2025: https://ampcode.com/news/read-threads
- Find Threads, December 8, 2025: https://ampcode.com/news/find-threads
- Read Bigger Threads, July 2, 2026: https://ampcode.com/news/read-bigger-threads
- Thread Map, December 11, 2025: https://ampcode.com/news/thread-map
- Handoff (No More Compaction), October 23, 2025: https://ampcode.com/news/handoff
- Liberating Code Review, February 4, 2026: https://ampcode.com/news/liberating-code-review
- Secret Redaction, May 30, 2025: https://ampcode.com/news/secret-redaction
- "That's not SOC 2 compliant", August 13, 2026: https://ampcode.com/notes/thats-not-soc-2-compliant
- Chronicle index: https://ampcode.com/chronicle

Anthropic / Claude Code
- Use Claude Code in the cloud (sharing, teleport): https://code.claude.com/docs/en/claude-code-on-the-web
- Manage sessions (export, storage, --from-pr): https://code.claude.com/docs/en/sessions
- Settings reference, attribution section: https://code.claude.com/docs/en/settings-reference.md
- Docs index: https://code.claude.com/docs/llms.txt

Cursor
- Shared transcripts (help): https://cursor.com/help/ai-features/shared-transcripts.md
- Cursor Blame: https://cursor.com/docs/integrations/cursor-blame.md
- Origin, agents and automations: https://cursor.com/docs/origin/agents.md
- Docs index: https://cursor.com/llms.txt

Entire
- CLI overview / introduction: https://docs.entire.io/cli/overview.md
- Docs index: https://docs.entire.io/llms.txt
- Session Storage (verified against CLI 0.10.2): https://docs.entire.io/guides/checkpoints/checkpoint-storage.md
- Capture Sessions and Checkpoints: https://docs.entire.io/guides/checkpoints/capture-checkpoints.md
- Privacy and Redaction: https://docs.entire.io/guides/configuration/privacy-and-redaction.md
- Security & Privacy: https://docs.entire.io/security.md
- blame: https://docs.entire.io/cli-reference/blame.md
- why: https://docs.entire.io/cli-reference/why.md
- FAQ: https://docs.entire.io/faq.md
- What Is Indexed and When: https://docs.entire.io/guides/search/what-is-indexed.md
- Resume Sessions: https://docs.entire.io/guides/sessions/resume-sessions.md
- Brain overview: https://docs.entire.io/guides/brain/overview.md
- Blog index: https://entire.io/blog
- Sharing Sessions is the New Social Coding, October 6, 2026: https://entire.io/blog/sharing-sessions-is-the-new-social-coding
- Introducing entire blame, June 30, 2026: https://entire.io/blog/introducing-entire-blame
- Vision: https://entire.io/vision
- Thoughtworks Radar, Entire CLI, April 15, 2026: https://www.thoughtworks.com/radar/tools/entire-cli
- (Search snippets only: funding and launch date via rywalker.com, aicoolies; not opened) [secondary]

git-ai
- Homepage: https://usegitai.com/
- Blog index: https://usegitai.com/blog
- Git AI is now 1.0, November 8, 2025: https://usegitai.com/blog/introducing-git-ai
- Keep the prompts, January 6, 2026: https://usegitai.com/blog/git-ai-blame
- Ask the Agent, February 18, 2026: https://usegitai.com/blog/ask-the-agent
- Shipping Message-level Attribution, May 20, 2026: https://usegitai.com/blog/message-level-attribution
- Tokens per Pull Request, May 27, 2026: https://usegitai.com/blog/token-cost-by-pull-request
- Git AI is joining OpenAI, September 11, 2026: https://usegitai.com/blog/git-ai-is-joining-openai
- README: https://raw.githubusercontent.com/git-ai-project/git-ai/main/README.md
- Git AI Standard v3.0.0: https://raw.githubusercontent.com/git-ai-project/git-ai/main/specs/git_ai_standard_v3.0.0.md
- (Coverage, search snippet only: The New Stack "OpenAI hires Git AI founders") [secondary]

Agent Trace
- Spec v0.1.0, January 2026: https://agent-trace.dev/
- Cognition, Agent Trace: Capturing the Context Graph of Code, January 29, 2026: https://cognition.com/blog/agent-trace
- Thoughtworks Radar, Agent Trace, April 15, 2026: https://www.thoughtworks.com/radar/platforms/agent-trace
- (GitHub repo page fetched, but stats not extractable): https://github.com/cursor/agent-trace

Zed / Sourcegraph
- Software Is Made Between Commits, June 11, 2026: https://zed.dev/blog/introducing-deltadb
- Sourcegraph Deep Search docs: https://sourcegraph.com/docs/deep-search

SpecStory / sharing practice
- SpecStory product page: https://specstory.com/markdown/specstory.md
- SpecStory docs index: https://docs.specstory.com/llms.txt
- How to be an Open Source Hero, October 2, 2025: https://specstory.com/blog/how-to-be-an-opensource-hero
- Simon Willison, claude-code-transcripts, December 25, 2025: https://simonwillison.net/2025/Dec/25/claude-code-transcripts/
- Mitchell Hashimoto, Vibing a Non-Trivial Ghostty Feature, October 11, 2025: https://mitchellh.com/writing/non-trivial-vibing

Spec-driven development
- Böckeler, Understanding SDD: Kiro, spec-kit, and Tessl, October 15, 2025: https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html
- GitHub Spec Kit docs home: https://github.github.com/spec-kit/
- Kiro Specs docs: https://kiro.dev/docs/specs/
- Tessl homepage: https://tessl.io/

Policies and standards
- Ghostty AI_POLICY.md: https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md
- Linux kernel, AI Coding Assistants (7.3.0-rc7 docs): https://docs.kernel.org/process/coding-assistants.html
- git-notes manual: https://git-scm.com/docs/git-notes
- git-interpret-trailers manual: https://git-scm.com/docs/git-interpret-trailers

Cloudflare Artifacts
- Docs index: https://developers.cloudflare.com/artifacts/llms.txt
- Best practices (git notes for prompts), modified April 25, 2026: https://developers.cloudflare.com/artifacts/concepts/best-practices/
- Workers binding: https://developers.cloudflare.com/artifacts/api/workers-binding/
- Git protocol: https://developers.cloudflare.com/artifacts/api/git-protocol/
- Repositories: https://developers.cloudflare.com/artifacts/concepts/repositories/
- Limits, updated October 1, 2026: https://developers.cloudflare.com/artifacts/platform/limits/

Research
- Xiao et al., DevGPT (MSR 2024 Mining Challenge), arXiv 2309.03914: https://arxiv.org/abs/2309.03914
- Li, Zhang, Hassan, The Rise of AI Teammates in SE 3.0 (AIDev), arXiv 2507.15003: https://arxiv.org/abs/2507.15003

Measured
- Local Claude Code transcripts for this research session under `~/.claude/projects/-home-user-regit/` (34 files, 14.3 MB), analysed by content-block type.

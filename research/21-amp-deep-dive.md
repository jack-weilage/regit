# 21 — Amp deep dive: the most advanced "thread-native, push-to-main" practice

Researcher key: `21-amp-deep-dive`. Written 2026-10-12. Method: the whole Amp Chronicle index (ampcode.com/news, the same page as /chronicle) and sitemap were downloaded. About 150 Amp pages were fetched and converted to text: every orb-related post, the orb, shipping, portals, threads and GitHub docs, the team's "How I use Amp" profiles, the four time-capsule transcripts, the "Working Day to Day" screencast transcript and all five Season 2 podcast transcripts. Two Hacker News threads were read through the HN API. Tags used throughout:

- **[read]** means verified on a page I opened.
- **[secondary]** means coverage or commentary.
- **[inference]** means my own reasoning.

Dates are publication dates shown on the page, not sitemap lastmod dates.

---

## Summary

- **[read] Amp's thread is the unit of work, and its docs now say so.** The Threads doc says threads "are the unit of work in Amp". An orb thread bundles several things:
  - the conversation;
  - an isolated Debian 12 microVM (E2B, GCP us-west1);
  - a Changes pane with Ship, Review, Restack and Sync;
  - Portals, Files, a Terminal and a Desktop;
  - a Space voice/video call;
  - multiplayer;
  - schedules, webhooks, and agent-to-agent messaging.

  The Multiplayer post (2026-07-22) says orbs are "quickly becoming the de facto 'unit of work'".
- **[read] Landing is still a prompt, not a platform service.** The default Ship button sends the agent a prompt with these steps:
  1. commit;
  2. fetch and rebase onto origin/main;
  3. run the full test suite;
  4. push to main;
  5. if main moved, rebase, resolve conflicts and push again;
  6. archive the thread.

  The agent "checks with you" on substantive conflicts and only ignores a failing test if it also fails on base. There are three Ship Behaviors: Ship, Push to Branch, and Custom Ship (a free-text prompt of up to 10,000 characters with no template variables). The brief's thesis that "neither owns landing" is **confirmed**.
- **[read] Metrics confirmed, with a nuance.** Pave The Road (Alex Kemper, 2026-08-10) says that since orbs shipped "a month ago", commit velocity "has increased by 65%" and "more than 85% of our commits" come from orbs. The chart caption says the share was "climbing above 80%". These are internal, unaudited figures with no absolute baseline.
- **[read] SOC 2 without PRs is confirmed.** The note is by Will Dollman, 2026-08-13. The controls are:
  - restricted push access;
  - GitHub-enforced signed commits on main;
  - full CI where "bad changes block main";
  - commits linked to the threads that produced them.

  "Code review isn't on the list." The scale caveat is explicit: "We're 20 people… we're not going to pretend a 2,000-person company should let everyone push to main." The security page says Amp is "SOC 2 Type II certified".
- **[read] Portals are authenticated reverse-proxy URLs to any HTTP service in the orb.** Amp creates them on demand, through supervised services declared in `.amp/services.yaml` or via `amp orb service start --portal`.
  - **URL format:** `t-<thread>-p<port>.onamp.dev`, or a custom or workspace domain.
  - **Comment widget:** an injected review widget sends element-anchored comments, with selected text, page location and source location, straight to the agent.
  - **Access:** thread-scoped by default. A portal can be made public for 1 hour, 3 hours, 1 day or 7 days. The proxy sends an `X-Amp-Authenticated` header plus identity headers.
- **[read] Orbs are not actually "infinite".** Marketing says "There's no limit" and "Orbs are infinite". The Orbs doc says "Each user can start a burst of 20 metered orbs. After that burst, Amp starts one new orb every five minutes." This contradiction matters for agentic fan-out.
- **[read] Orb pricing (2026-08-07, still current):**

  | Size | Spec | Price |
  |---|---|---|
  | a1.tiny | 1 CPU, 2 GB | $0.08/hour |
  | a1.small | | $0.17/hour |
  | a1.medium (default) | | $0.33/hour |
  | a1.large | | $0.66/hour |
  | a1.xxlarge | 16 CPU, 32 GB | $1.32/hour |
  | a1.3xlarge | 16 CPU, 44 GB; Gigawatt or Enterprise only | $2.13/hour |

  Disk is 60 GB and billing is per minute. An orb pauses 5 minutes after agent work ends or 20 minutes after the last human interaction, whichever is later, and a paused orb costs nothing. The $20/month Megawatt tier includes "45,000 minutes of orbin' time".
- **[read] The human role is now ask for proof, try it in a portal, spot-check, decide architecture, write prose.**
  - Thorsten: "I don't read all the code and for a lot of changes I don't read it at all."
  - Quinn: "it's very rare that I will ship something without reviewing the code", except low-blast-radius or visual changes.
  - Kemper: "I still make all of the architectural decisions."
- **[read] Public threads were removed on 2026-06-02.** Amp gave the reason: "It's getting too hard to review a thread to ensure it doesn't contain any snippets of sensitive files… as they get better they read more files into context." Workspace, group and Unlisted sharing remain. This is a direct warning for any forge that stores threads as provenance.
- **[read] Handoff has a messy history.** It replaced compaction (2025-10-23), was removed in favour of automatic compaction in the Neo rebuild (2026-05-06), and the current Threads doc again tells users to say "Handoff and …". Fork was removed (2026-01-13). Thread mentions plus a `read_thread` subagent are now the stable context-sharing primitive. Amp's longest thread "has been compacted over 68 times"; uncompacted it would exceed 21 million tokens.
- **[read] Provenance is git-native.** Commits carry an `Amp-Thread-ID:` trailer and an optional `Co-authored-by: Amp` trailer. Commits are signed by Amp-held SSH keys, so "the private key never enters the orb". Orb git credentials are short-lived tokens issued per command through a credential helper and are "never written to disk". Orbs also mint OIDC tokens whose subject is `workspace:…:project:…:user:…:thread:…`.
- **[read] What went wrong, by Amp's own account:**
  - On the S2E4 podcast (2026-09-11), Quinn admits "a bunch of incidents in the last five, seven days". Push-to-main changes were "about a third" of incident count but "far less" of downtime minutes and users affected. Most incidents came from infrastructure: inference, durable agent execution, and sandboxes.
  - Camden says Amp "slips in things like backcompat shims… unnecessary caching" that "add up over time".
  - Quinn calls the parallel workload "very overwhelming".
- **[inference] What would break at 2,000 engineers, by Amp's own statements:**
  - trust-based push access (the SOC 2 note);
  - an agent-side rebase-and-retry loop against one trunk;
  - per-user orb spawn pacing;
  - the absence of approval evidence (the HN critique);
  - the fact that "no single person on our team has every single piece of the system… in their head", even at 20 people.

  Amp itself has not published a scaling design. Its answers are custom Ship prompts, which push to a branch or merge queue, and Amp Labs "small elite teams" inside large companies.
- **[read] Forward signal:** Kemper writes that "next year will be about agentic CI/CD. We're already working on it." Thorsten says on S2E1 that "the whole idea of CI is bonkers… CI is now part of the agentic workflow."

---

## Detailed findings

### A. The full Amp Chronicle index, every post with date [read]

Source: https://ampcode.com/news (byte-identical to https://ampcode.com/chronicle). The News list holds 165 entries. "Shared Runners" (2026-09-24) appears only in the Featured box. Notes are listed separately at the end of this section.

<!-- INDEX -->

**Notes (long-form) [read]:**
- 2025-04-29 Frequently Ignored Feedback (FIF)
- 2025-05-12 How We Build
- 2025-05-15 Amp is now available. Here's how I use it
- 2025-06-10 Agents for the Agent
- 2025-09-10 How We Think about Permissions
- 2025-12-10 200k Tokens Is Plenty
- 2025-12-18 A Codebase by an Agent for an Agent
- 2026-01-14 How to Pair With an Agent
- 2026-02-05 Feedback Loopable
- 2026-02-24 Mainframe Magic
- 2026-07-02 Putting an Agent in an Orb
- 2026-08-04 What I Want to Tell You About Orbs
- 2026-08-10 Pave The Road
- 2026-08-13 "That's not SOC 2 compliant"
- 2026-08-25 Orbs, Explained

**Time Capsules (unedited screencasts with transcripts) [read]:**
- 2026-07-27 Building Software With Amp and Orbs (Quinn, 24:31)
- 2026-07-28 Native iOS and macOS Development With Amp (Quinn, 4:59)
- 2026-08-11 Iterating With Agents in Orbs Using Portals (Thorsten, 4:18)
- 2026-09-15 Orbing Screencasts (Brett, 14:07)

**Podcast, Raising an Agent Season 2:**
- E1 "The Local Dev Env is Dead", 2026-07-17
- E2 "Orbs and Jellyware", around 2026-08-11
- E3 "When Tokens Flow Like Electricity", around 2026-08-27
- E4 "What Is the Computer For Now?", 2026-09-11
- E5 "Stop Boxing In Your Agent", 2026-09-25

**Other pages:**
- /what-are-orbs, updated 2026-10-11.
- /morbs, a "Mac Orbs // Beta" teaser, around 2026-10-05: "It's Morbin' Time. Amp just got a Mac."

**Correction to the brief [read]:**
- "Putting an Agent in an Orb" is dated **2026-07-02**, two days after "Agents in Orbs" (2026-06-30). It is not from August.
- The "prove it end to end… Dazzle me" quote comes from "What I Want to Tell You About Orbs" (2026-08-04).
- "proof, not a diff" is the subtitle of the Fable 5.1 post (2026-09-01).

**Timeline of the thread-native turn [read]:**
1. 2026-02-19: the editor extension is killed ("The Coding Agent Is Dead").
2. 2026-05-06: Neo rebuild. Amp becomes "a distributed system with durable execution for the agent loop" (Agents, Everywhere, 2026-06-04).
3. 2026-06-02: public threads end.
4. 2026-06-16: Diffs.
5. 2026-06-30: Agents in Orbs.
6. 2026-07-08: runners.
7. 2026-07-14: OIDC.
8. 2026-07-17: Agent-to-Agent.
9. 2026-07-21: schedules.
10. 2026-07-22: Multiplayer.
11. 2026-07-23: webhooks.
12. 2026-08-06: Portals.
13. 2026-08-31: Space.
14. 2026-09-01: intelligent diff ordering.
15. 2026-09-11: Restack.
16. 2026-09-13: Amp is free if you bring compute and models. "You pay us for orbs."
17. 2026-09-24: Shared Runners.

### B. What an orb is, mechanically [read]

- **Definition.** "Orbs are remote machines where Amp agents work without using your computer. Every orb thread gets a fresh, isolated environment with your code, plugins, development tools, and the context of the thread that created it." Source: https://ampcode.com/docs/orbs.
- **Infrastructure.** E2B microVMs. The security page lists "e2b … provides ephemeral compute instances for Amp orbs". The Customizing doc says "Amp's default E2B orbs currently run in Google Cloud us-west1". Orbs run Debian 12 with this preinstalled:
  - authenticated `gh` and `amp`;
  - git, tmux, Bun, Node, pnpm, Python and uv;
  - agent-browser, ffmpeg, ImageMagick and ripgrep;
  - Postgres and Redis, per the July note.

  Docker is not installed; "install it from .agents/setup… run the daemon as a supervised orb service". Sources: https://ampcode.com/docs/orbs/customizing, https://ampcode.com/security.
- **Lifecycle.**
  1. Look for a project snapshot that matches the orb size and source.
  2. If one matches, restore it and skip setup.
  3. Otherwise run the pre-clone script, then clone (shallow, single-branch, into `/home/user/workspace/repo`), then pre-setup, then `.agents/setup`. Setup is stopped after 20 minutes.
  4. Save the snapshot.
  5. Apply thread environment and workload identity.
  6. Run `.agents/resume`. Amp waits up to 10 seconds before it continues.
  7. Start the agent.

  Snapshots are reused "for up to 72 hours" in the current docs and security page. **The brief's "24 hours" came from the July note, which has since been superseded.** Setup must not leave daemons running, because "Amp stops every process the script leaves running".
- **Pause and wake.** An orb pauses when the agent has done no work for 5 minutes AND no human has interacted for 20 minutes. Any authorized portal request counts as an interaction. Opening the thread, opening a portal, sending a message, webhooks and automations all wake it. Archiving pauses it. "Orb Saver Mode" stops a page view from waking it. Source: https://ampcode.com/docs/orbs/sizes-and-costs.
- **Spawn pacing.** "Each user can start a burst of 20 metered orbs. After that burst, Amp starts one new orb every five minutes. Later orb starts wait instead of failing." Source: https://ampcode.com/docs/orbs. This contradicts "You can spawn hundreds of them. Thousands. There's no limit" (Orbs, Explained) and "Orbs are infinite" (What Are Orbs).
- **Price history.**
  - 2026-06-30: billed by the minute.
  - 2026-07-03: storage doubled from 20 GB to 40 GB.
  - 2026-07-27: 20% price cut.
  - 2026-08-07: new a1 sizes; a1.medium is "50% cheaper"; auto-pause cut from 15 minutes to 5.
  - Now: 60 GB disk.
  - Data handling: "Amp Server does not store a copy of the orb filesystem". A paused orb's filesystem and memory remain encrypted at rest until the thread is deleted.

  Sources: https://ampcode.com/news/size-the-orbs-of-production, https://ampcode.com/news/more-orb-sizes, https://ampcode.com/security.
- **Runners**, the pets next to orbs as cattle. `amp --no-tui` turns any machine into an executor.
  - Since 2026-09-17 a runner can serve many directories, and it updates itself.
  - Since 2026-09-22 it creates git worktrees per thread, including an "Archive and Remove Worktree" action.
  - Since 2026-09-24 `--share` exposes a runner to the workspace, with a warning: "everyone you share with runs code on your machine as you… Their threads can also work in the same directories at the same time… (Better still: use orbs, so that every thread gets its own machine.)"
  - Portals are not available on runners.

  Sources: https://ampcode.com/news/shared-runners, https://ampcode.com/docs/cli/runners.
- **Making a repo orb-ready.** "Putting an Agent in an Orb" (Thorsten, 2026-07-02) describes:
  - a 428-line `.agents/setup` that runs Postgres with fsync, synchronous_commit and autovacuum off, plus seeds, mise and pnpm;
  - an `ensure-dev-server.sh` skill that reuses, restarts or starts the server and writes ports to `.amp/dev-ports.json`;
  - `/__dev/log-me-in/<email>`, `/__dev/sudo` and `/__dev/preflight` endpoints;
  - a single log, `.amp/in/server.log`, with browser console lines tagged `[browser]`;
  - **41 AGENTS.md files**.

  The brief's claims are verified. The agent's own summary: "The environment doesn't just tolerate an agent; it assumes one, and tells it where the light switches are." Source: https://ampcode.com/notes/putting-an-agent-in-an-orb.

### C. Portals in detail [read]

- **What a portal is.** "Portals are authenticated URLs that expose web servers running inside an orb, so you can open a dev server or preview app straight from the thread's Portal tab." "Anything that can speak HTTP and listen on a port can be a portal." The launch post says the motivation was "No VPN, no port juggling, and no waiting for preview deployments." Sources: https://ampcode.com/docs/orbs/portals, https://ampcode.com/news/portals (2026-08-06).
- **How one is created on demand.** The user says "show me in a portal". The agent then "knows to create or look for a `.amp/services.yaml` file and then run `amp orb services <ensure|start>`". The app must respect the `PORT` and `PUBLIC_URL` environment variables.
  - **Service declaration.** Each service in `services.yaml` declares `command`, `cwd`, `port`, `env`, `health`, `portal`/`portals` (links and folders), `review` (default true) and `platforms` (linux or darwin).
  - **Wiring between services.** One service can reference another's URL, for example `${services.web.publicURL}`. Cycles are rejected.
  - **What `ensure` does.** It starts missing services, waits for health (a 2xx or 3xx response), and writes `.amp/portals/*.json`. Those files are generated and should be gitignored.
  - **Supervision.** Processes started with nohup, setsid, `&` or tmux are explicitly disallowed: "Processes started that way can be stopped when Amp updates or the orb resumes. Use a supervised service."
  - **One-off portals.** These use `amp orb service start NAME --command … --portal`, which waits 60 seconds for the port. The lower-level `amp orb portal <port>` covers a server that is already listening.
- **URLs and hostnames.**
  - The default is `https://t-…-p3000.onamp.dev`. The `p<number>` "identifies Amp's Portal proxy" and may differ from the internal port.
  - Friendly hostnames (2026-08-23) take the form `name--namespace.onamp.dev` or a custom domain.
  - A workspace can set "Make Default for Portals" so that all links use `t-<thread>-p<port>.portal.example.com`.
  - A hostname survives archiving and can be moved to another thread with `--take-over`.
- **Annotation and review.** "The floating review button lets you select an element and send a comment to the thread. Amp receives your comment with the selected text and page location. It also receives the source location when the app can provide one." The widget is injected into every page. It can be disabled per service with `review: false` or per response with the header `x-amp-review-widget: off`. Thorsten in Time Capsule 3: commenting in the portal "is better than annotating screenshots, or more token efficient".
- **Access model.**
  - By default "only people who can view the thread can access its portals". A multiplayer participant has access while their access lasts.
  - "Make Public" gives anyone with the link access for 1 hour, 3 hours, 1 day or 7 days. It covers that port only and does not grant thread access.
  - The proxy sets `X-Amp-Authenticated: amp-user=yes|no, workspace-member=yes|no, collaborator=yes|no`. For members it also sends `X-Amp-User-ID`, `-Display-Name`, `-Email` and `-URL`. Apps are told: "check for string-includes workspace-member=yes".
  - Inside the owning orb, requests to the portal URL go straight to the local service, which bypasses portal auth so headless browsers can test.
  - Cross-portal CORS is unsupported "because CORS preflight requests do not carry portal authentication".
  - Nested portals (a portal inside a portal) need DNS and TLS hacks. Quinn in Time Capsule 1: "you cannot easily have like deeply nested subdomains because then you have to wait for a TLS cert".
- **Lifecycle and billing.** "Opening a portal wakes a paused orb. The orb resumes billing while the request and services are active."
- **How reviewers use portals:**
  - **Tim Lucas:** "Portal URLs is #1 — I like to see how the product feels… on a real device… not a fake storybook".
  - **Beyang:** "For actual UX (most important): examine the screenshot/video, use the portal".
  - **Quinn:** "Almost always using it in the portal tab and asking it for verification."
  - Portals are also used for long-lived apps, not just previews: "that's increasingly how teams are using portals" (2026-08-23).
  - Amp also streams an iOS simulator through a portal from a Mac runner (Tim).

  Sources: https://ampcode.com/docs/using-amp/tim, https://ampcode.com/docs/using-amp/beyang, https://ampcode.com/docs/using-amp/quinn.

### D. Changes pane, review, Restack, Ship [read]

- **Changes pane** (https://ampcode.com/docs/threads). It lists committed and uncommitted changes and offers Ship, Review ("walks through the diff"; Quinn calls it "an oracle review") and Sync (`amp sync <thread>` mirrors the orb branch locally).
  - Intelligent ordering (2026-09-01) puts "the files that best explain a change" first and mutes tests, fixtures and generated code.
  - Intelligent ordering is disabled above 500 files.
  - Duplicate-block detection in the diff algorithm (Diffs, 2026-06-16) is shown beating GitHub's highlighting.
- **Earlier review lineage.**
  - 2025-10-25: Review panel with AI summary and tour.
  - 2025-12-18: a review agent on Gemini 3 Pro.
  - 2026-02-04, "Liberating Code Review": `amp review` CLI and `.agents/checks/*.md`. Each check gets "a separate agent for each check… a stronger guarantee that each check will actually be checked than if the checks were embedded in a general context file like AGENTS.md", scoped by directory.
  - Open questions Amp posed itself on 2025-12-18: "How do reviews map to threads? It's not 1-1".
- **Oracle** (2025-07-04 o3; 2025-10-01 GPT-5; 2026-03-05 GPT-5.4). A read-only "second opinion" subagent. The current docs say "Every mode has an oracle… The more capable modes can pair different frontier models so one model can review the other's reasoning." Other subagents: Search, Librarian, Task and Read Thread. Subagents "can't communicate with each other", and the main agent only sees their final summary. Source: https://ampcode.com/docs/models-and-subagents.
- **Restack** (2026-09-11). "organizes all of your thread's changes into a cleaner set of commits… The final file contents stay the same." It covers committed and uncommitted changes since the merge base, "rewrites local commit history… It does not push." Reviewers then pick commits in a commit picker. Beyang's flow is Restack, then intelligent order, then a per-commit diff. Kemper asks the agent to "break the diff into logically coherent commits, and then provide a TLDR and file review order for each commit."
- **Ship** (https://ampcode.com/docs/orbs/shipping, updated 2026-10-07).
  - **Default steps:**
    1. commit;
    2. fetch and rebase onto origin/main;
    3. run the full test suite;
    4. push to base;
    5. if the push fails because base moved, rebase, resolve and push again;
    6. archive the thread and child threads, and remove the runner worktree.
  - **Conflict handling:** "When a rebase produces a substantive conflict, the agent resolves it and checks with you before continuing. It ignores a failing test only after confirming that the same test also fails on the base branch without the thread's changes."
  - **Scope and permissions:** the setting is per project. A workspace-project creator or admin can change it. It can also be set from the CLI with `amp projects update --ship-behavior custom --custom-ship-prompt-file`. Amp stores a copy and does not read the repo file on its own.
  - **Who can trigger it:** Puck and other threads trigger the same prompt. "Agents use a prompt only when you name it… say 'ship' to use the Ship prompt."
  - **Built-ins queue rather than steer:** "Ship, Review, and other builtin actions still queue" (Steer, Don't Queue, 2026-09-08).
  - **Quinn on the design** (Time Capsule 1): "some people say, oh, I don't like that the ship button just sends a message to the agent… the beauty of agents is you don't need deterministic knobs and levers".
- **After Ship, the agent carries the change to production.** From The Amp Way: "A thread ends when the change has landed and we know it works, not when the code is written." Thorsten's day-in-Amp video (2026-09-22) shows Ship, then "Monitor the rollout, and check every 15 minutes", with the agent checking a `/_version` endpoint, CI and deploy, then cutting a CLI release, emailing the user and closing the bug.

### E. Thread sharing, provenance, multiplayer, Space [read]

- **Visibility levels.** Private (workspace admins can also see), Workspace, Group (Enterprise) and Unlisted (anyone with the link).
  - Threads in workspace projects are shared with the workspace by default. FIF justifies this: it "reduces the expectation that every thread must be 'perfect'".
  - Threads export as Markdown by adding `.md` to the URL, or as full JSON.
  - Activity at `/feed` is a filterable feed of all visible threads.
- **End of public threads** (2026-06-02). The quote is in the Summary. Also: "This decision is proactive and isn't prompted by any incident." Existing Public (Discoverable) threads became Unlisted, and profiles no longer show threads. The original Social Coding post (2025-11-04) is now annotated "removed".
- **Threads as institutional memory.**
  - Kemper: "something like 80% of all work is a slightly-different version of previous work… This is our version of an agent memory system… I think this thread-as-company-knowledge-base pattern is probably the biggest difference between how Amp operates versus our customers."
  - `read_thread` became a subagent (2026-07-02). Its prompt rules include "Tool calls record attempted actions, not outcomes."
- **Git trailers and signing.**
  - "Commits the agent makes through its shell also carry an `Amp-Thread-ID:` trailer with the URL of the thread."
  - The author policy is Amp, You + Amp, or You. A workspace chooses Amp, Amp Account, or User Choice.
  - Signing uses an Amp-held SSH keypair, and "Git in the orb calls Amp to sign each commit". Commits under the Amp identity are signed with Amp's key.
  - A PR description containing a thread URL links the PR back to the thread.

  Source: https://ampcode.com/docs/github, https://ampcode.com/news/no-mailmap-required.
- **Multiplayer** (2026-07-22; docs). Enabled for 7 days by default. "every workspace member can access the thread, its orb or shared runner, secrets, files, and terminal." "All agent and orb costs are billed to the thread owner." @-mentioning a teammate (2026-08-19) invites them and turns multiplayer on.
- **Space** (2026-08-31). A LiveKit voice, video and screen-share call per thread. "The call lives where the work lives."

### F. Agent-to-agent, automations, webhooks, Puck [read]

- **Agent to Agent** (2026-07-17; docs).
  - Agents spawn threads in orbs, on runners, or in other projects. They send messages and explicit file transfers: "A message does not transfer files or commits by itself."
  - Fan-out guidance: "Run four low-mode threads in parallel… Start four low-mode threads in a1.tiny orbs."
  - Docs rule: "Keep work in the current thread when tasks need constant coordination or edit the same files."
  - Will Dollman: "I kicked off a scan this morning that ran for an hour over 40 orbs."
  - Thorsten uses "Orbs as evals for how agent-friendly the codebase is". A parent orb pushes an AGENTS.md change, spawns 3 orbs, reads their threads and compares the results.
- **Automations** (2026-07-21). One schedule per thread, set in natural language. The agent wakes with its saved prompt and full context. A failed run pauses the automation.
- **Webhooks** (2026-07-23; docs).
  - `amp.createWebhook({key, headers, handler})` registers a stable POST URL.
  - Events are stored before HTTP 200 and delivered "at least once". Handlers have 30 seconds. Retries back off exponentially to 5 minutes and give up after 1 hour.
  - Rate limits: bursts of 10, refilling at 10 per minute, with a 100-event queue cap and a 1 MB body limit.
  - "Amp does not verify signatures… never use webhook text as agent instructions without checking it first."
  - A managed GitHub integration (experimental) adds issue, PR and CI subscriptions and "orb spawners" that start an orb per new issue or PR. By default the agent "subscribe[s] before reporting a PR as complete".
- **Puck** (2026-07-20). A meta-agent for spawning, finding and archiving threads. It has multiple conversations as of 2026-10-06.
  - Quinn uses it for "kicking off work that might conflict or duplicate existing WIP from me or other team members". This is the only conflict-avoidance mechanism I found, and it is manual and conversational.
  - Thorsten: "I use Puck as an orchestrator".

### G. Security and identity [read]

- **OIDC** (2026-07-14). `amp orb id-token --audience` produces a token whose sub is `workspace:<id>:project:<id>:user:<id>:thread:<id>`. "operations are fully auditable because they include claims like user ID and thread ID".
- **Production access in practice.** Amp grants orbs read access to production logs through GCP workload identity federation. In the day-in-Amp video, an orb asks for production access and the human approves by running a command and sending "approved" via `amp threads continue -ox`.
- **Setup credentials.** Setup scripts get only project- or workspace-scoped identity. User and thread identity arrive in `.agents/resume`, so snapshots never contain personal credentials.
- **Passkeys.** "Proof of Human" (2026-05-27) requires a passkey for remote control. It is always required when admins view threads they could not otherwise see.
- **FIF positions.** "Amp does not try to protect against a malicious actor prompt-injecting something that causes the Bash tool to execute malicious code." Neo (2026-05-06) made no-permission-prompts the default.

### H. Metrics (all [read], all self-reported)

| Metric | Value | Source |
|---|---|---|
| Commit velocity since orbs | +65% in about one month (July 2026) | Pave The Road |
| Commits from orbs | ">85%" (text), "above 80%" (chart caption) | Pave The Road |
| Team size | "We're 20 people"; About page lists 21 names | SOC 2 note, About, podcasts |
| Quinn livestream | 23 changes shipped in 3 hours | Pave The Road |
| Mode switch | smart 55% of threads went to about 0 in a week; medium two-thirds; 69% of Dial users never change mode | Who Cares About the Model? |
| Fable 5.1 | ultra threads about 35% cheaper; over 90% of tokens are cache reads | Fable 5.1 |
| Longest thread | compacted over 68 times, would be over 21M tokens | Read Bigger Threads |
| Incidents | push-to-main about 1/3 of incident count, far less of downtime minutes and users affected | S2E4 podcast |
| Fleet perf | "fleet-wide slow tick dropped 44%" (internal) | Day in Amp video |
| Work location | Tim: about 75% of his work on the iPhone app; Camden: 80% macOS app | profiles |

---

## The end-to-end Amp workflow as a user experiences it [read, assembled]

1. **Intake.** A bug report arrives in Slack, Discord or email, or a GitHub issue fires an orb spawner. Someone mentions @Amp in Slack, asks Puck, or clicks New Thread on ampcode.com or the iOS or Mac app. Many prompts are dictated: Quinn dictates "90%" and Kemper "5-10 minutes" at a time. They pick a project, executor (New Orb or a runner) and Dial mode (low, medium, high or ultra). The Amp Way: "We Don't Keep a Backlog… When a bug report comes in, we start an orb for it right away."
2. **Spin-up.** Amp restores the project snapshot (up to 72 hours old) or runs setup, applies secrets and OIDC, runs `.agents/resume`, and starts the agent. The human closes the laptop.
3. **Work.** The agent edits, runs the dev server as a supervised service, drives agent-browser, and spawns sub-orbs for side quests or fan-out (for example, 4 tiny orbs for 4 screen sizes). Long runs are normal: Fable 5.1 "runs for hours on its own". Step-by-step output is collapsed (Less Noise, 2026-09-25): "If you have the patience to watch your agents work, you're giving them too short a leash."
4. **Proof.** The human asks for "irrefutable proof that this works", in Quinn's phrase, adopted by Thorsten. The agent returns screenshots, videos, test matrices, before-and-after timings, or a desktop recording. Fable 5.1 "goes back and fixes the work, then proves it again" when proof fails.
5. **Try it.** The human opens the Portal tab, clicks around, and drops element-anchored comments. Steering messages go to the agent at the next tool boundary. Teammates are @-mentioned into a multiplayer thread or a Space call. A portal may be made public for up to 7 days to collect outside feedback.
6. **Review, if any.** The human looks at diff size first (Kemper: "is this diff bigger than I expected"). Then intelligent ordering, Restack into logical commits, an oracle Review, `.agents/checks`, and spot-checks of "the most important files". Who skips review: Thorsten for "a lot of changes"; Quinn for low-blast-radius or visual changes. Who goes deeper: security changes (Will) and data-loss risk (Camden applies those by hand).
7. **Ship.** The human presses Ship (or Puck does, or another thread). The agent rebases, runs the full suite, pushes to main, and retries on races. The commit carries `Amp-Thread-ID`, is signed, and GitHub-enforced CI gates main.
8. **Land and verify.** The same thread sets an automation ("check every 15 minutes"), watches CI and deploy (`/_version`), reads production logs through OIDC, flips feature flags via a plugin, emails affected users, then archives itself.
9. **Afterwards.** The thread stays referenceable (`@T-…`, `read_thread`). `git log` links to it. Later threads mine it as company memory.

**What human role remains [read]:**
- choosing what to work on and setting the proof bar;
- architectural decisions ("I still make all of the architectural decisions", Kemper);
- blast-radius judgment (Karl: "Review changes with the largest blast radius. Just in case.");
- feel and taste in UI, animation and copy (Tim tunes animations "by hand" through agent-built controls);
- granting production access;
- writing prose ("We're allergic to LLM-written prose");
- data-loss operations (Camden);
- reading time-series and graphs ("surprisingly bad at identifying patterns which are obvious to humans", Camden).

The human is the dispatcher, the proof-demander and the final click on Ship. Tim runs "about 5 active threads at a time… at all times… merging them as they're ready."

---

## Pain points for agentic-scale development (as surfaced by Amp)

1. **Environment friction suppresses parallelism.** Thorsten: "it's friction that holds me back from creating new checkouts and worktrees". Quinn: "I had like five different worktrees… it was so messy." Orbs fixed this, and the volume of threads rose sharply [read].
2. **Review cannot keep up with volume.** Quinn on S2E5: "code review, in so many companies, it's a farce now. Nobody can review the volume of code". On S2E4: changes "are not full atomic changes… they're a lot more exploratory" [read].
3. **Agents need an environment that "assumes" them.** That means seeded users, magic login, deterministic dev-server state, one log file and many AGENTS.md files. Without them, agents "wiggle" by creating users or changing passwords [read].
4. **Long, compacted threads lose truth.** The first `read_thread` "answered from the first plausible hit… often an attempt that was later revised or reverted" [read].
5. **Thread content leaks secrets as agents read more.** This is the reason public threads ended [read].
6. **Landing races.** The default Ship loop re-rebases when "the base branch moved". Nothing coordinates concurrent threads beyond human or Puck awareness [read]. [inference] With 5 threads per human × 20 humans pushing to one main, collisions are tolerable. At 2,000 humans they would not be.
7. **Infrastructure reliability.** Durable agent execution, inference and sandboxes produced most outages. Sandbox providers differ: "Some can do memory snapshots, some can't, some can't even be resumed" (S2E4) [read].
8. **Quality entropy.** Camden: backcompat shims, unnecessary caching and dead code "add up over time and make it harder for Amp to operate smoothly". Will: models write jargon-dense summaries assuming "you also read everything it did" [read].
9. **Cognitive overload.** Quinn: "it is very overwhelming. It's like thrilling and addictive, but it's very overwhelming" [read].
10. **The fan-out ceiling.** 20 burst orbs, then 1 per 5 minutes, per user [read]. Webhook endpoints are capped at 10 events per minute [read].

## How Amp solves them

- **Isolation over permission.** One microVM per thread, snapshot-started, scale-to-zero. Pave the Road: "isolation over permission, quick reversibility rather than careful review, and parallelism instead of queues" [read].
- **Proof over diff-reading.** Proof is a prompt habit plus model capability (Fable 5.1). Portals and the comment widget turn review into "use the app". There is **no typed evidence object or policy engine**: proof lives as messages and attachments in the thread [read + inference].
- **Feature flags and rollout monitoring** as the main safety net. Thorsten: "They are really good at isolating changes with flags." Automations watch canaries [read].
- **CI as the only hard gate** ("Bad changes block main"), plus signed commits and thread links for audit [read].
- **Composable review agents** (`.agents/checks`, oracle) for when review is wanted [read].
- **Configurable Ship** for organisations that need PRs, merge queues or GitLab. Amp delegates landing to those systems rather than replacing them [read].
- **Threads as memory** (mentions, `read_thread`, Puck search) instead of an autonomous memory system [read].
- **Organisational design.** Small, all-co-founder, high-trust teams. For enterprises: "create small teams and give them the most leverage, you know, which is what we're doing with Amp Labs" (S2E5). Amp Labs is embedded at Westpac and is paid in warrants [read].

## Implications for a future forge

1. **[inference] Amp shows the thread-as-unit UX works.** Copy its pieces:
   - one URL per thread;
   - executor-independent viewing (web, phone, CLI);
   - a Changes pane with Restack and intelligent ordering;
   - portals with element-anchored comments delivered to the agent;
   - multiplayer;
   - schedules and webhooks on the thread;
   - commit trailers back to the thread.

   The forge does not need to reinvent these. It needs to make them **stored, queryable objects** rather than chat transcripts.
2. **[inference] Landing is the clear gap.** Amp's Ship is an LLM following a natural-language checklist. It has no atomicity, no batching and no awareness of concurrent threads. Conflicts are discovered at push time, and "checks with you" is the escalation. A forge landing service would:
   - accept (thread, intent, evidence);
   - rebase server-side;
   - run affected tests;
   - batch compatible changes;
   - wake the losing thread with the winner's intent.

   That directly upgrades Amp's loop. Amp's own Custom Ship examples ("a merge queue, a release script") admit the need for an external lander.
3. **[inference] Proof should be typed and pinned.** Amp's proof is a screenshot in a chat. A forge should store evidence bound to a commit and a pinned preview deployment, and evaluate policy over it. This answers the HN critique that there is no "evidence of change reviews" and gives auditors the "approved" leg that the SOC 2 note leaves to CI plus trust.
4. **[inference] Portals map closely to Workers Previews,** with three lessons:
   - **Authenticate by thread membership.** Inject identity headers (`X-Amp-Authenticated` is a good template).
   - **Inject a review widget** that sends DOM-anchored comments with a source location.
   - **Keep the URL stable while the backing deployment changes.** Amp portals point at a live dev server, so they are not pinned, which is a weakness for evidence. Cloudflare's deployment URL is better for proof and the branch preview URL is better for iteration. Offer both.
5. **[inference] Thread privacy needs its own design.** Amp removed public threads because agent context sweeps in sensitive files. A forge that publishes threads as provenance, for example to open-source contributors, needs redaction, retention controls and a "public summary" or "evidence-only" projection, not the raw log.
6. **[inference] Spawn and capacity governance belongs in the platform.** Amp's per-user pacing (20 burst, then 1 per 5 minutes) and webhook rate limits show the real constraint is shared compute. A forge should expose quotas per repo or team and queue rather than fail, as Amp does.
7. **[inference] Avoid double CI.** Thorsten's "CI is bonkers" argument applies: tests already ran in a clean, standardized sandbox. A forge could accept sandbox test results as attested evidence if the sandbox image and commit are pinned, and re-run only what the rebase invalidates.
8. **[inference] Identity per thread.** OIDC subjects that encode workspace, project, user and thread are the right primitive for "agents are principals acting for a named human". Adopt the same claim set.

## Contradictions and pushback

- **"Infinite orbs" vs pacing.** Marketing says "Orbs are infinite" and "There's no limit". The docs cap each user at a burst of 20 orbs, then one every 5 minutes [read].
- **Snapshot TTL.** The July note says 24 hours; the current docs and security page say 72 hours [read]. The brief's 24h is stale.
- **Handoff and fork churn.**
  - Handoff "No More Compaction" (2025-10) was then removed for compaction (2026-05). The Fork post's update line says "Four months after this was posted, we removed handoff" but is dated "2025-05-06", evidently a typo for 2026.
  - Yet the current Threads doc still recommends "Handoff and …".

  Thread-context primitives are unstable and get killed by design. "We're Constantly Killing Features" is item 09 of The Amp Way [read].
- **How much review actually happens varies by engineer.**
  - Thorsten: "for a lot of changes I don't read it at all".
  - Quinn: "very rare that I will ship something without reviewing the code".
  - Dario on HN: "We...just read the commits, and talk to each other" (post-push).
  - The Amp Way: "We Don't Have Mandatory PR Reviews". Note the word *mandatory*.

  The brief's "merge on proof not human diff-reading" is accurate as *policy*. In *practice* it is selective spot-checking [read].
- **HN pushback on SOC 2** (story 49308073, 52 points, 46 comments):
  - swiftcoder: "how are we demonstrating approval without any evidence of change reviews?"
  - matsemann: "the code change can just modify the same tests or verifications that will be run on it".
  - jpollock: "High trust is high trust until someone exploits it" ($250k embezzlement anecdote).
  - 6ty6thhDJEHDE: "easy for Amp Code to do but not so easy for other people".
  - Defenders: plorkyeran (CC8.1 "doesn't actually say much of anything"); m1keil ("in a 20 people startup… PRs stop no one").

  [secondary]
- **HN pushback on Orbs** (story 49437117, 116 points, 43 comments):
  - The product is "a thin wrapper over a remote virtual machine" (fwlr).
  - It is "an increasingly-commodity experience", alongside Cursor Cloud Agents, Devin, Codex cloud and Claude Code on the web (fishtoaster, iainmerrick, josevalerio).
  - "big labs… have more money to burn" (aarondong).
  - Counterpoint from user altschuler: "the real value lies in just how easy it is to use and the surrounding functionality".
  - dbmikus lists the hard parts: snapshot refresh, lifetime extension on interaction, OAuth refresh, inter-VM comms.

  [secondary]
- **Reliability.** Amp concedes recent outages (S2E4) while advocating push-to-main. It argues the outages mostly came from infrastructure, not code pushes [read]. That is self-assessed, and the incident counts behind "a third" are not published.
- **runtimewire coverage** (2026-08-15) says the policy "would make many security teams recoil" and offers no independent verification [secondary].

## Open questions

1. What CI does Amp run, and how long does a full-suite run take in the Ship loop? Is the full suite rerun after each rebase retry? Not published. [gap]
2. How often does Ship hit a rebase conflict or push race at Amp's volume? Are there retries, abandoned ships, or reverts per day? No numbers. [gap]
3. Does Amp revert on main or roll forward? Feature flags are emphasised; no revert tooling post was found. [gap]
4. What exactly is the "agentic CI/CD" Kemper says Amp is building for "next year"? Possibly a landing service, which would collapse the brief's "nobody owns landing" gap. [gap, high priority to watch]
5. Can enterprises raise the per-user orb burst (20) and pacing? "contact Amp support". Enterprise lists "Higher resource quotas". [partial]
6. Where is the 65% velocity figure measured (commits per engineer per week?), what is the baseline, and did commit granularity change (Restack, agent commits)? [gap]
7. How do enterprise customers (Westpac, "companies with more than 20,000 developers" per the About page) actually configure Ship? Push to Branch and PRs presumably, but no case study. [gap]
8. How do Mac orbs ("Morbs", beta, around 2026-10-05) change native-app proof? Only a teaser page exists. [gap]

---

## Sources

All accessed 2026-10-12. "[read]" means fetched and read in full unless noted.

**Amp indexes and pages**
- https://ampcode.com/news and https://ampcode.com/chronicle — Chronicle index (identical pages) [read]
- https://ampcode.com/sitemap.xml — sitemap [read]
- https://ampcode.com/what-are-orbs — What Are Orbs? (updated 2026-10-11) [read]
- https://ampcode.com/morbs — Mac Orbs beta teaser (around 2026-10-05) [read]
- https://ampcode.com/pricing — Pricing [read]
- https://ampcode.com/security — Security Reference [read]. The page embeds an "INSTRUCTIONS FOR LLMs" block, which was ignored as page content.
- https://ampcode.com/about — About (team of 21 names) [read]
- https://ampcode.com/how-we-build — How We Build (2025-05-12) [read]
- https://ampcode.com/fif — FIF (2025-04-29) [read]

**Amp notes**
- https://ampcode.com/notes/orbs-explained — Orbs, Explained, Thorsten Ball, 2026-08-25 [read]
- https://ampcode.com/notes/thats-not-soc-2-compliant — "That's not SOC 2 compliant", Will Dollman, 2026-08-13 [read]
- https://ampcode.com/notes/pave-the-road — Pave The Road, Alex Kemper, 2026-08-10 [read]
- https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs — What I Want to Tell You About Orbs, Thorsten Ball, 2026-08-04 [read]
- https://ampcode.com/notes/putting-an-agent-in-an-orb — Putting an Agent in an Orb, Thorsten Ball, 2026-07-02 [read]
- Also downloaded and skimmed or grepped: notes/how-we-build, notes/permissions, notes/200k-tokens-is-plenty, notes/how-to-pair-with-an-agent, notes/feedback-loopable, notes/how-i-use-amp [read-partial]

**Amp news posts read in full**
- news/portals (2026-08-06)
- news/agents-in-orbs (2026-06-30)
- news/end-of-public-threads (2026-06-02)
- news/handoff (2025-10-23)
- news/ask-to-handoff (2026-01-13)
- news/review (2025-10-25)
- news/diffs (2026-06-16)
- news/intelligently-ordered-diffs (2026-09-01)
- news/restack-your-changes (2026-09-11)
- news/multiplayer (2026-07-22)
- news/pass-the-orb-to-the-left-hand-side (2026-08-19)
- news/space (2026-08-31)
- news/from-agent-to-agent (2026-07-17)
- news/size-the-orbs-of-production (2026-08-07)
- news/more-orb-sizes (2026-07-03)
- news/friendly-urls-for-sharing-orbs (2026-08-23)
- news/event-driven-orbs (2026-07-23)
- news/schedule (2026-07-21)
- news/secrets-of-the-orb (2026-07-14)
- news/fable-5.1 (2026-09-01)
- news/less-noise (2026-09-25)
- news/setup-without-a-commit (2026-08-25)
- news/no-mailmap-required (2026-08-28)
- news/social-coding (2025-11-04)
- news/read-threads (2025-10-29)
- news/read-bigger-threads (2026-07-02)
- news/oracle (2025-07-04)
- news/gpt-5-oracle (2025-10-01)
- news/agentic-code-review (2025-12-18)
- news/liberating-code-review (2026-02-04)
- news/the-coding-agent-is-dead (2026-02-19)
- news/neo "Amp, Rebuilt" (2026-05-06)
- news/agents-everywhere (2026-06-04)
- news/agents-anywhere (2026-07-08)
- news/steer-dont-queue (2026-09-08)
- news/desktop (2026-09-04)
- news/meet-puck (2026-07-20)
- news/many-many-pucks (2026-10-06)
- news/shared-runners (2026-09-24)
- news/one-runner-is-now-enough (2026-09-17)
- news/one-runner-many-worktrees (2026-09-22)
- news/amp-labs (2026-05-21)
- news/amp-labs-westpac (2026-07-29)
- news/who-cares-about-the-model (2026-07-29)
- news/proof-of-human (2026-05-27)
- news/free-agent (2026-09-13)
- news/subscriptions (2026-07-18)
- news/amp-frontier-corporation (2025-12-02)
- news/thread-map (2025-12-11)
- news/stick-a-fork-in-it (2026-01-13)
- news/multi-repo-projects (2026-08-27)

All are at https://ampcode.com/news/…, all [read]. About 40 further news posts were downloaded and grepped.

**Amp docs**
- docs/orbs, docs/orbs/getting-started, docs/orbs/customizing, docs/orbs/shipping (updated 2026-10-07), docs/orbs/sizes-and-costs, docs/orbs/portals (2026-10-04), docs/orbs/agent-to-agent, docs/orbs/automations, docs/orbs/event-driven, docs/threads, docs/github, docs/pricing, docs/collaborate/multiplayer, docs/collaborate/space, docs/models-and-subagents, docs/enterprise/workspace-thread-visibility-controls, docs/using-amp, docs/using-amp/how-we-work ("The Amp Way"), docs/using-amp/a-day-in-amp (transcript, 2026-09-22) [read]
- Partial or grepped: docs/cli/runners, docs/orbs/handling-secrets, docs/orbs/desktop, docs/cli/spawning-orbs, docs/the-dial [read-partial]
- Team profiles: docs/using-amp/thorsten, quinn, tim, camden, beyang, kemper, will, karl [read]. Others downloaded.
- Time capsules: time-capsules/1 (Quinn, 2026-07-27), /2 (2026-07-28), /3 (Thorsten, 2026-08-11), /4 (Brett, 2026-09-15) [read]
- Podcast Season 2: podcast/season-02/episode-01 (2026-07-17), -04 (2026-09-11) and -05 (2026-09-25) [read-grepped transcripts]; -02 and -03 [grepped]

**Secondary**
- https://news.ycombinator.com/item?id=49308073 (via hn.algolia.com API) — HN: "That's not SOC 2 compliant", 52 points, 2026-08-15 [read]
- https://news.ycombinator.com/item?id=49437117 (via API) — HN: "Orbs", 116 points, 2026-08-25 [read]
- https://zeli.app/en/story/49308073 — HN summary page [read]
- https://runtimewire.com/article/amp-soc-2-without-pull-requests — "Amp holds SOC 2 Type II without requiring pull requests", 2026-08-15 [read]
- WebSearch results (verdent.ai guides, toolquestor) — snippets only, not relied on [secondary]

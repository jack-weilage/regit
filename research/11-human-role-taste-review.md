# 11: The human role when agents write the code. Taste, review, live previews and proof

Researcher key: `11-human-role-taste-review`. Written 2026-10-12.
Hypothesis under test: when agents write most of the code, human input moves to tastemaking (choosing an approach, judging what looks good), and review happens through live previews (like Amp portals) and shared threads instead of pull requests.

Tags: **[read]** means verified on a page I opened. **[secondary]** means it comes from search snippets or coverage that I did not verify at the primary source. **[inference]** is my own reasoning.

Method note: the shared web-search budget ran out partway through. After that, every source came from fetching known primary URLs directly. OpenAI's "Harness engineering" post returned HTTP 403 to every fetch method, so the brief's OpenAI claims are still **unverified** here.

---

## Summary

1. **The hypothesis is half right.** The sources clearly support "taste" as the last thing humans keep. They do not support "previews are enough to review." The taste that practitioners say they cannot hand off is often engineering taste (invariants, abstractions, what belongs in core). A running preview cannot show that. [inference, built on the items below]
2. **Practitioners name taste directly as the residual human job.** Steve Yegge, who maintains Beads and Gas Town at about 50 contributor PRs a day and says 99% are AI-generated, writes that "the last 25% or so of pull requests need human review... because there's still a thing called taste that current models can't be trusted with." He spends 15 to 20 hours a week on PRs even with AI help. [read]
3. **Anthropic's study of its own engineers finds the same split.** Engineers "consistently keep high-level thinking, design, and 'taste' tasks." One engineer's work had shifted "70%+ to being a code reviewer/reviser." Another expects to take "accountability for the work of 1, 5, or 100 Claudes." The report also names a **"paradox of supervision"**: supervising Claude takes the skills that heavy Claude use erodes. [read]
4. **Karpathy's primary transcript supports visual verification.** "Usually they are doing the generation and we as humans are doing the verification... GUIs... utilize your computer vision GPU... Reading text is effortful... looking at stuff is fun." He also says "it's not useful to me to get a diff of 10,000 lines... I'm still the bottleneck." [read, YC transcript]
5. **Amp portals are real and already used for taste-level iteration.** A portal exposes any HTTP service in an orb. Anyone with access to the thread can reach it, and comments made on the page go straight back to the agent. Thorsten Ball's recorded session is pure tastemaking: rewording warning copy, choosing background images, asking "What is your favorite background?" Portals are live dev servers, though, not pinned deployments: "no waiting for preview deployments." [read]
6. **Proof-of-work artifacts are now a product feature at several vendors.** Cursor (Feb 24, 2026) says cloud agents "produce merge-ready PRs with artifacts to demo their changes" (videos, screenshots, logs), and that "more than 30% of the PRs we merge at Cursor" come from autonomous cloud agents. Amp's Fable 5.1 post shows hours-long runs that produce before/after videos, such as typing latency dropping from 85 ms to 8 ms. Vercel has offered free comments on every preview deployment for years. [read]
7. **Even Amp hedges on "proof replaces reading."** Its June 16, 2026 Diffs launch says: "Outsource your coding, but not your understanding of the code. As agents generate larger quantities of code, it is more important than ever for humans to comprehend the code." Amp also ships intelligently ordered diffs and a review agent with per-directory `.agents/checks/`. [read]
8. **Review is the measured bottleneck, and it is getting worse.** Faros 2026 (22,000 developers, 4,000+ teams) reports median time in PR review up 441.5%, time to first review up 156.6%, PRs merged with no review at all up 31.3%, incidents per PR up 242.7%, and bugs per developer up 54%. The 2025 edition had PR review time up 91% and PR size up 154%. LinearB (8.1M PRs) finds AI PRs wait 4.6x longer before review and are accepted 32.7% of the time, against 84.4% for manual PRs. [read]
9. **AI-written code has more defects, and more of them are the kind a preview does not show.** CodeRabbit's analysis of 470 PRs found 10.83 issues per AI PR against 6.45 for human PRs (about 1.7x). Readability issues were more than 3x, security issues up to 2.74x, and excessive I/O about 8x. Devin's own 2025 review concedes: "Human review is still necessary, because code quality is not straightforwardly verifiable." [read]
10. **Comprehension and cognitive debt are now named, studied concerns.** Anthropic's RCT (n=52) found AI-assisted learners scored 50% against 67% for the control group, with the biggest gap on **debugging**. Storey's Triple Debt Model (arXiv, Mar 2026) adds cognitive debt (in people) and intent debt (in artifacts) to technical debt, and recommends that "at least one human on the team fully understands each AI-generated change before it ships." [read]
11. **The strongest dissent comes from Armin Ronacher ("The Coming Loop", Jun 23, 2026).** He finds that hands-off loops amplify defensive, overly local code. He writes that "Better visualizations of changes or orchestration or agents will not restore our understanding," and that in harness-driven loops "my role is reduced to that of a messenger." He sees loops as fine for porting, performance search, security scanning and research, but not yet for code that has to last. [read]
12. **A second human role is emerging next to taste: harness engineering.** Hashimoto: "anytime you find an agent makes a mistake, you... engineer a solution such that the agent never makes that mistake again." Huntley's Ralph has the human "tune" the loop "like a guitar" and post "signs." Amp's `.agents/checks` turns review criteria into code. Fowler and Ajey Gore argue that the human job becomes "designing verification systems, defining quality." [read]
13. **Human attention is the limiting resource, and it costs something.** Hashimoto turns off agent notifications ("it was my job as a human to be in control of when I interrupt the agent"). Yegge's "AI Vampire" describes daily exhaustion. In Gas City, "you, the human, are the control plane... you will start to become the bottleneck." [read]
14. **Accountability and compliance can be met without human diff review at small scale, by Amp's own account.** SOC 2 asks that changes be "authorized, tested, approved, and recorded," and "code review isn't on the list." Amp says this fits its 20 people, not a 2,000-person company. Open-source maintainers push the other way: Ghostty requires that "the human-in-the-loop must fully understand all code," and Mitchell Hashimoto is moving Ghostty off GitHub because of daily outages. [read]
15. **Implication for the forge:** treat taste and understanding as two separate review surfaces. Taste gets live and pinned previews with comments routed to the thread, plus side-by-side comparison of candidate approaches. Understanding gets walkthroughs, intent records, invariant checks, and a per-path rule on how much human comprehension is required. Merging on proof should cover the first and must not pretend to cover the second. [inference]

---

## Detailed findings

### A. The baseline: what code review was for (Google)

- **Google's code review study** (Sadowski et al., ICSE-SEIP 2018) used 12 interviews, 44 survey responses, and logs for 9 million reviewed changes. Developers expect four things from review: **"education, maintaining norms, gatekeeping, and accident prevention"**. "Defect finding is welcomed but not the only focus." Review at Google is tied to **ownership** and **readability** certification. [read] https://sback.it/publications/icse2018seip.pdf
  - Numbers: the median developer authors about 3 changes a week and reviews 4. The median wait for first feedback is under an hour for small changes and about 5 hours for very large ones. Overall median review latency is under 4 hours. Over 35% of changes touch one file, about 90% touch fewer than 10 files, and the median change is **24 lines**. Developers average **3.2 hours a week** (median 2.6) reviewing. [read]
  - Forge implication: review historically did two jobs. One was quality gating; the other was **spreading knowledge (education)**. Previews and proof can replace parts of the first. Nothing in the hypothesis replaces the second, and losing it is how cognitive debt builds up (section F). [inference]
- **Google's ML-resolved review comments** (DIDACT). Authors spend about 60 minutes of active shepherding per change, and that time "grows almost linearly with the number of comments." The model handles 52% of comments at a target precision of 50%, and 40 to 50% of previewed suggested edits get applied. Google expects this to save "hundreds of thousands of hours annually." [read] https://research.google/blog/resolving-code-review-comments-with-ml/
  - Forge implication: one well-established pattern is that **a human writes the comment and an agent applies it**. Amp portal comments follow this pattern on a running UI instead of a diff. [inference]

### B. The review bottleneck under AI, measured

- **Faros AI, "AI Productivity Paradox"** (published Jul 23, 2025; data as of Jun 2025; 10,000+ developers, 1,255 teams). High-adoption teams complete 21% more tasks and merge 98% more PRs, but **PR review time is up 91%**, average PR size is up 154%, and bugs per developer are up 9%. [read] https://www.faros.ai/blog/ai-software-engineering
- **Faros AI, "AI Engineering Report 2026: The Acceleration Whiplash"** (Apr 12, 2026; 22,000 developers, 4,000+ teams; compares each org's lowest and highest AI-adoption periods). [read] https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways
  - Code acceptance rose from 20% to 60%. Epics per developer are up 66%, task throughput up 33.7%, PR merge rate up 16.2%.
  - **Median time to first review up 156.6%, average time in review up 199.6%, median time in review up 441.5%.**
  - **"Pull requests merged without any review, human or agentic, are up 31.3%."**
  - Incidents per PR up 242.7%, monthly incidents up 57.9%, bugs per developer up 54%, the deleted-to-added lines ratio up 861%.
  - "AI made it easy to start work. It did not make it easy to finish it." Daily PR contexts per developer are up 67.4%, and work restarts are up 13.8%.
  - Caveat: this is vendor telemetry and correlational, not a controlled study. [read]
- **LinearB 2026 Software Engineering Benchmarks** (8.1M+ PRs, 4,800+ orgs). "AI PRs wait **4.6x longer** before review, but are reviewed **2x faster** once picked up." Acceptance rate for AI-generated PRs is **32.7% against 84.4%** for manual PRs. Bot acceptance varies by tool ("Devin's rising since April and Copilot's slipping since May"). [read, landing page only; full report gated] https://linearb.io/resources/software-engineering-benchmarks-report
  - Forge implication: queue time dominates, not review time. Reviewers put off AI PRs. A forge that pushes the review moment toward a running preview with proof attached, and makes it something you can triage from a phone, attacks the 4.6x wait directly. [inference]
- **Greptile, State of AI Coding (updated Q2 2026)**: "median PR size grew 79% and lines of code per developer grew 3.5x in a single year"; CLAUDE.md files are in "80% of orgs." [read, landing page; report gated] https://www.greptile.com/state-of-ai-coding-2025
- **CodeRabbit, "State of AI vs Human Code Generation"** (Dec 17, 2025; 470 OSS PRs, 320 AI-co-authored and 150 human-only; authorship inferred). 10.83 against 6.45 issues per PR. Logic and correctness issues +75%. Error handling gaps nearly 2x. Concurrency about 2x. **Readability >3x** ("the single biggest difference"). **Security up to 2.74x**. Excessive I/O about 8x. CodeRabbit sells AI review, which is a conflict of interest. [read] https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report
  - Forge implication: almost none of these categories show up in a UI preview. Error paths, concurrency, I/O amplification, credential handling and readability are invisible when you click through an app. [inference]
- **METR.** The early-2025 RCT (16 experienced OSS developers, 246 issues) found AI made developers **19% slower**. The Feb 24, 2026 follow-up says the design no longer works: developers refuse to work without AI, and 30 to 50% withhold tasks. Raw estimates now suggest speedup (−18% time for returning developers, CI −38% to +9%), but METR calls that "very weak evidence." METR's May 2026 survey of 349 technical workers gives a median self-reported **1.4 to 2x value change** and 3x speed change. Earlier work found people overestimate AI's effect on time by about 40 percentage points. [read] https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ ; https://metr.org/blog/2026-02-24-uplift-update/ ; https://metr.org/blog/2026-05-11-ai-usage-survey/
  - METR also notes that time measurement is "unreliable for the fraction of developers who use multiple AI agents concurrently." Parallel agent work breaks the old per-task productivity model. [read]

### C. "Taste" as the residual human job: direct evidence

- **Steve Yegge, "Vibe Maintainer"** (Mar 31, 2026). He runs about 50 contributor PRs a day across Beads (20k stars) and Gas Town (13k stars), with 1,000+ contributors, 4k+ PRs (2,300+ merged) and 15k+ commits. **99% of incoming PRs are AI-assisted.** Median time to resolution is about 15 hours. He merges about 88% "one way or another." Even with AI it takes him **15 to 20 hours a week**. [read] https://steve-yegge.medium.com/vibe-maintainer-a2273a841040
  - Workflow: a "PR Sheriff" agent (the Mayor) sorts open PRs into easy-wins, fix-merge and needs-review. Easy wins are patrolled automatically every 2 hours. Needs-review PRs get an agent deep-dive report. The outcomes are: easy win, merge, merge-fix, fix-merge, cherry-pick, split-merge, redesign/reimplement, retire, reject, and **request changes as a last resort**, because it "quickly leads to contributor starvation." [read]
  - The quote on taste: Claude evaluates a PR that adds "a face-hugging alien to each worker" and calls it "well-constructed... with good test coverage." Yegge: "And that's why the last 25% or so of pull requests need human review... there's still a thing called **taste** that current models can't be trusted with. Not yet." [read]
  - "The last 5–10% of the PRs... are usually hefty features... that last 5% to 10% is the part that takes hours a day." "If the agent can't justify the PR, then it's probably not worth taking yet." [read]
  - He also says "mostly only agents have ever seen their source code. I certainly haven't." [read]
  - Forge implication: here "taste" means **scope, product fit and architecture boundaries** ("Beads must not know about Gas Town", "Use plugins whenever possible"). It is decided by questioning the agent about the PR, not by looking at a UI. The forge's human surface should support "interrogate the thread" and one-click resolutions (fix-merge, split-merge, cherry-pick with attribution), not just approve or reject. [inference]
- **Anthropic, "How AI is transforming work at Anthropic"** (Dec 2, 2025; 132 surveyed, 53 interviewed, 200k Claude Code transcripts). [read] https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic
  - "I usually keep the high-level thinking and design." Engineers keep "taste" tasks that need organizational context, and they call the boundary a "moving target."
  - More than half can "fully delegate" only 0 to 20% of their work. They delegate tasks that are "easy to verify" ("can relatively easily sniff-check on correctness").
  - "70%+ to being a code reviewer/reviser rather than a net-new code writer." "Taking accountability for the work of 1, 5, or 100 Claudes."
  - **Paradox of supervision**: effective supervision takes coding skills that may atrophy.
  - A security engineer described a Claude solution as "really smart in the dangerous way."
  - Usage: Claude in about 59% of work (up from 28%). Consecutive tool calls went from 9.8 to 21.2. Human turns went from 6.2 to 4.1 (−33%).
- **Cursor, "Cursor agents can now control their own computers"** (Feb 24, 2026): "the role of a developer is more about **setting direction and deciding what ships**." [read] https://cursor.com/blog/agent-computer-use
- **Yegge, "Welcome to Gas City"** (Apr 24, 2026): "devs will become **shepherds**, tending flocks of agents... They don't need management. But they need guidance." At "Level 10... you, the human, are the control plane... you will start to become the bottleneck on curating them." At Level 11 you operate "at the level of architect, curator, and shepherd." "Reliability, friends, is a dial... More rounds of review, more backstops, more guardrails, more judges." He would not use it "where you could physically hurt people... Not in 2026." [read] https://steve-yegge.medium.com/welcome-to-gas-city-57f564bb3607
- **Yegge, "Revenge of the junior developer"** (Mar 22, 2025): predicted fleets by early 2026 in which supervisor agents bring in the human "only when agents get really stuck." "The human is removed as the bottleneck for 90-99% of the work." [read] https://sourcegraph.com/blog/revenge-of-the-junior-developer
- **Kent Beck, "Augmented Coding: Beyond the Vibes"** (Jun 25, 2025). "In vibe coding you don't care about the code, just the behavior of the system... In augmented coding you care about the code, its complexity, the tests, & their coverage." On his B+ tree result: "I feel good about the correctness & performance, **not so good about the code quality**... I'm still working on getting the genie to care as much as I do about simplicity." His warning signs: loops, unrequested functionality, "cheating, for example by disabling or deleting tests." [read] https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes
  - Beck's Feb 6, 2026 "Is Source Code Going Away?" is paywalled; I read only the opening line. [read, partial]
  - Forge implication: Beck's "taste" is **code-structure taste**, which behaviour-level proof cannot show. [inference]

### D. Live previews, portals and proof artifacts as the review medium

- **Amp, "Portals into Orbs"** (Aug 6, 2026): portals "let you access anything running in an orb that listens on a port and speaks HTTP. All you need to do is ask Amp: show me in a portal." You can "annotate and comment on anything." "Portals are accessible to anyone with access to the thread. They go to sleep and wake along with your orb." With multiplayer turned on, teammates "can also make changes and see them live in the portal." The mechanics: the agent creates `.amp/services.yaml` and runs `amp orb services <ensure|start>`, and the app must respect `PORT` and `PUBLIC_URL`. Amp recommends a dev sign-in bypass URL (`/__dev/log-me-in/{email}?returnTo={path}`) for both humans and agents. The pitch includes "no waiting for preview deployments." [read] https://ampcode.com/news/portals
  - **Verifying the brief:** "live previews called portals that can be annotated" is **confirmed**. One nuance: a portal is a live, live-reloading dev server inside the orb, so it is **mutable**. It is not a pinned, immutable deployment and cannot serve as durable evidence on its own. The brief's design, where evidence points at a pinned Workers deployment URL, fills a real gap. [read + inference]
- **Amp Time Capsule 3, "Iterating With Agents in Orbs Using Portals"** (Thorsten Ball, Aug 11, 2026; transcript). Thorsten asks the agent to "give me a storybook in an orb that shows all of the copy for all of these warnings," reviews it in a portal, and comments directly on the page ("comment on stuff, which is better than annotating screenshots, or more token efficient"). He then asks for a "debug toggle" to compare background images and says "I don't like the hierarchy of this." He ends with "What is your favorite background? Let me know." He then holds the Ship button. [read] https://ampcode.com/time-capsules/3
  - **This is the clearest primary evidence for the tastemaking hypothesis.** The human's inputs are wording, visual hierarchy and choosing among variants. The agent builds the scaffolding needed to make the choice (a storybook, a debug toggle). [inference]
  - Forge implication: the **"ask the agent to build a comparison surface" pattern** (storybook, variant toggle) should be a first-class, cheap feature. Side-by-side preview of N candidate threads is the forge version. [inference]
- **Amp, "What I Want to Tell You About Orbs"** (Thorsten Ball, Aug 4, 2026): "I tell the agent in the orb: 'I want you to give me 100% proof that what you did works. Test this end to end... Run through a matrix of test cases. Show me a screenshot, a video... Dazzle me.'" The agent "runs for eight, ten, twenty, sometimes thirty minutes." "A mountain of code, but proof that it works... It changes things, massively." He describes "a lighter, less sigh-inducing review load." [read] https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs — **The brief's claim is confirmed.**
- **Amp, Fable 5.1** (Sep 1, 2026). A typing-latency investigation ran two hours and produced a "side-by-side video of the old and new builds... caught a two-pixel height difference in its own comparison, corrected it, and re-recorded." Latency went from **85 ms to 8 ms**. Thread creation got **45% faster**. Advice: "Tell it what done looks like, and how to prove it." [read] https://ampcode.com/news/fable-5.1
- **Amp, Desktop** (Sep 4, 2026): an interactive Linux desktop in each orb, "useful for verifying the agent's work" for Linux, Android, Chrome extensions, and documents such as .docx checked in LibreOffice. [read] https://ampcode.com/news/desktop
- **Cursor, cloud agents with computer use** (Feb 24, 2026): agents "produce merge-ready PRs with artifacts to demo their changes" (video, screenshots, logs). Examples include a recorded clipboard-theft vulnerability reproduction and a 45-minute docs-site walkthrough. "You can also control the agent's remote desktop to use the modified software... without checking out the branch locally." "More than 30% of the PRs we merge at Cursor are now created by agents operating autonomously in cloud sandboxes." (Coverage claimed 35%; the primary page says 30%.) [read] https://cursor.com/blog/agent-computer-use
- **Vercel Comments**: "Comments allow teams and invited participants to give direct feedback on preview deployments... Comments can be added to any part of the UI, opening discussion threads that can be linked to Slack threads... enabled by default on all preview deployments, for all account plans, free of charge." PR owners receive emails. All commenters need a Vercel account. [read] https://vercel.com/docs/comments
  - Forge implication: commenting on a preview is a solved UX in the human-to-human setting. What is new in Amp is routing those comments **to the agent** as steering input. [inference]
- **Karpathy, "Software Is Changing (Again)"** (YC AI Startup School, Jun 2025; transcript on YC's page). "We're now kind of like cooperating with AIs, and usually they are doing the generation and we as humans are doing the verification. It is in our interest to make this loop go as fast as possible." "GUIs... utilize your computer vision GPU... Reading text is effortful and it's not fun, but looking at stuff is fun... a highway to your brain." "Keep the AI on the leash... it's not useful to me to get a diff of 10,000 lines of code to my repo... I'm still the bottleneck." "In my own work, I'm always scared to get way too big diffs. I always go in small incremental chunks." He also offers an "autonomy slider" and "intermediate artifact... that is auditable" (his course example). He asks: "what does a diff look like in Photoshop?" [read] https://www.ycombinator.com/library/MW-andrej-karpathy-software-is-changing-again
  - Karpathy supports **visual verification** but argues **against** large autonomous changes. His remedy is smaller chunks, not better proof. In the forge context these pull in different directions. [inference]
  - Latent Space's write-up paraphrases the talk ("To improve verification: Make it easy, fast to win"). It is secondary to the transcript. [read] https://www.latent.space/p/s3

### E. "Prove it works" as the author's duty (Willison)

- **"Vibe engineering"** (Oct 7, 2025): engineers stay accountable. "AI tools amplify existing expertise." "If you're fast and productive at code review you're going to have a much better time." "Beyond automated tests, you need to be really good at manually testing software." **Preview environments** let you check agent work safely before production. Agents are "a growing army of weird digital interns who will absolutely cheat if you give them a chance." [read] https://simonwillison.net/2025/Oct/7/vibe-engineering/
- **"Your job is to deliver code you have proven to work"** (Dec 18, 2025): "If you haven't seen the code do the right thing yourself, that code doesn't work." Paste terminal output, or record a screen capture, into the PR. A test "should fail if you revert the implementation." For agents, "automated tests and manual tests are effectively the same thing." [read] https://simonwillison.net/2025/Dec/18/code-proven-to-work/
- **Agentic Engineering Patterns guide** (2026): [read] https://simonwillison.net/guides/agentic-engineering-patterns/
  - Anti-pattern "Inflicting unreviewed code on collaborators": "Don't file pull requests with code you haven't reviewed yourself... you are delegating the actual work to other people. They could have prompted an agent themselves." Include "screenshots and video of the feature working." [read] https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/
  - "Agentic manual testing": "Never assume that code generated by an LLM works until that code has been executed." He uses `python -c`, curl against a dev server, Playwright, Vercel's `agent-browser`, and his own Rodney ("look at screenshots to confirm"). [read] https://simonwillison.net/guides/agentic-engineering-patterns/agentic-manual-testing/
  - "Linear walkthroughs": Showboat makes an agent write a walkthrough in which code snippets come from executed `sed`/`grep`/`cat` and are not copied by hand ("could introduce a risk of hallucinations"). He presents it as an antidote to skill loss: "If you are concerned that LLMs might reduce the speed at which you learn new skills I strongly recommend adopting patterns like this one." [read] https://simonwillison.net/guides/agentic-engineering-patterns/linear-walkthroughs/
  - Forge implication: **two kinds of evidence**. *Behaviour proof* (screenshots, video, curl logs) answers "does it work?" *Comprehension artifacts* (executed walkthroughs, annotated diffs) answer "do we understand it?" A thread should store both, and both should be generated from execution so they cannot be hallucinated. [inference]

### F. Cognitive, comprehension and intent debt

- **Addy Osmani, "Comprehension Debt"** (Mar 14, 2026): "the growing gap between how much code exists in your system and how much of it any human being genuinely understands." "What used to be a quality gate is now a throughput problem." "Tests are necessary. They are not sufficient." Specs are incomplete: "A spec detailed enough to fully govern behavior approaches the program itself." In regulated domains, "the AI wrote it" will not hold up after an incident. "Making code cheap to generate doesn't make understanding cheap to skip." [read] https://addyosmani.com/blog/comprehension-debt/
- **Anthropic, "How AI assistance impacts the formation of coding skills"** (Jan 29, 2026; RCT, n=52, mostly junior developers learning Trio). The AI group scored **50% against 67%** (Cohen's d = 0.738, p = 0.01). The speed gain of about 2 minutes was **not significant**. "The largest gap in scores... was on **debugging** questions." Patterns that kept learning intact were generation-then-comprehension, hybrid code plus explanation, and conceptual inquiry. Productivity gains "may come at the cost of skills necessary to validate AI-written code." [read] https://www.anthropic.com/research/AI-assistance-coding-skills
- **Margaret-Anne Storey, "Cognitive debt"** (Feb 9, 2026): a student team stalled in weeks 7 to 8 because "no one on the team could explain why certain design decisions had been made." The warning signs are hesitation to change code, "tribal knowledge" held by one or two people, and a sense that the system is "becoming a black box." Her recommendation: "**at least one human on the team fully understands each AI-generated change before it ships**." Record "not just what changed but why." "Velocity without understanding is not sustainable." [read] https://margaretstorey.com/blog/2026/02/09/cognitive-debt/
- **Storey, "From Technical Debt to Cognitive and Intent Debt"** (arXiv 2603.22106, v1 Mar 23, v4 Apr 6, 2026): the Triple Debt Model. *Intent debt* is "the absence or erosion of explicit rationale, goals, and constraints that guide how humans and agents evolve the system." [read] https://arxiv.org/abs/2603.22106
- **Martin Fowler, Fragments: April 2, 2026**: summarizes Storey and Shaw & Nave's "System 3" (AI). *Cognitive surrender* means "uncritical reliance on externally generated artificial reasoning," as distinct from *cognitive offloading*. He quotes Ajey Gore: "If agents handle execution, the human job becomes designing verification systems, defining quality, and handling the ambiguous cases agents can't resolve... ten engineers... now has three engineers and seven people defining acceptance criteria." Fowler: we need "ways to make it easier for humans to comprehend larger ranges of tests." [read] https://martinfowler.com/fragments/2026-04-02.html
- Forge implication: **intent debt is the debt a thread-native forge can pay down by construction.** The thread already holds the stated intent, the conversation and the rationale. Keeping it attached to the lines it produced turns "why" into something you can query. Cognitive debt (in people) is not solved by storing threads. It needs deliberate surfaces that build understanding. [inference]

### G. Harness engineering and loops: the human as system designer

- **Mitchell Hashimoto, "My AI Adoption Journey"** (Feb 5, 2026). The steps: drop the chatbot, reproduce your own work, end-of-day agents, outsource the slam dunks, **engineer the harness**, always have an agent running. [read] https://mitchellh.com/writing/my-ai-adoption-journey
  - "If you give an agent a way to verify its work, it more often than not fixes its own mistakes."
  - "Turn off agent desktop notifications... it was my job as a human to be in control of when I interrupt the agent, not the other way around."
  - Delegating some tasks while doing others by hand counteracts the skill-formation finding: "you're trading off: not forming skills for the tasks you're delegating."
  - Harness engineering: "anytime you find an agent makes a mistake, you take the time to engineer a solution such that the agent never makes that mistake again." This takes the form of AGENTS.md lines ("Each line in that file is based on a bad agent behavior") and programmed tools such as screenshot scripts and filtered test runs.
  - He has a background agent running only "10 to 20% of a normal working day" and is "not [yet?] running multiple agents."
  - He used agents for issue and PR triage, but "I would NOT allow agents to respond."
- **Geoffrey Huntley, "Ralph"** (Jul 14, 2025): `while :; do cat PROMPT.md | claude-code ; done`. Tests, type checkers and static analysis provide "back pressure." The human writes specs, tunes ("Ralph gets tuned - like a guitar"), adds "signs" to the prompt, watches, and decides whether to `git reset --hard`. "Engineers are still needed." Ralph is best for greenfield work and not advised for existing codebases. [read] https://ghuntley.com/ralph/
- **Amp, "Liberating Code Review"** (Feb 4, 2026): the review agent is "decoupled... from any UI" (`amp review`, or a natural-language request inside a thread). **Checks** live in `.agents/checks/*.md`, scoped by directory, and each check runs as a separate agent, which gives "a stronger guarantee that each check will actually be checked than if the checks were embedded in a general context file." [read] https://ampcode.com/news/liberating-code-review
- **Amp, "Agentic Review"** (Dec 18, 2025): the review panel pre-scans the diff, recommends a reading order, summarizes per file, and feeds the review agent's comments back to the main agent. Open questions they list: "How do reviews map to threads? It's not 1-1." "When you accept or reject review comments, should Amp learn from that?" [read] https://ampcode.com/news/agentic-code-review
- **Amp, "Intelligently Ordered Diffs"** (Sep 1, 2026): "The first challenge in code review is figuring out which files to read first." Essential files go first, and tests, fixtures and generated code are muted. [read] https://ampcode.com/news/intelligently-ordered-diffs
- **Armin Ronacher quotes Boris Cherny** in "The Coming Loop": "I don't prompt Claude anymore. I have loops running that prompt Claude... My job is to write loops." [read; secondary for the Cherny quote itself]
- Forge implication: human taste is increasingly **encoded upstream**, in checks, AGENTS.md, signs and policy, rather than applied downstream at review time. A forge should make these artifacts versioned, path-scoped and auditable, and should report which human-authored rule caught what. That is how taste "scales" past one person's attention. [inference]

### H. Accountability and compliance without human diff review

- **Amp, "That's not SOC 2 compliant"** (Will Dollman, Aug 13, 2026). The controls are restricted push access, signed commits (GitHub-enforced verified signatures on main), automated CI that blocks main, and commits linked to Amp threads. SOC 2 asks that changes be "authorized, tested, approved, and recorded." "**And no, code review isn't on the list.** The criteria don't say a second human has to stare at a diff." "We're 20 people... we're not going to pretend a 2,000-person company should let everyone push to main." Advice: "Pick one system and ask: 'What risks are our pull requests actually managing here?'" [read] https://ampcode.com/notes/thats-not-soc-2-compliant — **The brief's claim is confirmed.**
- **Amp, "Pave The Road"** (Alex Kemper, Aug 10, 2026): "isolation over permission, quick reversibility rather than careful review, and parallelism instead of queues." Commit velocity is up 65% since orbs, and more than 85% of commits come from orbs. "What good is it if the latest model completes a task in five minutes, but it takes another five days to get deployed?" [read] https://ampcode.com/notes/pave-the-road — **Confirmed.**
- **Amp, Proof-of-human / passkey authentication** (2026): an active passkey can be required for operations such as remotely controlling a thread, and it "will serve as proof-of-human for future Amp features." [read] https://ampcode.com/news/proof-of-human
  - Forge implication: "named human approval" in the brief's billing-path policy needs a **proof-of-human primitive**, so that an agent acting with a human's token cannot approve its own change. [inference]
- **Ghostty AI Usage Policy**: "All AI usage in any form must be disclosed." "**The human-in-the-loop must fully understand all code.** If you can't explain what your changes do... do not contribute." "Bad AI drivers will be denounced" on a public list. "It's the people, not the tools, that are the problem." Maintainers are exempt because they have "proven themselves trustworthy." [read] https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md
- **Mitchell Hashimoto, "Ghostty Is Leaving GitHub"** (Apr 28, 2026): "almost every day has an X" for an outage that blocked his work. "I've been unable to do any PR review for ~2 hours because there is a GitHub Actions outage." "The issue isn't Git, it's the infrastructure we rely on around it: issues, PRs, Actions." [read] https://mitchellh.com/writing/ghostty-leaving-github
  - Relevant to the brief's pain evidence: a prominent open-source project is leaving GitHub over the collaboration layer, not over git. [inference]

### I. Counter-evidence: what humans do besides taste

- **Armin Ronacher, "The Coming Loop"** (Jun 23, 2026). [read] https://lucumr.pocoo.org/2026/6/23/the-coming-loop/
  - "Part of that is taste and part of it is control... I want to understand the code I ship. Under pressure... I want to be able to explain what the system does without first having to ask a clanker."
  - "Present-day models tend to produce code that is too defensive, too complex, too local in its reasoning. They avoid strong invariants. They add fallbacks instead of making bad states impossible... When you take that behavior and you put it behind loops, you tend to amplify it."
  - Hands-off harnesses "produce worse code than what we were producing last autumn" (his taste). Agents work "uninterrupted... for thirty minutes or more."
  - Loops work for porting, performance exploration, security scanning and research, which are outputs that are "mechanical translation" or "without necessity of longevity."
  - On incident response: engineers now have "a clanker read logs, propose root causes and proactively put up a patch... picked up by another machine that reviews, sometimes even landing it on main without any human supervision." "We treat it, we monitor it, we stabilize it, but we do not necessarily comprehend it." Software becomes an "organism."
  - "**Better visualizations of changes or orchestration or agents will not restore our understanding.** Either we need to find clever ways to jolt the human back into the loop and make the changes of the loops legible long term, or we need to find better ways to compose these ever more complex systems."
  - "In the harness operated loop... **My role is reduced to that of a messenger.**"
  - Security forces adoption anyway: "Even if you do not use loops to build your software, other people will use loops against your software." He cites curl maintainers being overwhelmed by AI-generated reports.
  - Dependency risk: "What if you and your team just lose the last remaining ability to understand the code without using the machine?"
- **Armin Ronacher, "Agent Psychosis"** (Jan 18, 2026): "As a maintainer many PRs now look like an insult to one's time." "It takes me minutes to figure this out." He warns about "completely forcing the AI down a path without any real critical thinking." [read] https://lucumr.pocoo.org/2026/1/18/agent-psychosis/
- **Cognition, "Devin's 2025 Performance Review"** (Nov 14, 2025): Devin is "senior-level at codebase understanding but junior at execution." 67% of its PRs are merged now, against 34% a year earlier. "**Human review is still necessary, because code quality is not straightforwardly verifiable.**" "In visual design, Devin needs specifics like component structure, color codes, and spacing values." "It usually performs worse when you keep telling it more after it starts the task." [read] https://cognition.ai/blog/devin-annual-performance-review-2025
  - Note the contrast: Amp's Fable 5.1 claims the opposite of Devin's mid-task steering weakness ("It addresses every instruction you give it"). Mid-task steering, which is what portal comments are, depends on the model. [read + inference]
- **Yegge, "The AI Vampire"** (Feb 11, 2026): "Being in the same room with AI is draining people." He describes "Nap Attacks" and "massive fatigue, every day" from vibe-coding sessions, and calls agentic building "genuinely addictive... like a slot machine." [read] https://steve-yegge.medium.com/the-ai-vampire-eda6e4f07163
- **Armin Ronacher, "Fast and Hard Code"** (Aug 22, 2026): agents make language choice "much less consequential," and people now ship Rust, Zig, eBPF and crypto they could not have written by hand. He notes "Cloudflare's new Artifacts service uses a pure-Zig Git-protocol engine, compiled to a roughly 100 KB WebAssembly module." Implication: more code in domains where the human sponsor **cannot** judge the code by taste. [read] https://lucumr.pocoo.org/2026/8/22/fast-hard-code/
- **DORA 2025** (Google Cloud): "AI's primary role is as an amplifier, magnifying an organization's existing strengths and weaknesses." [read, landing page only] https://dora.dev/research/2025/dora-report/

---

## Pain points for agentic-scale development (human side)

1. **Review queue latency, not review effort.** AI PRs wait 4.6x longer before anyone picks them up (LinearB). Median time in review is up 441.5% (Faros 2026). Humans are putting AI PRs off. [read]
2. **Review is being skipped silently.** PRs merged with no review are up 31.3%, while incidents per PR are up 242.7% (Faros 2026). [read]
3. **Diff volume has outgrown human reading.** PR size is up 154% (Faros 2025) and median PR size up 79% (Greptile). Google's pre-AI median was 24 lines. Karpathy: "not useful to me to get a diff of 10,000 lines." [read]
4. **The defects AI introduces are the hardest to see in a preview.** These include error paths, concurrency, I/O amplification, security and readability (CodeRabbit). [read]
5. **Skills needed to supervise are eroding.** Debugging scores dropped most (Anthropic RCT). The "paradox of supervision" appears in Anthropic's internal study. [read]
6. **Shared understanding is decaying (cognitive debt), and rationale is not captured (intent debt).** [read]
7. **Maintainers are drowning in AI PRs.** One extreme handles about 50 PRs a day and spends 15 to 20 hours a week on them (Yegge). The other extreme bans or denounces bad AI contributions (Ghostty). [read]
8. **Human attention is fragmented and drained.** Notifications break focus (Hashimoto). Yegge describes fatigue and addiction. The human becomes the "control plane" bottleneck at fleet scale (Yegge). [read]
9. **Taste does not survive loops.** Each iteration adds local defences, and code gets less understandable while appearing robust (Ronacher). Kent Beck also could not get the genie to care about simplicity. [read]
10. **The forge infrastructure itself is a blocker.** Outages block PR review for hours (Hashimoto leaving GitHub). [read]

## How orgs are solving them

| Approach | Who | What they do | Tag |
|---|---|---|---|
| Live preview with comments sent to the agent | Amp portals | HTTP service in an orb, comments go to the thread, multiplayer, wakes and sleeps with the orb | [read] |
| Preview comments between humans | Vercel | Toolbar comments on every preview, free, linked to Slack | [read] |
| Agent-recorded proof | Amp (Fable 5.1, orbs), Cursor cloud agents | Video, screenshots, logs and test matrices attached to the PR or thread; reviewer can take over the agent's desktop | [read] |
| Author must prove it works | Willison; Ghostty | Evidence in the PR; no unreviewed agent code dumped on collaborators | [read] |
| Machine triage, human only for taste | Yegge's PR Sheriff | Agent sorts PRs into categories; humans handle about 25%, of which 5 to 10% take hours | [read] |
| Review criteria as code | Amp `.agents/checks` | Path-scoped checks, one agent per check | [read] |
| Harness engineering | Hashimoto, Huntley | AGENTS.md lines per observed failure, verification tools, "signs" | [read] |
| Better review UI for humans | Amp Diffs and ordered diffs | Duplicate-block-aware diffs, important files first, mobile review | [read] |
| Comprehension artifacts | Willison's Showboat walkthroughs; Devin DeepWiki | Walkthroughs with code pulled by executed commands; auto-generated docs | [read] |
| Risk-based controls in place of human diff review | Amp SOC 2 | Restricted push, signed commits, blocking CI, commit-to-thread links | [read] |
| Human-understanding requirement | Ghostty; Storey | At least one human fully understands each change | [read] |
| Isolation and reversibility over prevention | Amp "Pave the road" | Push to main, orbs, fast revert | [read] |

## Implications for a future forge

All of these are [inference] unless noted.

1. **Split "review" into two surfaces with separate policy.**
   - A **Taste surface** answers "is this what we want?" It holds live portals and pinned previews, visual comparison of variants or competing threads, and comments that steer the agent. Fast, visual and pleasant, as Karpathy describes.
   - An **Understanding surface** answers "can a human on this team explain it?" It holds agent-generated walkthroughs built from executed snippets, an intent record, an ordered and summarized diff, invariant checks, and "ask the thread why."
   - Policy decides per path whether the Understanding surface needs a named human sign-off (Storey's rule, Ghostty's rule) or whether proof plus checks is enough (Amp's rule). Docs and UI copy need taste only. Data formats, auth, billing and infrastructure need understanding as well.
2. **Make "choose among N" a core action.** The purest tastemaking is selection. Amp's Thorsten asks the agent for a debug toggle so he can compare backgrounds; Cloudflare's brief asks for "compare several changes and decide which ships." The forge should fan one intent out to K threads with K pinned previews, show them side by side, and let a human pick, merge ideas ("take the layout from A and the copy from B"), or reject all. This gives humans more leverage than reading one diff.
3. **Route preview comments to the thread as steering events, and record them.** Amp shows that comments on the running app are better and more token-efficient than annotated screenshots. Each comment should be stored with its anchor (pinned deployment URL, DOM selector, screenshot crop) and the agent's response. That builds a "taste log," the decision history that intent debt says is usually lost.
4. **Distinguish a live portal from pinned evidence.** Portals are mutable and live-reloading. Evidence must point at an immutable deployment. The brief's two-URL model (preview URL against deployment URL) is the right design. The forge should show both: "iterate here" (live) and "approved this" (pinned).
5. **Evidence types should include comprehension, not just behaviour.** Add `walkthrough` (executed, not transcribed), `intent`, `alternatives-considered`, and `invariants-touched` alongside screenshots, video and test results. Generate them with a separate agent from the author agent, given that the guide warns agents "will absolutely cheat."
6. **Put human attention behind a scheduler.** Batch review requests. Let humans pull rather than be pushed (Hashimoto's no-notifications rule). Rank by risk and novelty (Yegge's easy-win and needs-review triage). Show a queue-age SLA, since the 4.6x pre-review wait is the measured bottleneck. Make phone review a first-class mode: portals and video work on a phone; 2,000-line diffs do not.
7. **Make the maintainer's resolution verbs first-class operations.** These are fix-merge, merge-then-fix, split-merge, cherry-pick-with-attribution, redesign, retire and reject. Request-changes is last. In a thread-native forge, "fix-merge" means forking the contributor's thread and continuing it in the maintainer's sandbox while keeping attribution. This beats GitHub's approve or request-changes model for open source.
8. **Encode taste upstream as versioned, path-scoped checks.** Checks, AGENTS.md lines and "signs" are the way one human's taste scales to 100 agents. The forge should track each check's catch rate and false-positive rate, run new checks in shadow mode first (the brief's Anthropic claim, unverified here), and attribute each check to the human who wrote it.
9. **Proof-of-human for approvals.** A named-human approval must be a fresh human action, such as a passkey (Amp already has this primitive), and not something an agent holding the human's token can do.
10. **Build in incident-time comprehension.** Production debugging is where the hypothesis is weakest (debugging was the largest RCT gap, and Ronacher's "organism" problem). From an alert, the forge should reach the commit, then the thread, its intent, its evidence, and the agent that can be asked. It should also make "revert first, understand second" a one-click action, which matches Amp's reversibility stance.
11. **A skill-preservation mode is worth offering.** Optional "explain-first" or "you drive" threads for juniors, matching the interaction patterns that kept learning intact in the Anthropic RCT. This answers the "paradox of supervision" directly in the product.

## Contradictions and pushback

- **Amp contradicts itself, productively.** June 2026, Diffs: "Outsource your coding, but not your understanding of the code." August 2026, orbs: proof makes review "lighter, less sigh-inducing" and the team pushes to main without PRs. The likely resolution is that Amp still offers diffs and review agents, and that proof lowers the reading load without removing it. The brief's "merge on proof, not human diff-reading" should be stated as "*mostly* on proof, with comprehension still required by policy for risky paths." [read + inference]
- **Two meanings of "taste."** Yegge's alien PR and Thorsten's background images are *product* taste, which previews show. Ronacher's invariants and Beck's simplicity are *engineering* taste, which previews hide. The hypothesis holds for the first and fails for the second. [inference]
- **Karpathy supports visual verification but recommends small chunks and keeping AI "on the leash."** That conflicts with Amp's "let it run 30 minutes and dazzle me" and with Ralph and Gas Town loops. The forge must support both (an autonomy slider per path). [read + inference]
- **Yegge's model has the human never read the code** ("only agents have ever seen their source code"). **Ghostty's model requires full human understanding.** Both are successful open-source projects. Policy must be per project. [read]
- **Evidence on productivity is mixed.** METR found 19% slower in early 2025; its 2026 data is unreliable because of selection effects; its May 2026 survey shows 1.4 to 2x self-reported value, and people overestimate. Faros shows throughput up together with incidents and review time sharply up. Anthropic's internal study shows +50% self-reported. Claims that "the human is only the bottleneck on taste" assume quality is already handled, and Faros and CodeRabbit dispute that. [read]
- **Devin and Fable 5.1 disagree on mid-task steering.** Devin performs worse with mid-task changes; Fable 5.1 handles several steering messages at once. Live-portal steering depends on model capability. [read]
- **Cursor's figure:** coverage cited 35% of internal PRs from cloud agents; Cursor's own post says "more than 30%." [read]
- **Faros report date:** coverage gives March 2026; the Faros blog says April 12, 2026. I used the blog date. [read/secondary]

## Open questions

1. What share of a typical change's risk shows up in a preview? None of the sources measure this. One study design: classify incidents after the fact as "a reviewer could have seen it in a preview or video" or "only visible in the code."
2. Does reviewing proof (video, screenshots) catch fewer defects than reading diffs, or a different set? No controlled data was found.
3. Does preview-based review keep the *educational* function of review that Google found (norms, knowledge spread), or does it speed up cognitive debt?
4. How should taste decisions made in preview comments be generalised into checks or AGENTS.md automatically? Amp lists "should Amp learn from that?" as open.
5. At 2,000 people, what replaces "everyone is close to the code"? Amp declines to claim it scales.
6. Is "choose among N variants" economical? K parallel threads multiply compute and preview count, and Workers Previews are capped at 500 per Worker.
7. How do you stop agents gaming visual proof? One example: Fable 5.1 found its own 2-pixel comparison error. Who checks when it does not?
8. **Unverified here:** OpenAI's harness-engineering claims (about 1,500 PRs, three engineers, human QA as the bottleneck); the page returned 403. Anthropic's security-review claim (16% to 54% substantive comments). Storey's LeadDev origin story (October 2025 course). Gas Town's Refinery as a "Bors-style bisecting merge queue" (secondary only).

## Sources (opened and read)

| Title | URL | Date |
|---|---|---|
| Simon Willison, Vibe engineering | https://simonwillison.net/2025/Oct/7/vibe-engineering/ | 2025-10-07 |
| Simon Willison, Your job is to deliver code you have proven to work | https://simonwillison.net/2025/Dec/18/code-proven-to-work/ | 2025-12-18 |
| Simon Willison, Agentic Engineering Patterns (index) | https://simonwillison.net/guides/agentic-engineering-patterns/ | 2026 |
| Willison, Anti-patterns | https://simonwillison.net/guides/agentic-engineering-patterns/anti-patterns/ | 2026 |
| Willison, Agentic manual testing | https://simonwillison.net/guides/agentic-engineering-patterns/agentic-manual-testing/ | 2026 |
| Willison, Linear walkthroughs | https://simonwillison.net/guides/agentic-engineering-patterns/linear-walkthroughs/ | 2026 |
| Faros AI, The AI Productivity Paradox | https://www.faros.ai/blog/ai-software-engineering | 2025-07-23 |
| Faros AI, AI Engineering Report 2026: Acceleration Whiplash, ten takeaways | https://www.faros.ai/blog/ai-acceleration-whiplash-takeaways | 2026-04-12 |
| LinearB, 2026 Software Engineering Benchmarks Report (landing) | https://linearb.io/resources/software-engineering-benchmarks-report | 2026 |
| Greptile, State of AI Coding (landing, Q2 2026 update) | https://www.greptile.com/state-of-ai-coding-2025 | 2026 |
| CodeRabbit, State of AI vs Human Code Generation | https://www.coderabbit.ai/blog/state-of-ai-vs-human-code-generation-report | 2025-12-17 |
| Amp Chronicle index | https://ampcode.com/chronicle | 2026-10 |
| Amp, Portals into Orbs | https://ampcode.com/news/portals | 2026-08-06 |
| Amp Time Capsule 3, Iterating With Agents in Orbs Using Portals (transcript) | https://ampcode.com/time-capsules/3 | 2026-08-11 |
| Amp, What I Want to Tell You About Orbs | https://ampcode.com/notes/what-i-want-to-tell-you-about-orbs | 2026-08-04 |
| Amp, Fable 5.1 | https://ampcode.com/news/fable-5.1 | 2026-09-01 |
| Amp, Liberating Code Review | https://ampcode.com/news/liberating-code-review | 2026-02-04 |
| Amp, Agentic Review | https://ampcode.com/news/agentic-code-review | 2025-12-18 |
| Amp, Intelligently Ordered Diffs | https://ampcode.com/news/intelligently-ordered-diffs | 2026-09-01 |
| Amp, Desktop | https://ampcode.com/news/desktop | 2026-09-04 |
| Amp, Diffs | https://ampcode.com/news/diffs | 2026-06-16 |
| Amp, "That's not SOC 2 compliant" | https://ampcode.com/notes/thats-not-soc-2-compliant | 2026-08-13 |
| Amp, Pave The Road | https://ampcode.com/notes/pave-the-road | 2026-08-10 |
| Amp, Proof of Human / passkey authentication | https://ampcode.com/news/proof-of-human | 2026 (updated 2026-06-25) |
| Steve Yegge, Revenge of the junior developer | https://sourcegraph.com/blog/revenge-of-the-junior-developer | 2025-03-22 |
| Steve Yegge Medium RSS feed (full text of posts below) | https://steve-yegge.medium.com/feed | fetched 2026-10-12 |
| Yegge, Vibe Maintainer | https://steve-yegge.medium.com/vibe-maintainer-a2273a841040 | 2026-03-31 |
| Yegge, Welcome to Gas City | https://steve-yegge.medium.com/welcome-to-gas-city-57f564bb3607 | 2026-04-24 |
| Yegge, The AI Vampire | https://steve-yegge.medium.com/the-ai-vampire-eda6e4f07163 | 2026-02-11 |
| Yegge, The Anthropic Hive Mind (skimmed) | https://steve-yegge.medium.com/the-anthropic-hive-mind-d01f768f3d7b | 2026-02-06 |
| Geoffrey Huntley, Ralph Wiggum as a software engineer | https://ghuntley.com/ralph/ | 2025-07-14 |
| Andrej Karpathy, Software Is Changing (Again), YC transcript | https://www.ycombinator.com/library/MW-andrej-karpathy-software-is-changing-again | 2025-06 |
| Latent Space, Software 3.0 write-up | https://www.latent.space/p/s3 | 2025-06 |
| Addy Osmani, Comprehension Debt | https://addyosmani.com/blog/comprehension-debt/ | 2026-03-14 |
| Margaret-Anne Storey, Cognitive debt | https://margaretstorey.com/blog/2026/02/09/cognitive-debt/ | 2026-02-09 |
| Storey, From Technical Debt to Cognitive and Intent Debt (arXiv 2603.22106) | https://arxiv.org/abs/2603.22106 | 2026-03-23 (v4 04-06) |
| Martin Fowler, Fragments: April 2 | https://martinfowler.com/fragments/2026-04-02.html | 2026-04-02 |
| Anthropic, How AI assistance impacts the formation of coding skills | https://www.anthropic.com/research/AI-assistance-coding-skills | 2026-01-29 |
| Anthropic, How AI is transforming work at Anthropic | https://www.anthropic.com/research/how-ai-is-transforming-work-at-anthropic | 2025-12-02 |
| Cursor, Cursor agents can now control their own computers | https://cursor.com/blog/agent-computer-use | 2026-02-24 |
| Cognition, Devin's 2025 Performance Review | https://cognition.ai/blog/devin-annual-performance-review-2025 | 2025-11-14 |
| Vercel Docs, Comments overview | https://vercel.com/docs/comments | current |
| Mitchell Hashimoto, My AI Adoption Journey | https://mitchellh.com/writing/my-ai-adoption-journey | 2026-02-05 |
| Mitchell Hashimoto, Ghostty Is Leaving GitHub | https://mitchellh.com/writing/ghostty-leaving-github | 2026-04-28 |
| Ghostty AI Usage Policy | https://raw.githubusercontent.com/ghostty-org/ghostty/main/AI_POLICY.md | current |
| Armin Ronacher, The Coming Loop | https://lucumr.pocoo.org/2026/6/23/the-coming-loop/ | 2026-06-23 |
| Armin Ronacher, Agent Psychosis | https://lucumr.pocoo.org/2026/1/18/agent-psychosis/ | 2026-01-18 |
| Armin Ronacher, Fast and Hard Code | https://lucumr.pocoo.org/2026/8/22/fast-hard-code/ | 2026-08-22 |
| Armin Ronacher, Anger, Anxiety and Agency | https://lucumr.pocoo.org/2026/8/24/anger-anxiety-agency/ | 2026-08-24 |
| Armin Ronacher blog index | https://lucumr.pocoo.org/ | fetched 2026-10-12 |
| Kent Beck, Augmented Coding: Beyond the Vibes | https://tidyfirst.substack.com/p/augmented-coding-beyond-the-vibes | 2025-06-25 |
| Kent Beck, Is Source Code Going Away? (paywalled preview only) | https://tidyfirst.substack.com/p/is-source-code-going-away | 2026-02-06 |
| Sadowski et al., Modern Code Review: A Case Study at Google (PDF) | https://sback.it/publications/icse2018seip.pdf | 2018 |
| Google Research publication page for the above | https://research.google/pubs/modern-code-review-a-case-study-at-google/ | 2018 |
| Google Research, Resolving code review comments with ML | https://research.google/blog/resolving-code-review-comments-with-ml/ | 2023 |
| METR, Early-2025 AI experienced OS dev study | https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ | 2025-07-10 |
| METR, We are Changing our Developer Productivity Experiment Design | https://metr.org/blog/2026-02-24-uplift-update/ | 2026-02-24 |
| METR, Self-Reported Impact of Early-2026 AI | https://metr.org/blog/2026-05-11-ai-usage-survey/ | 2026-05-11 |
| DORA, 2025 State of AI-assisted Software Development (landing) | https://dora.dev/research/2025/dora-report/ | 2025 |

Attempted but blocked (403): OpenAI, Harness engineering (https://openai.com/index/harness-engineering/), and Karpathy's bearblog.
Secondary only (search snippets, not opened): heise and Kilo coverage of Gas Town roles; the Thoughtworks and LeadDev cognitive-debt articles; Business Insider coverage of Anthropic's study.

# 71: Systematic coverage of claude.com/blog, customer stories, claude.dev, and the Claude Code changelog

Researcher key: `71-coverage-claude-blog`. Compiled 2026-10-12.

**Tags.** **[read]** means verified from the page text, which I pulled with curl and turned into plain text locally. **[scan]** means a keyword scan of the page, not a full read. **[inference]** means my own reasoning. I used no WebSearch calls. Every page came from sitemaps, the RSS feed, raw page fetches, the npm registry, or the GitHub raw changelog.

**Scope findings that matter for future passes:**
- **claude.com/blog is now claude.com/resources/articles.** `https://claude.com/blog` returns HTTP 308 to `/resources/articles`. The old `/blog/<slug>` URLs on the already-read list match the same slugs under `/resources/articles/<slug>`.
- **The sitemap is the complete index.** `https://claude.com/sitemap.xml` lists 257 article URLs. I checked the live index page's embedded slugs against it and found no article missing. The index page itself is a Next.js app that loads its list client-side, so the sitemap is the reliable enumeration.
- **Dates come from each article's `article:published_time` meta tag**, read for all 257 articles.
- **Customer stories are separate.** They live under `/customers/<slug>` (284 pages) and carry no publish dates.

---

## (a) Coverage table

| Source | Posts enumerated | R count | R read now | R already read | Blocked |
|---|---|---|---|---|---|
| claude.com/resources/articles (formerly claude.com/blog) | 257 in sitemap; **242 dated 2025-01-01 to 2026-10-12** (15 from 2023–2024 were excluded) | **94** | **79** read in full, plus 1 skimmed | **14** (13 on the list in 96, plus `beyond-permission-prompts`, which is the engineering-blog sandboxing post already read) | 0 |
| claude.com/customers (customer stories; undated) | **284** | **55** (dev-practice relevant) | **17** read in full, **38** keyword-scanned | 0 (only the Block resource article was on the list before) | 0 |
| claude.dev/blog | **15** (Apr 10 to Oct 8 2026; from `/rss.xml` and the sitemap) | **10** | **6** | **4** | 0 (`/blog/rss.xml` returns 404, `/rss.xml` works) |
| Claude Code changelog (GitHub `anthropics/claude-code` CHANGELOG.md, dated with npm registry release times) | 418 version headers in the file; 535 npm versions from 2025-02-24 to 2026-10-09 | 289 feature or behavior lines matched on parallel, review, merge, worktree, sandbox, attribution, routine or workflow terms | about 60 extracted below | `code.claude.com/docs/en/whats-new` weekly digests (weeks 13–37) were read before | 0 |

Classification rule. **R** means the post bears on software development practice with agents: coding agents, CI, testing, review, merge or landing, sandboxes, parallel or multi-agent work, agent security or permissions, productivity data, or internal engineering practice. **N** means everything else: Cowork or Office features, sales, legal and finance use cases, consumer features, events with no technical content, and hackathon winners.

---
## (b) Full index with R/N marks

### b1. claude.com/resources/articles: 242 posts, 2025-01-01 to 2026-10-12

Format: `date | mark | title | slug`. Each URL is `https://claude.com/resources/articles/<slug>`. The old `https://claude.com/blog/<slug>` URLs redirect there.

Marks:
- `R READ-NOW`: read in full in this pass.
- `R prev-read`: on the list in 96 or covered by summaries 01 and 02.
- `R skimmed`: skimmed only.
- `N (read)`: read, then judged not relevant.
- `N`: not relevant to agentic software development.

```
2026-10-08 | R prev-read | How Block orchestrates Claude Fable across thousands of pull requests | how-block-orchestrates-claude-fable-across-thousands-of-pull-requests
2026-10-08 | N | Build live dashboards and animate explainers with Claude | dashboards-and-motion
2026-10-06 | N | We’re expanding the Claude Startups program to help founders build | were-expanding-the-claude-startups-program-to-help-founders-build
2026-10-06 | R READ-NOW | How Comcast and Booz Allen use Claude Mythos to find exploit chains and secure their codebases | how-comcast-booz-allen-use-claude-mythos-to-secure-their-codebases
2026-10-06 | N | Claude now works with Google Docs, Sheets, and Slides | claude-now-works-in-google-docs-sheets-and-slides
2026-10-05 | N | How Cresta turned CX expertise into an agent builder on the Claude Agent SDK | how-cresta-turned-cx-expertise-into-an-agent-builder-on-the-claude-agent-sdk
2026-10-01 | R READ-NOW | Customize Claude Code with mods in TypeScript | claude-code-mods
2026-09-30 | N | How Anthropic's sales team rebuilt inbound with Claude Managed Agents | how-anthropics-sales-team-rebuilt-inbound-with-claude-managed-agents
2026-09-30 | N | Claude for Government is now generally available | claude-for-government-is-now-generally-available
2026-09-29 | N | Agents you can coach: how Asana builds human-agent teams with Claude | agents-you-can-coach-how-asana-builds-human-agent-teams-with-claude
2026-09-28 | R READ-NOW | Giving companies more control over their AI agents, with NVIDIA | giving-companies-more-control-over-their-ai-agents-with-nvidia
2026-09-25 | N | Build plugins for Claude with the directory submission portal | build-plugins-for-claude
2026-09-24 | N | Claude Tag now supports personal connectors in channels | claude-tag-now-supports-personal-connectors-in-channels
2026-09-24 | R prev-read | Coding sessions are longer and use more context. Claude Opus 5.5 is built with that in mind. | claude-opus-5-5-built-for-coding-sessions-that-use-more-context
2026-09-23 | R READ-NOW | How to prepare for AI-driven code modernization projects | how-to-prepare-for-ai-driven-code-modernization-projects
2026-09-23 | N | CodeRabbit, Power Digital, ThoughtSpot on Claude Marketplace | how-coderabbit-power-digital-and-thoughtspot-scale-with-snowflake-and-vercel-on-claude-marketplace
2026-09-23 | N | Claude Marketplace: plugins and connectors, products and agents, and service partners | claude-marketplace
2026-09-17 | N | Working at the frontier: How Balyasny Asset Management evaluates and governs Claude Fable 5 | working-at-the-frontier-how-balyasny-asset-management-evaluates-and-governs-claude-fable-5
2026-09-17 | R prev-read | Projects redesigned: from folder to conversation | projects-redesigned
2026-09-16 | N | Claude Cowork and chat are now one Claude | cowork-is-now-claude
2026-09-15 | N | Salesforce in Claude | salesforce-in-claude
2026-09-15 | N | Claude for Small Business launches new workflows, integrations, and training programs | claude-for-small-business-launches-new-workflows-integrations-and-training-programs
2026-09-15 | N | Building an AI-native revenue organization | building-an-ai-native-revenue-organization
2026-09-14 | N | How healthcare organizations use Claude Tag | how-healthcare-organizations-use-claude-tag
2026-09-14 | N | Deploying AI from pilot to production: a practical blueprint for CIOs and technical leaders | deploying-ai-from-pilot-to-production
2026-09-14 | N | Claude for Financial Advisors | claude-for-financial-advisors
2026-09-14 | R prev-read | Agentic coding is straining CI. Here’s how we scaled test impact analysis at Anthropic | agentic-coding-is-straining-ci-heres-how-we-scaled-test-impact-analysis-at-anthropic
2026-09-10 | N | What 1,000 small business owners taught us about AI | what-1-000-small-business-owners-taught-us-about-ai
2026-09-10 | N | T. Rowe Price brings more of Claude to its investment process | t-rowe-price-brings-more-of-claude-to-its-investment-process
2026-09-08 | N | Reducing cost and improving performance with Claude Platform | reducing-cost-and-improving-performance-with-claude-platform
2026-09-02 | N | A guide to the anatomy of effective commerce agents | the-anatomy-of-effective-commerce-agents
2026-09-02 | N | Building commerce agents with Claude | claude-for-commerce-agents
2026-08-28 | N (read) | How Anthropic employees use Claude Tag | how-anthropic-employees-use-claude-tag
2026-08-28 | N | Claude for Teachers, now available for U.S. K-12 schools and districts | claude-for-teachers-now-available-for-schools-and-districts
2026-08-26 | R READ-NOW | How Warp builds self-improving agents on Claude | how-warp-builds-self-improving-agents-on-claude
2026-08-26 | N | Claude Cowork gets a built-in browser: nothing to install | cowork-built-in-browser
2026-08-26 | N | Claude in Chrome is generally available | claude-in-chrome-generally-available
2026-08-25 | N | Claude's memory works everywhere, and you decide what's in it | claudes-memory-works-everywhere-and-you-decide-whats-in-it
2026-08-25 | N | Bain & Company joins the Claude Partner Network as a Global Premier partner | bain-company-joins-the-claude-partner-network-as-a-global-premier-partner
2026-08-24 | N | How an Anthropic field marketer uses Claude Code to send weekly personalized updates to every sales rep | how-an-anthropic-field-marketer-uses-claude-code-to-send-weekly-personalized-updates-to-every-sales-rep
2026-08-21 | R READ-NOW | The AI-native SDLC playbook | the-ai-native-sdlc-playbook
2026-08-21 | N | Bringing the cybersecurity capabilities of Claude Mythos 5 to more defenders | bringing-claude-mythos-5-to-more-defenders
2026-08-20 | R READ-NOW | How monday.com transformed its platform into an agent-first product where humans and agents collaborate | how-monday-com-transformed-its-platform-into-an-agent-first-product-where-humans-and-agents-collaborate
2026-08-20 | N | Build production agents with computer use, the Skills API, and the Files API | computer-use-skills-api-files-api
2026-08-20 | R READ-NOW | The Claude Code guide for startups | claude-code-guide-for-startups
2026-08-20 | N | Anthropic’s approach to teaching and learning AI | anthropics-approach-to-teaching-and-learning-ai
2026-08-19 | N (read) | Turning conversation into knowledge: how Slack builds human-agent teams | turning-conversation-into-knowledge-how-slack-builds-human-agent-teams
2026-08-18 | R prev-read | How Claude Tag serves as Anthropic’s first responder for CI/CD failures | ai-ci-cd-on-call
2026-08-17 | N | How ABC Legal turned every employee into a builder with Claude Managed Agents | how-abc-legal-turned-every-employee-into-a-builder-with-claude-managed-agents
2026-08-14 | R READ-NOW | Maximizing the value of your Claude Code sessions | maximizing-the-value-of-your-claude-code-sessions
2026-08-13 | N | Self-service data analytics in Slack: how Anthropic deploys Claude Tag for ad-hoc questions | self-service-data-analytics-in-slack-how-anthropic-deploys-claude-tag-for-ad-hoc-questions
2026-08-13 | R READ-NOW | Securing the frontier: How JetBrains evaluates and deploys Claude Fable 5 | how-jetbrains-evaluates-and-deploys-claude-fable-5
2026-08-13 | N | Claude Tag now reads even more of the room | claude-tag-now-reads-even-more-of-the-room
2026-08-12 | N | Claude Cowork comes to the Chrome side panel | cowork-chrome-side-panel
2026-08-11 | R READ-NOW | Compliance API coverage extends to Claude Cowork and Claude Code | compliance-api-cowork-and-claude-code
2026-08-07 | N | How Anthropic's business development team uses Claude to run inbound and outbound at scale | how-anthropics-business-development-team-uses-claude-to-run-inbound-and-outbound-at-scale
2026-08-07 | R READ-NOW | Running auto mode in production | auto-mode-in-production
2026-08-07 | R READ-NOW | Auto mode is now the default in Claude Code for Pro, Max, and Team plans | auto-mode-default-in-claude-code
2026-08-06 | R READ-NOW | Self-hosted environments for Claude Code | run-claude-code-sessions-on-your-own-compute
2026-08-06 | N | Millennium and Anthropic are building a digital risk analyst with Claude | millennium-and-anthropic-are-building-a-digital-risk-analyst-with-claude
2026-08-05 | R READ-NOW | Inference hooks: inline data loss prevention for Claude Enterprise | claude-enterprise-inference-hooks
2026-08-04 | N (read) | A guide to cost visibility and control in Claude | a-guide-to-cost-visibility-and-control-in-claude
2026-07-28 | N | MCP 2026-07-28 spec: stateless core, coming to Claude | bringing-mcp-2026-07-28-to-claude
2026-07-24 | N | How the product designer who built Claude Design uses it | how-the-product-designer-who-built-claude-design-uses-it-to-explore-ideas-before-building-them
2026-07-24 | N | Claude models explained: choosing the best model for your use case | claude-models-explained-choosing-the-best-model-for-your-use-case
2026-07-23 | N | Think through hard problems in voice mode | think-through-hard-problems-in-voice-mode
2026-07-23 | N | Four role-based certifications for the people who put Claude to work for customers | four-role-based-claude-certifications
2026-07-22 | N | How Outtake built a cyber investigator on Claude | how-outtake-built-a-cyber-investigator-on-claude
2026-07-22 | R READ-NOW | Building verification loops in Claude Code with skills | building-verification-loops-in-claude-code-with-skills
2026-07-21 | R READ-NOW | How Datadog built a “universal machine tool” for Claude Code | how-datadog-built-a-universal-machine-tool-for-claude-code
2026-07-21 | R prev-read | How Anthropic secures its AI-native software development lifecycle | how-anthropic-secures-its-ai-native-software-development-lifecycle
2026-07-20 | R READ-NOW | How Rakuten builds agents overnight with Claude Fable 5 | working-at-the-frontier-rakuten
2026-07-17 | R READ-NOW | How Cursor knew Claude Fable 5 was ready for the hardest 1% of problems | working-at-the-frontier-cursor
2026-07-17 | R READ-NOW | CISO's guide to agentic AI | ciso-guide-to-agentic-ai
2026-07-16 | N | Working with Claude Fable 5 in Claude Cowork | working-with-claude-fable-5-in-claude-cowork
2026-07-16 | R READ-NOW | How Anthropic runs large-scale code migrations with Claude Code | ai-code-migration
2026-07-15 | R READ-NOW | Base44 uses Claude Fable 5 for its hardest engineering work | working-at-the-frontier-why-base44-trusts-claude-fable-5-with-their-most-challenging-engineering-work
2026-07-13 | N | Working at the frontier: How Hebbia builds AI for financial diligence that can't miss a detail | working-at-the-frontier-how-hebbia-builds-ai-for-financial-diligence-that-cant-miss-a-detail
2026-07-10 | R READ-NOW | Working at the frontier: How Cognition trusts Claude Fable 5 to work through the night | working-at-the-frontier-how-cognition-trusts-claude-fable-5-to-work-through-the-night
2026-07-08 | N | Working at the frontier: How Thomson Reuters builds AI for high- stakes professional work | working-at-the-frontier-how-thomson-reuters-builds-ai-for-high--stakes-professional-work
2026-07-08 | N | Using Claude Cowork in marketing operations to automate reporting and campaign building | how-anthropics-marketing-operations-team-uses-claude-cowork-to-automate-reporting-and-campaign-builds
2026-07-07 | N | How people are using Claude Cowork | how-people-are-using-claude-cowork
2026-07-07 | N | Claude Cowork on web and mobile: hand off work anywhere | cowork-web-mobile
2026-07-07 | R READ-NOW | Claude Code effort level and model selection | claude-model-and-effort-level-in-claude-code
2026-07-07 | N | Bringing Claude Code and Claude Cowork to government | bringing-claude-code-and-claude-cowork-to-government
2026-07-06 | R READ-NOW | A field guide to Claude Fable 5: Finding your unknowns | a-field-guide-to-claude-fable-finding-your-unknowns
2026-07-02 | N | New analytics and cost controls are available for Claude Enterprise | giving-admins-more-visibility-and-control-over-claude-usage-and-spend
2026-06-30 | R READ-NOW | Loop engineering: Getting started with loops | getting-started-with-loops
2026-06-29 | R READ-NOW | Introducing the Claude apps gateway for Amazon Bedrock and Google Cloud | introducing-the-claude-apps-gateway
2026-06-29 | N | Claude in Microsoft Foundry is now generally available | claude-in-microsoft-foundry
2026-06-24 | R READ-NOW | Lessons from Anthropic on building effective human-agent teams | building-effective-human-agent-teams
2026-06-24 | R READ-NOW | Agent identity: a new access model for autonomous, team-wide AI | agent-identity-access-model
2026-06-22 | N | Claude Desktop on AWS, Google Cloud, and Microsoft Foundry | the-full-claude-desktop-experience-on-aws-google-cloud-and-microsoft-foundry
2026-06-18 | R READ-NOW | Steering Claude Code: when to use CLAUDE.md, skills, hooks, and subagents | steering-claude-code-skills-hooks-rules-subagents-and-more
2026-06-18 | N | Centrally manage authorization for MCP connectors | enterprise-managed-auth
2026-06-18 | R READ-NOW | Claude Code now supports artifacts | artifacts-in-claude-code
2026-06-17 | R READ-NOW | Workload Identity Federation (WIF) is now generally available on the Claude Platform. | workload-identity-federation
2026-06-17 | N | Meet the winners of our Claude Opus 4.8 Build Day hackathon | meet-the-winners-of-our-claude-opus-4-8-build-day-hackathon
2026-06-17 | N | Claude Design now stays on brand for daily work | claude-design-stays-on-brand-for-daily-work
2026-06-15 | N | Meet the winners of the Built with Opus 4.7 Claude Code hackathon | meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon
2026-06-10 | R READ-NOW | The evolution of agentic surfaces: building with Claude Managed Agents | building-with-claude-managed-agents
2026-06-09 | R READ-NOW | New in Claude Managed Agents: run agents on a schedule and store environment variables in vaults | whats-new-in-claude-managed-agents
2026-06-08 | N | Connector observability and in-app directory submission | observability-for-developers-building-connectors
2026-06-08 | N | Claude support for Apple's Foundation Models framework | claude-for-foundation-models
2026-06-05 | N | The Claude Cowork product guide | the-claude-cowork-product-guide
2026-06-05 | N | How one Anthropic seller rebuilt his team's workflows with Claude Code | how-anthropic-uses-claude-gtm-engineering
2026-06-03 | R prev-read | Running an AI-native engineering org | running-an-ai-native-engineering-org
2026-06-03 | N | How Anthropic enables self-service data analytics with Claude | how-anthropic-enables-self-service-data-analytics-with-claude
2026-06-03 | N | Best practices for getting started with Claude Cowork | best-practices-for-getting-started-with-claude-cowork
2026-05-28 | R READ-NOW | Introducing dynamic workflows | introducing-dynamic-workflows-in-claude-code
2026-05-27 | R prev-read | Zero Trust for AI agents | zero-trust-for-ai-agents
2026-05-27 | R READ-NOW | Using LLMs to secure source code | using-llms-to-secure-source-code
2026-05-27 | R READ-NOW | How CodeRabbit used Claude to build an agent orchestration system | how-coderabbit-used-claude-to-build-an-agent-orchestration-system
2026-05-26 | R READ-NOW | Code w/ Claude London 2026: Rethinking how we build | code-w-claude-london-2026-rethinking-how-we-build
2026-05-22 | N | How Anthropic's finance team uses Claude to shape the narrative behind the numbers | how-anthropics-finance-team-uses-claude-to-shape-the-narrative-behind-the-numbers
2026-05-21 | N | How our partners are putting Opus to work for cybersecurity | how-our-partners-are-putting-opus-to-work-for-cybersecurity
2026-05-21 | N | Claude now works with more security and compliance tools | compliance-api-security-partners
2026-05-20 | N | How an Anthropic sales leader uses Claude Cowork to run a 4,000-account book | how-an-anthropic-sales-leader-uses-claude-cowork-to-run-a-4-000-account-book
2026-05-19 | R READ-NOW | New in Claude Managed Agents: dreaming, outcomes, and multiagent orchestration | new-in-claude-managed-agents
2026-05-19 | R READ-NOW | New in Claude Managed Agents: self-hosted sandboxes and MCP tunnels | claude-managed-agents-updates
2026-05-15 | N | Deploying Claude across the legal industry | deploying-claude-across-the-legal-industry
2026-05-14 | N | The founder's playbook: Building an AI-native startup | the-founders-playbook
2026-05-14 | R READ-NOW | How Claude Code works in large codebases: Best practices and where to start | how-claude-code-works-in-large-codebases-best-practices-and-where-to-start
2026-05-13 | N | Best practices for computer and browser use with Claude | best-practices-for-computer-and-browser-use-with-claude
2026-05-12 | R READ-NOW | How Anthropic's cybersecurity team built a threat detection platform with Claude Code | how-anthropic-uses-claude-cybersecurity
2026-05-12 | R READ-NOW | Code w/ Claude SF 2026: Building on the AI exponential | code-w-claude-sf-2026-sf
2026-05-12 | N | Claude for the legal industry | claude-for-the-legal-industry
2026-05-11 | N | Introducing the Claude Platform on AWS | claude-platform-on-aws
2026-05-11 | R READ-NOW | Agent view in Claude Code | agent-view-in-claude-code
2026-05-07 | N | Collaborate with Claude across Excel, PowerPoint, Word and Outlook | collaborate-with-claude-across-excel-powerpoint-word-and-outlook
2026-05-05 | N | Deploying Claude across financial services | deploying-claude-across-financial-services
2026-05-01 | R READ-NOW | How a non-technical project manager built and shipped a stress management app with Claude Code in six weeks | how-a-non-technical-project-manager-built-and-shipped-a-stress-management-app-with-claude-code-in-six-weeks
2026-04-30 | N | How Kepler built verifiable AI for financial services with Claude | how-kepler-built-verifiable-ai-for-financial-services-with-claude
2026-04-30 | R READ-NOW | Claude Security is now in public beta | claude-security-public-beta
2026-04-30 | N | Building AI agents for the enterprise | building-ai-agents-for-the-enterprise
2026-04-29 | R READ-NOW | Product development in the agentic era | product-development-in-the-agentic-era
2026-04-29 | N | Deploying Claude across the enterprise with Claude Cowork | new-guide-deploying-claude-across-the-enterprise-with-claude-cowork
2026-04-29 | N | Claude API skill now in CodeRabbit, JetBrains, Resolve AI, and Warp | claude-api-skill
2026-04-28 | R READ-NOW | Onboarding Claude Code like a new developer: Lessons from 17 years of development | onboarding-claude-code-like-a-new-developer-lessons-from-17-years-of-development
2026-04-23 | N | New connectors in Claude for everyday life | connectors-for-everyday-life
2026-04-23 | R READ-NOW | Memory for Claude Managed Agents: agents that learn across sessions | claude-managed-agents-memory
2026-04-22 | N | Building agents that reach production systems with MCP | building-agents-that-reach-production-systems-with-mcp
2026-04-20 | N | Meet the winners of our Built with Opus 4.6 Claude Code hackathon | meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon
2026-04-16 | R READ-NOW | Best practices for using Claude Opus 4.7 with Claude Code | best-practices-for-using-claude-opus-4-7-with-claude-code
2026-04-15 | R READ-NOW | Using Claude Code: session management and 1M context | using-claude-code-session-management-and-1m-context
2026-04-14 | R READ-NOW | Introducing routines in Claude Code | introducing-routines-in-claude-code
2026-04-14 | R READ-NOW | Redesigning Claude Code on desktop for parallel agents | claude-code-desktop-redesign
2026-04-10 | R READ-NOW | Preparing your security program for AI-accelerated offense | preparing-your-security-program-for-ai-accelerated-offense
2026-04-10 | R READ-NOW | Multi-agent coordination patterns: Five approaches and when to use them | multi-agent-coordination-patterns
2026-04-09 | N | The advisor strategy: Give Sonnet an intelligence boost with Opus | the-advisor-strategy
2026-04-09 | N | Making Claude Cowork ready for enterprise | cowork-for-enterprise
2026-04-08 | R READ-NOW | Claude Managed Agents: get to production 10x faster | claude-managed-agents
2026-04-08 | N | How Carta Healthcare built clinical AI with Claude | carta-healthcare-clinical-abstractor
2026-04-07 | R READ-NOW | How and when to use subagents in Claude Code | subagents-in-claude-code
2026-04-02 | R READ-NOW | Agent harness design: 3 patterns for harnessing Claude's intelligence | harnessing-claudes-intelligence
2026-03-30 | N | Audit Claude Platform activity with the Compliance API | claude-platform-compliance-api
2026-03-24 | R READ-NOW | Auto mode for Claude Code | auto-mode
2026-03-23 | N | Put Claude to work on your computer | dispatch-and-computer-use
2026-03-19 | R READ-NOW | Product management on the AI exponential | product-management-on-the-ai-exponential
2026-03-18 | N | Code with Claude comes to San Francisco, London, and Tokyo | code-with-claude-san-francisco-london-tokyo
2026-03-13 | N | 1M context is now generally available for Opus 4.6 and Sonnet 4.6 | 1m-context-ga
2026-03-12 | N | Claude builds interactive visuals right in your conversation | claude-builds-visuals
2026-03-11 | N | Advancing Claude for Excel and PowerPoint | claude-excel-powerpoint-updates
2026-03-09 | R prev-read | Code Review for Claude Code | code-review
2026-03-05 | N | Skills explained: How Skills compares to prompts, Projects, MCP, and subagents | skills-explained
2026-03-05 | N | Common workflow patterns for AI agents | common-workflow-patterns-for-ai-agents-and-when-to-use-them
2026-03-03 | N | Improving skill-creator: Test, measure, and refine Agent Skills | improving-skill-creator-test-measure-and-refine-agent-skills
2026-02-24 | N | Cowork and plugins for finance | cowork-plugins-finance
2026-02-24 | N | Cowork and plugins for teams across the enterprise | cowork-plugins-across-enterprise
2026-02-23 | R READ-NOW | How AI helps break the cost barrier to COBOL modernization | how-ai-helps-break-cost-barrier-cobol-modernization
2026-02-20 | R READ-NOW | Preview, review, and merge with Claude Code | preview-review-and-merge-with-claude-code
2026-02-17 | N | Improved web search with dynamic filtering | improved-web-search-with-dynamic-filtering
2026-02-12 | N | Claude Enterprise, now available self-serve | self-serve-enterprise
2026-02-09 | R READ-NOW | Harvey, Bolt, Shopify & Lovable test Claude Opus 4.6 pre-launch | behind-model-launch-what-customers-discovered-testing-claude-opus-4-6-early
2026-02-05 | N | Advancing finance with Claude Opus 4.6 | opus-4-6-finance
2026-01-30 | N | Customize Cowork with plugins | cowork-plugins
2026-01-29 | R prev-read | Measure Claude Code's impact with contribution metrics | contribution-metrics
2026-01-29 | N | A complete guide to building skills for Claude | complete-guide-to-building-skills-for-claude
2026-01-28 | N | How leading retailers are turning AI pilots into enterprise-wide transformation | how-leading-retailers-are-turning-ai-pilots-into-enterprise-wide-transformation
2026-01-28 | N | Updates to Claude Team | claude-team-updates
2026-01-26 | N | Interactive connectors and MCP Apps | interactive-tools-in-claude
2026-01-26 | N | How Anthropic uses Claude in marketing | how-anthropic-uses-claude-marketing
2026-01-23 | R READ-NOW | When to use multi-agent systems (and when not to) | building-multi-agent-systems-when-and-how-to-use-them
2026-01-22 | N | Building agents with Skills: Equipping agents for specialized work | building-agents-with-skills-equipping-agents-for-specialized-work
2026-01-21 | R READ-NOW | Eight trends defining how software gets built in 2026 | eight-trends-defining-how-software-gets-built-in-2026
2025-12-19 | N | Extending Claude's capabilities with skills and MCP | extending-claude-capabilities-with-skills-mcp-servers
2025-12-18 | N | Skills for organizations, partners, the ecosystem | organization-skills-and-directory
2025-12-12 | N | Making Claude a better electrical engineer | making-claude-a-better-electrical-engineer
2025-12-11 | R READ-NOW | Claude Code power user customization: How to configure hooks | how-to-configure-hooks
2025-12-09 | R READ-NOW | How enterprises are building AI agents in 2026 | how-enterprises-are-building-ai-agents-in-2026
2025-12-08 | N | How Anthropic uses Claude in legal | how-anthropic-uses-claude-legal
2025-12-08 | R prev-read | Claude Code and Slack | claude-code-and-slack
2025-12-01 | R READ-NOW | The key benefits of transitioning to agentic coding | key-benefits-transitioning-agentic-coding
2025-11-25 | R READ-NOW | Using CLAUDE.MD files: Customizing Claude Code for your codebase | using-claude-md-files
2025-11-20 | N | Claude: From chatbot to thinking partner | your-thinking-partner
2025-11-19 | N | How to create Skills for Claude: steps and examples | how-to-create-skills-key-steps-limitations-and-examples
2025-11-17 | R READ-NOW | How three YC startups built their companies with Claude Code | building-companies-with-claude-code
2025-11-14 | N | Structured outputs on the Claude Developer Platform | structured-outputs-on-the-claude-developer-platform
2025-11-12 | N | Improving frontend design through Skills | improving-frontend-design-through-skills
2025-11-10 | N | Prompt engineering best practices for 2026 | best-practices-for-prompt-engineering
2025-11-03 | N | Building AI agents for startups | building-ai-agents-for-startups
2025-10-31 | N | What is Model Context Protocol? Connect AI to your world | what-is-model-context-protocol
2025-10-30 | R READ-NOW | Introduction to agentic coding | introduction-to-agentic-coding
2025-10-30 | R READ-NOW | How Brex improves code quality and productivity with Claude Code | how-brex-improves-code-quality-and-productivity-with-claude-code
2025-10-30 | N | Building AI agents in healthcare and life sciences | building-ai-agents-in-healthcare-and-life-sciences
2025-10-30 | N | Building AI agents for financial services | building-ai-agents-in-financial-services
2025-10-28 | R READ-NOW | Fix software bugs faster with Claude | fix-software-bugs-faster-with-claude
2025-10-27 | N | How to integrate APIs seamlessly | integrate-apis-seamlessly
2025-10-20 | R prev-read | Claude Code on the web | claude-code-on-the-web
2025-10-16 | N | Introducing Agent Skills | skills
2025-10-16 | N | Claude and your productivity platforms | productivity-platforms
2025-10-15 | R READ-NOW | How to scale agentic coding across your engineering organization | scaling-agentic-coding
2025-10-10 | N | Build responsive web layouts | build-responsive-web-layouts
2025-10-09 | R READ-NOW | Customize Claude Code with plugins | claude-code-plugins
2025-10-08 | R prev-read | Beyond permission prompts: making Claude Code more secure and autonomous | beyond-permission-prompts-making-claude-code-more-secure-and-autonomous
2025-10-06 | R skimmed | Optimize code performance quickly | optimize-code-performance-quickly
2025-10-01 | N | How enterprises are driving AI transformation with Claude | driving-ai-transformation-with-claude
2025-10-01 | N | Claude and Slack | claude-and-slack
2025-09-29 | N | Managing context on the Claude Developer Platform | context-management
2025-09-29 | R READ-NOW | Building agents with the Claude Agent SDK | building-agents-with-the-claude-agent-sdk
2025-09-24 | N | Claude is now available in Microsoft 365 Copilot | claude-now-available-in-microsoft-365-copilot
2025-09-11 | N | Bringing memory to teams | memory
2025-09-09 | N | Claude can now create and edit files | create-files
2025-08-25 | N | Piloting Claude in Chrome | claude-for-chrome
2025-08-20 | R READ-NOW | Claude Code and new admin controls for business plans | claude-code-and-new-admin-controls-for-business-plans
2025-08-14 | N | Prompt caching with Claude | prompt-caching
2025-08-12 | N | Claude Sonnet 4 now supports 1M tokens of context | 1m-context
2025-08-06 | R READ-NOW | Automate security reviews with Claude Code | automate-security-reviews-with-claude-code
2025-07-25 | N | Build and share AI-powered apps with Claude | claude-powered-artifacts
2025-07-24 | R prev-read | How Anthropic teams use Claude Code | how-anthropic-teams-use-claude-code
2025-07-14 | N | Discover tools that work with Claude | connectors-directory
2025-06-25 | N | Turn ideas into interactive AI-powered apps | build-artifacts
2025-06-23 | N | Introducing citations on the Anthropic API | introducing-citations-api
2025-06-18 | R READ-NOW | Remote MCP support in Claude Code | claude-code-remote-mcp
2025-05-22 | N | New capabilities for building agents on the Anthropic API | agent-capabilities-api
2025-05-07 | N | Introducing web search on the Anthropic API | web-search-api
2025-05-01 | N | Claude can now connect to your world | integrations
2025-04-15 | N | Claude takes research to new places | research
2025-04-02 | N | Claude on Google Cloud’s Vertex AI: FedRAMP High and IL2 authorized | claude-on-google-cloud-fedramp-high
2025-03-20 | N | Claude web search now available globally on all plans | web-search
2025-03-13 | N | Token-saving updates on the Anthropic API | token-saving-updates
2025-03-06 | N | Get to production faster with the upgraded Anthropic Console | upgraded-anthropic-console
```

### b2. claude.dev/blog: all 15 posts

```
2026-10-08 | R prev-read | Building effective agent automations (Lance Martin, CJ Avilla) | https://claude.dev/blog/building-effective-agent-automations/
2026-10-06 | R prev-read | Claude Code in the cloud: a field guide to cloud sessions (Addy Osmani) | https://claude.dev/blog/claude-code-in-the-cloud/
2026-10-01 | N (scan)    | Getting started with Claude Code mods (tutorial; covered by the claude-code-mods announcement) | https://claude.dev/blog/getting-started-with-claude-code-mods/
2026-09-28 | N           | Building with Claude Sonnet 5.5 | https://claude.dev/blog/building-with-claude-sonnet-5-5/
2026-09-28 | N           | Automating eval design and hillclimbing with Claude | https://claude.dev/blog/automating-eval-design-and-hillclimbing/
2026-09-25 | R READ-NOW  | What a task costs on Opus 5.5 (Addy Osmani) | https://claude.dev/blog/what-a-task-costs-on-opus-5-5/
2026-09-25 | R prev-read | Using Claude Code: Spending your effort (Thariq Shihipar) | https://claude.dev/blog/spending-your-effort/
2026-09-23 | R prev-read | How we made claude.ai 3x faster in two weeks | https://claude.dev/blog/how-we-made-claude-ai-faster/
2026-09-22 | R READ-NOW  | Getting the most out of Opus 5.5 in Claude and Claude Code (Addy Osmani) | https://claude.dev/blog/getting-the-most-out-of-opus-5-5/
2026-07-24 | R READ-NOW  | The new rules of context engineering for Claude 5 generation models (Thariq) | https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/
2026-06-03 | R READ-NOW  | Lessons from building Claude Code: How we use skills (Thariq) | https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/
2026-06-02 | R READ-NOW  | A harness for every task: dynamic workflows in Claude Code (Thariq, Sid Bidasaria) | https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/
2026-05-20 | R READ-NOW  | Using Claude Code: The unreasonable effectiveness of HTML (Thariq) | https://claude.dev/blog/using-claude-code-the-unreasonable-effectiveness-of-html/
2026-04-30 | N           | Lessons from building Claude Code: Prompt caching is everything | https://claude.dev/blog/lessons-from-building-claude-code-prompt-caching-is-everything/
2026-04-10 | N           | Seeing like an agent: how we design tools in Claude Code | https://claude.dev/blog/seeing-like-an-agent/
```

### b3. claude.com/customers: 284 customer stories (undated pages)

Format: `slug | mark | headline`. Each URL is `https://claude.com/customers/<slug>`. The pages carry no publish dates. Internal evidence (model names, "Q1 2026") puts the office-hours pieces, Delivery Hero, League and LG CNS in 2026, and Graphite, Factory and CodeRabbit in 2024–2025.

```
adalat-ai | N | Adalat AI made India's courts accessible to millions.
advantage-solutions | N | Advantage Solutions gives frontline managers 70,000+ hours back each year.
advolve | N | Advolve cut operational work time 90%.
aes | N | AES generates audit results 96% faster.
airops | N | AirOps doubled team productivity with its AI content platform.
airtree | N | Airtree cut market research from two days to minutes.
alexa-plus | N | Alexa+ taps Claude's best-in-class safety and jailbreak resistance.
amazon-q-in-connect | N | Amazon Connect saves 10-15% of time on every customer contact.
amira | N | Amira drives 70% faster reading growth for students.
anything | N | Anything users built 800,000+ apps in five months.
apollo | N | Apollo boosts meeting bookings 35% with Claude messaging.
appfolio | N | AppFolio saves property managers 11 hours a week on communications.
armanino | N | Armanino cut manual writing time 65%.
artemis | R keyword-scan | Artemis increased threat detection coverage 90%.
asana | N | Asana cut engineering development cycles from years to weeks.
asana-qa | N | Asana built AI Teammates so agents and people work as one.
asapp | N | ASAPP improved core business metrics 25-40% over other AI models.
assembled | N | Assembled lifted customer satisfaction 20% while decreasing spend.
athena | N | Athena runs 10,000+ autonomous enterprise workflows weekly.
atlassian | N | Atlassian runs 5 million+ AI agents in customer workflows each month.
attention | N | Attention automates 90% of post-call sales work.
audience-strategies | N | Audience Strategies cut report creation from 3 months to 4 weeks.
augment-code | R keyword-scan | Augment Code compressed a project timeline from 4-8 months to 2 weeks.
aura | N | Aura hit 94% accuracy in classification tasks.
banner-health | N | 85% of Banner Health users report time savings.
base44 | N | Base44 grew to 2M+ users in under six months.
benchling | N | Benchling saves scientists weeks on data transformation.
binti | N | Binti cut social workers' report writing time 50%.
biomni | N | Biomni runs biomedical analysis 800x faster.
bito | R read-full | Bito cut pull request cycles 89%.
blank-metal-qa | N | Blank Metal trained 700+ people on Claude Cowork and runs 90% of its engineering through Claude Code.
block | R read-full | 75% of Block engineers save 8-10+ hours weekly.
blueflame | N | BlueFlame cut document analysis from hours to minutes.
bluenote | N | Bluenote accelerates regulatory docs 50-75%.
bolt | R keyword-scan | Bolt hit ~90% cache efficiency to reduce inference costs.
box | N | Box used the Claude Skills API to go from concept to customer-facing capability in weeks.
brainlabs | N | Brainlabs marketers authored ~400 Claude skills in four weeks.
braintrust | N | Braintrust drives 25% more applicants per role.
brand-ai | N | Brand.ai lets one copywriter manage 600 content pieces.
brex | N | Brex automates 75% of expense transactions at 94% compliance.
brian-impact-foundation | N | Brian Impact Foundation reviewed 100x more candidates.
bubble | N | Bubble doubled first-week activation for app builders.
bunq | N | bunq automates about 80% of support tickets.
campfire | N | Campfire cuts monthly close time by 3 days.
canva | N | Canva empowered 5,000+ employees across all teams.
carta-healthcare | N | Carta Healthcare cut clinical data abstraction time up to 66%.
carvana | N | Carvana cut production alerts 56% by fixing root causes.
caylent | R keyword-scan | Caylent cut database migration hours by 90%.
charm-industrial | N | Charm Industrial cut carbon credit verification from months to days.
chatandbuild | N | ChatAndBuild serves 140,000 users across 111 countries.
chatbase | N | Chatbase tripled user adoption after integrating Claude.
chatplace | N | ChatPlace saves creators 15-20 hours a week.
chronograph | N | Chronograph reached 100% adoption across 150+ employees.
circleback | N | Circleback saves teams hours daily on meeting insights.
circleci | R read-full | CircleCI cut average test run time 75%.
classdojo | N | ClassDojo reaches 45 million users in 180 countries.
classmethod | R keyword-scan | Classmethod cut code review time 80%.
clay | N | Clay saves teams hundreds of hours on data collection.
coderabbit | R read-full | CodeRabbit delivers code 86% faster, from days to hours.
codewords | N | CodeWords gets 92% of non-technical users building in one session.
cogent | N | Cogent cuts critical vulnerability exposure time 97%.
cognition | R keyword-scan | Cognition's Devin tripled merged PRs per week.
coinbase | N | Coinbase built 35-50 internal apps on its platform.
copy-ai | N | Copy.ai helps teams 4x content output.
cove | N | Cove delivers 30% faster response times.
cox-and-accenture | N | Cox Communications drove a 7x return on its first year of AI investment with Accenture.
cox-automotive | N | Cox Automotive doubled consumer lead responses and test drives.
cox-communications-qa | N | Cox Communications earned a 7x return on its first year of AI investment.
cred | N | CRED delivers features and fixes 2x faster.
crunched | N | Crunched cuts Excel modeling time over 50%.
cubic | R read-full | Cubic delivers code review feedback 60x faster.
cursor-qa | R keyword-scan | Cursor reaches 60% of the Fortune 500 with its coding platform.
cyera | N | Cyera reached 88% weekly active usage across 1,500 employees.
cyera-qa | N | Cyera runs 1,000+ events a year through agents and grew signups from 105 to 400+ in a day.
decagon | N | Decagon cut over-inferencing rates 70%.
deepgram | R keyword-scan | Deepgram cut incident triage from days to minutes, with power users shipping 4–10x more durable code.
delightai-qa | N | Delight AI cut production agent fixes from a week to 1-2 days.
delivery-hero | R read-full | Delivery Hero's agent merges 100+ pull requests a day.
descript | N | Descript lifted free-to-paid conversion 46% with its AI editor.
doctolib | R keyword-scan | Doctolib migrated legacy testing in hours instead of weeks.
dolly | N | Dolly cuts teacher marking time 60-70%.
doordash-boris-office-hours | R read-full | DoorDash co-founder and CTO Andy Fang joins Boris Cherny on raising AI fluency across all 4,000 employees. Wat
dust | N | Dust saved $10k a day on model spend after optimizing prompt caching.
duvo | N | Duvo captured €2.8M+ in savings for one retailer in 3 months.
dxc | N | DXC cut claims document backlogs from days to minutes.
elation-health | N | Elation Health cut time to first chart insight 61%.
emergent | R keyword-scan | Emergent hit $25M ARR in 4.5 months.
epic-systems | R keyword-scan | Over half of Epic's Claude Code usage comes from non-developers.
epilepsy-foundation | N | The Epilepsy Foundation created Sage, an AI assistant for trusted epilepsy answers 24/7.
epilepsy-foundation-qa | N | Epilepsy Foundation CTO David-Alexandre Jost shares how to ground AI in vetted content.
esentire | N | eSentire contains 99.96% of ransomware before encryption.
eve-legal | N | Eve Legal helps plaintiff law firms settle cases up to 60 days faster.
evenup | N | EvenUp cut document drafting from 15 hours to 15 minutes.
factory | R read-full | Factory saved customers 550,000 development hours.
figma | N | Figma turns ideas into working prototypes in minutes.
fountain | N | Fountain cut manual screening effort 50%.
freedom-forever | N | Freedom Forever hit 97.5% success automating permit workflows.
futurehouse | N | FutureHouse runs 4 specialized agents for scientific discovery.
gambit | N | Gambit hits 97% accuracy guiding cooks through recipes.
gamma | N | Gamma lifted user satisfaction 30% and conversions 20%.
garvan-institute-qa | N | Garvan Institute uses Claude to accelerate research on drug discovery and rare disease diagnosis. Read the Ben
gc-ai | N | GC AI saves legal teams 14 hours a week.
genspark | N | Genspark surpassed $250M ARR with its Super Agent.
gitlab | R keyword-scan | GitLab sees 25-50% productivity gains across workflows.
gitlab-enterprise | R keyword-scan | 98% of GitLab team members are satisfied with Claude.
grab | N | Grab cut negative merchant sentiment 25%.
gradial | N | Gradial turns 300+ hours of content ops into under 10.
gradient-labs | N | Gradient Labs hits 80-90% automated support resolution.
grafana | N | Grafana went from prototype to private preview in under 8 weeks.
graph | N | LaunchNotes identifies incidents 5x faster.
graphite | R read-full | Graphite speeds up code review 40x.
greptile | R read-full | Greptile catches 1 million code issues a month.
gumroad | N | Gumroad shipped 300% more features to production.
harvey | N | Harvey deployed Claude across its platform in under a month.
headstart | R keyword-scan | Headstart delivers software 10-100x faster.
hebbia | N | Hebbia serves a third of the top 50 asset managers.
hostinger | N | Hostinger users launch full websites in minutes, not weeks.
hubspot | N | HubSpot lifted productivity up to 40% across teams.
hubspot-qa | N | HubSpot compressed multi-week builds to three hours in Cowork.
humach | N | Humach lifted operational efficiency 15-20%.
hume | N | Hume powered 2M+ minutes of AI voice conversations.
ifs | N | IFS resolves equipment faults 25% faster.
ig-group | N | IG Group analysts save 70 hours a week.
impel | N | Impel AI cut new-product ramp time from 3 to 6 months to 1 month.
inscribe | N | Inscribe cut fraud review from 30 minutes to 90 seconds.
intercom | N | Intercom resolves up to 86% of support volume.
intuit | N | Intuit serves millions of TurboTax filers with AI explanations.
irc | N | The IRC built offline health dashboards with Claude Enterprise, cutting a full day of analysis to under 30 min
irc-qa | N | IRC's Kristy Crabtree on the Burkina Faso pilot turning paper health records into offline dashboards built wit
jakala | N | JAKALA cut campaign optimization from 5-7 days to under 24 hours.
jamf | N | Jamf reached 89% active usage in eight weeks.
jamf-qa | N | Jamf turns workflows into reusable tools in 45 minutes.
jetbrains | R keyword-scan | JetBrains improved refactoring success 59%.
jetbrains-2 | R keyword-scan | Jetbrains brought Claude's agentic coding natively into its IDEs.
jumpcut | N | Jumpcut saved 35,000+ hours of script reading.
juno | N | Juno helps people with chronic illness find patterns in their symptoms with Claude.
kai | N | Kai cut false positives 99.5% across 2.5 million findings.
kindora | N | Kindora grew to 328 nonprofits in months.
kodif | N | Kodif automates up to 90% of support tickets.
law-and-company | N | Law&Company reaches 20% of South Korea's practicing lawyers.
lazy-ai | R keyword-scan | Lazy AI cut code needing multiple fixes 51%.
league | R keyword-scan | League cut product development cycle times in half, from idea through pull request.
league-qa | N | League's CEO and AI leaders share why they went all in on Claude in regulated healthcare.
legora | N | Legora scored 18% higher on its legal evaluation set.
lex | N | Lex drew 25,000 signups within 24 hours of launch.
lg-cns | R keyword-scan | LG CNS migrated a 20-year-old enterprise system in 7 months at 50% of rebuild cost.
lindy | N | Lindy achieved 10x customer growth with Claude.
lokalise | N | Lokalise hit an 82.6% AI translation acceptance rate.
loreal | N | L'Oréal reaches 44,000 monthly users on its AI platform.
lotte-homeshopping | N | Lotte Homeshopping cut partner QA inquiries 30-40%.
lovable | R keyword-scan | Lovable reached $200M ARR in a year.
lyft | N | Lyft cut support resolution time 87%.
magicschool | N | MagicSchool reaches 7 million educators.
magicschool-qa | N | MagicSchool moderates 8-10M student messages a month for safety.
matillion | R read-full | Matillion completes pull requests 41% faster.
medgate | R keyword-scan | Medgate resolves bugs 90% faster with Claude Code.
mercy-corps | N | Mercy Corps teams saved 540+ hours in a single month during a 13-team pilot.
mercy-corps-qa | N | Mercy Corps on why AI's biggest shift for humanitarian work isn't speed but work that was never possible befor
micro1 | N | micro1 runs 3,000+ AI technical interviews a day.
mintlify | R keyword-scan | Mintlify increased engineering output 4x.
miro-qa | N | Miro got 99% of influencer content live in 48 hours and cut project tracking from 90 minutes to 10.
money-forward | R keyword-scan | Money Forward engineers save 7 hours a week.
mutiny | N | Mutiny tripled design satisfaction with AI sales assets.
n26 | N | N26 automates up to 70% of targeted customer-ops tasks.
n8n | N | n8n cuts 80% of the work out of building automations.
national-domestic-workers-alliance | N | National Domestic Workers Alliance helped 25% of beta testers negotiate a pay increase.
national-domestic-workers-alliance-qa | N | National Domestic Workers Alliance is building dignity-driven AI. Read the interview with co-founder Ai-jen Po
nbim | N | NBIM employees save 20% of their time each week.
nevis | N | Nevis saves advisors 5+ hours a week on admin.
newfront | N | Newfront cut document processing costs 60%.
notability | N | Notability turns students' notes into flashcards, quizzes, and summaries.
notion | N | Notion reduced costs by 90% and latency 85% with prompt caching.
notion-qa | N | Notion customers created 18,000 Claude agents in three weeks, 90% run on automations.
novo-nordisk | N | Novo Nordisk cut clinical documentation from weeks to minutes.
nri | N | NRI cuts Japanese document review time 50%.
offdeal | N | OffDeal lifted eval accuracy from 25% to 85%.
opusclip | N | OpusClip surfaced $200K+ in pipeline from one insight.
orange | N | Orange localizes manga 5-7x more efficiently.
otter | N | Otter summarizes 50 million meetings a year.
pacific-community-ventures | N | Pacific Community Ventures scaled its qualitative research 10x.
pacific-community-ventures-qa | N | Pacific Community Ventures is building an underwriting co-pilot to make fair lending faster.
palo-alto-networks | R keyword-scan | Palo Alto Networks lifted feature velocity 20-30%.
panorama | N | Panorama serves 25% of the U.S. student population.
panther | N | Panther cut alert fatigue up to 70%.
parcha | N | Parcha cut customer diligence from 3 months to 5 minutes.
pelanor | N | Pelanor grew 10x in six months.
pendo-qa | N | Pendo's agent hits a 90% success rate on PM-reviewed tasks.
pensive | N | Pensive delivers grading feedback 60x faster.
perplexity | N | Perplexity delivers answers 2x faster with Claude.
pictet | N | Pictet generates working prototypes in two hours instead of two weeks.
pjmf | N | The McGovern Foundation standardized grant reviews across 100+ funders.
postman | N | Postman saves developers up to 1,150 hours a year.
pratham-international | N | Pratham lifted grading accuracy from 30% to 80%.
praxis | N | Praxis drove a full letter-grade lift in class averages.
presien | N | Presien cut critical safety events 70%+ on job sites.
pressmaster | N | Pressmaster cut content production time 90%+.
pulpit-ai | N | Pulpit AI grew its customer base 200% in three months.
pwc-qa | N | PwC trained 400 consultants on Claude Code in one session.
qodo | R read-full | Qodo reviews 1 million pull requests a quarter.
qonto | N | Qonto sends bank transfers 2x faster.
qualified-health | N | Qualified Health screens a 2M-patient population for life-saving care.
quantium | N | Quantium cut proposal timelines from weeks to hours.
quantium-qa | N | Quantium hit 91% weekly usage across 1200 total users and 600 on Claude Code.
quillit | N | Quillit cut report writing time 80%.
rainn | N | A conversation with RAINN's CTO on expanding encrypted crisis support to Signal in 30 days.
rakuten | R keyword-scan | Rakuten cut feature time to market 79%.
rakuten-qa | R keyword-scan | Rakuten ships major releases every two weeks with agents.
ramp | R keyword-scan | Ramp shipped 1M+ lines of AI code in 30 days.
ramp-boris-office-hours | R read-full | Ramp CTO Rahul Sengottuvelu joins Boris Cherny on running agents across the whole engineering lifecycle. Watch
replit | R keyword-scan | Replit reached 50 million users building software without coding.
reversia | N | Reversia translates stores across 110+ languages at 99% accuracy.
rileybot | N | RileyBot gives K-12 students safe, transparent AI learning.
rising-academies | N | Rising Academies reaches 150,000+ students across Africa.
rocket | N | Rocket builds agency-grade websites for $200, not $20,000.
rocket-money | R keyword-scan | Rocket Money grew code commits 11x building its financial agent Rowan.
rocket-money-qa | R keyword-scan | Rocket Money runs its financial agent Rowan with near-zero hallucinations.
rogo | N | Rogo runs 50,000+ finance queries a day.
satispay | R keyword-scan | Satispay engineers write 75%+ of code with Claude.
scribd | N | Scribd lifted signups and subscriptions 7%.
section | N | Section gained 50% productivity across its team.
semgrep | R keyword-scan | Semgrep cut false-positive security alerts 20%.
sentry | R keyword-scan | Sentry shipped end-to-end bug fixing in weeks, not months.
sett | N | Sett cut playable ad production from a week to 75 minutes.
shopify | N | Shopify builds internal tools dramatically faster with Claude Code.
shortcut | N | Shortcut serves 100,000+ users across 1,000+ companies.
skillfully | N | Skillfully reduced hiring cycle time by 50% while decreasing costs.
skt | N | SK Telecom lifted LLM response quality 34%.
slack | N | Slack saves the average user 97 minutes a week through automation.
smartsheet | N | Smartsheet hit 1.76M MCP tool calls in 30 days.
snowflake | N | Snowflake hits 90%+ accuracy on complex text-to-SQL.
solvely | N | Solvely.ai increased pair-coding productivity by 5x.
sourcegraph | R keyword-scan | Sourcegraph lifted its code insert rate 75%.
sourcegraph-claude-for-work | N | Sourcegraph hits 95% accuracy identifying board feedback.
spellbook | N | Spellbook runs 530,000 contract reviews a month.
spotify | R read-full | Spotify cut code migration time up to 90%.
spotify-boris-office-hours | R read-full | Spotify VP of Engineering Niklas Gustavsson joins Boris Cherny on running agents across 20M+ lines of code. Wa
spring-new | N | Spring.new delivers 95-99% time savings on R&D projects.
stairwell | N | Stairwell processes 40,000+ characters of security data at once.
steno | N | Steno helps 1,200+ law firms analyze legal transcripts faster.
stripe | R read-full | Stripe rolled out Claude Code to 1,370 engineers.
stubhub | N | StubHub cut support wait times from 20 minutes to seconds.
studyfetch | N | StudyFetch keeps students on 240-day study streaks.
super-teacher | N | Super Teacher made its teams 2x more productive.
supermetrics | N | Supermetrics lets marketers query live ad data and adjust campaigns in Claude — 250% monthly user growth and 1
syracuse | N | Syracuse University hit 80-90% weekly active Claude usage.
syracuse-university | N | Syracuse University deployed Claude to 30,000 students and staff.
tabnine | R keyword-scan | Tabnine answers messages 50% faster and lifts conversions 20%.
tahoe-lead-removal-project | N | The Tahoe project removed 6 miles of toxic lead cable.
tasklet | N | Tasklet runs 450,000 agent actions a day.
telus | N | TELUS saved 500,000+ hours across its workforce.
thomson-reuters | N | Thomson Reuters delivers 3,000+ experts' knowledge via CoCounsel.
thomson-reuters-qa | N | Thomson Reuters pilots Cowork across everyday enterprise work.
tidio | N | Tidio automates 71% of its customer support.
tines | N | Tines delivers 10-100x gains on complex data transformations.
tldv | N | tl;dv grew revenue 500% with AI meeting intelligence.
tome | N | Tome saves sales reps hours of account research daily.
trellix | N | Trellix saves 8 hours for every 100 security alerts processed.
triple-whale | N | Triple Whale reduces reporting time by over 70%.
try | N | TRY cut routine task time 30% and hit 40% faster proposal development.
twilio-qa | N | A Twilio director built voice agents in 10 minutes with Claude Code.
vambe | N | Vambe boosts conversion rates 40-60% for 1,500+ businesses.
vanta | N | Vanta cut compliance remediation from weeks to days.
vapi | N | Vapi makes users 3x more likely to reach deep activation.
vega | N | Vega accelerates threat investigations 44x while cutting legacy SIEM costs by 82% with Claude.
vercel-qa | R keyword-scan | Vercel's Chief of Software built an ecosystem on the open skills standard.
vibecode | N | Vibecode users build production apps from their phone for $100.
warp | N | Warp's terminal has run 10M Claude Code sessions for 800K developers.
wedia-group | N | Wedia cut image metadata tagging time 90%.
windsurf | R keyword-scan | Windsurf processes 100M+ tokens per minute.
wiz | R keyword-scan | Wiz migrated 50,000 lines of Python in 20 hours.
wondr-health | N | Wondr Health compressed 30-60 minute onboarding into a 10-minute coaching conversation.
wordsmith | N | Wordsmith turns 4-day contract reviews into 4 minutes.
workato | N | Workato customers built 800+ MCP servers in 8 months.
wrtn | N | WRTN serves 4.5 million monthly active users.
ymca-south-australia | N | YMCA South Australia cut reporting from a day to 30 minutes.
yoodli | N | Yoodli helps reps close 23% more deals.
you-dot-com | N | You.com grew revenue 1000% and hit 1 billion queries.
zapia | N | Zapia grew to 2.5 million users in its first year.
zapier | N | Zapier hit 89% AI adoption and 800+ internal agents.
zapier-cowork-qa | N | Zapier teams ship dashboards and analyses in Claude Cowork.
zencoder | R read-full | Zencoder cut AI code churn 2x.
zendesk | N | Zendesk reached 1 million custom agent executions in 7 weeks.
zingage | N | Zingage cut after-hours labor costs 82% for home care.
zoom | N | Zoom improved meeting summary accuracy 14%.
```

### b4. Claude Code changelog

Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md. Release dates come from https://registry.npmjs.org/@anthropic-ai/claude-code (`time` field).

- Releases by month (npm): 2025-02 10, 03 28, 04 30, 05 35, 06 29, 07 27, 08 31, 09 29, 10 25, 11 20, 12 21; 2026-01 29, 02 29, 03 24, 04 29, 05 27, 06 30, 07 23, 08 29, 09 27, 10 (to Oct 9) 10.
- Classification: I pulled 289 forge-relevant feature or behavior lines. Their counts rise sharply in 2026: Jan 9, Mar 15, May 22, Jul 28, Aug 33, Sep 108, Oct 29. Section (c9) lists the R lines.

---

## (c) New findings from the newly read R posts

Article URLs are `https://claude.com/resources/articles/<slug>` and customer URLs are `https://claude.com/customers/<slug>`, unless a full URL is given. Every item below is **[read]** unless it is marked otherwise.

### c1. Where the bottleneck moved: review, verification and "mobilizing the organization", not code

- **The AI-native SDLC playbook** (Louis Claxton, Applied AI, 2026-08-21, `the-ai-native-sdlc-playbook`) is Anthropic's most complete public statement of the forge problem.
  - "Code is no longer the bottleneck … The bottleneck moves to the steps to the left and right of the build phase … plan, review/test, and deploy, which still run at human speed."
  - "Reviewing each line by hand made sense when a person had written it, but it can't keep up once agents write most of the diff."
  - "Security teams are sized for human output, so when agents multiply code output, either the review queue builds or code ships under-reviewed."
- **Modernization guide** (FDEs Jonah Ezekiel and Lexie Tonelli, 2026-09-23, `how-to-prepare-for-ai-driven-code-modernization-projects`):
  - Change management "processes … were built on the assumption that a human wrote each change and a human would review each diff. Once agents accelerate writing the changes, the bottleneck shifts from producing changes to mobilizing the organization around them."
  - "verification, not writing the change, is usually the larger share [of token cost] in a regulated environment."
- **Using LLMs to secure source code** (Eugene Yan and Henna Dattani, 2026-05-27, `using-llms-to-secure-source-code`):
  - "discovery is now straightforward to parallelize, and the bottleneck has shifted to verification, triage, and patching."
  - "with models capable of finding a hundred candidates before lunch, triage has become the bottleneck."
- **Comcast and Booz Allen** (2026-10-06, `how-comcast-booz-allen-use-claude-mythos-to-secure-their-codebases`). Comcast's CISO: "Validation of these volumes of findings is the new bottleneck." The assessment covered 258 systems and about 170M lines of code.
- **Datadog** (2026-07-21, `how-datadog-built-a-universal-machine-tool-for-claude-code`):
  - "Is your real bottleneck generation or verification? Assume verification."
  - After agents built Helix, a Kafka-comparable system, "in a few days", the VP of engineering said: "humans still have to coordinate to ship the work to production through tools and mechanisms built for humans."
  - Claude Code drives "at least two-thirds" of Datadog's AI-tool production code.
- **DoorDash CTO Andy Fang** (customer `doordash-boris-office-hours`, 2026) gives the clearest failure report in the corpus:
  - "people start complaining about, oh my gosh, how long it takes for the code to get merged … so many processes on CI/CD that we need to reimagine or overhaul."
  - "we've invested in AI code review agents … But now that there's so much code, people are kind of just rubber stamping the code reviews, based on whatever the agent's telling them … a lot more security-related issues are cropping up, not just at DoorDash. Industry wide."
  - Product, design and ship reviews are now "a huge friction point."
- **cubic** (`cubic`): "Code review became the biggest bottleneck for engineering teams … developers began trusting AI-generated code without proper review."
- **Delivery Hero** (`delivery-hero`): "If you churn out five times more changes to your production environment, you will have five times more incidents if the change failure rate remains at the same level."
- **Rakuten** (`working-at-the-frontier-rakuten`, 2026-07-20): "Adding more agents doesn't add judgment. So the faster the agents run, the more the organization's progress depends on a person closing the loop."
- **HumanLayer** (`building-companies-with-claude-code`, 2025-11-17): "Once you have multiple people on your team shipping AI-written code, you have a completely different type of problem … a communication, collaboration, tooling, and management problem."

### c2. Merge, landing and promotion: how Anthropic and customers gate agent changes

- **"Certificate" and "promotion policy"** (modernization guide, 2026-09-23). This is the closest public Anthropic analog to a landing layer.
  - *Certificate*: "the conditions that the changes must meet to be considered correct", each "checkable without a human in the loop". The conditions are:
    - original and Claude-written tests;
    - a coverage threshold and performance bounds;
    - "Independent adversarial reviews by Claude, each in a fresh context window";
    - computer-use checks for UI regressions;
    - differential output parity, and round-trip checks of persisted state and wire formats;
    - a staging soak period, clean scans, and a clean build.
  - The test for a good certificate: "whether [reviewers] would be comfortable merging on the certificate's evidence alone."
  - *Promotion policy*: "Agents will produce changes far faster than any human team can review them diff-by-diff. The promotion policy is a tiered review path … that sets the depth of human review for a change." Its rules:
    - "Tier changes by blast radius and agent confidence … Keep full human review for critical paths."
    - "Fix recurring flags at the source."
    - Design the review output format with the reviewers.
    - Route subject-matter experts "straight to the changes in the highest-risk tiers … without wading through large diffs."
  - Sign-off and blame: "Individual approvers hesitate to sign off because they carry the risk of a bad change … best to have the directive for the promotion policy come from the top … responsibility for a bug that reaches production is shared, not pinned on whoever approved the change."
  - Required evidence: "Every change traceable and PR linked to an agent transcript and certificate evidence"; "write only to modernization branches and no production credentials."
  - In-place uplifts on a live codebase use partitions "from the leaves inward; freezing and modernizing one partition at a time; and gating CI/CD so new commits cannot undo a partition once it has been modernized."
  - "reconciliation work … from other teams merging around you while the run is in progress" is named as a cost driver.
- **SDLC playbook gates** (2026-08-21):
  - "Anything the agent writes arrives as a PR through branch protection, and the agent has no route to push to main."
  - "The governing principle is that the agent may act up to the production gate and cannot pass it."
  - "Separation of duties is preserved, because the agent that wrote the code has no way to approve it."
  - Review findings "do not approve or block a PR on their own … A platform engineer who wants to gate merges on findings can read the severity counts that the check run publishes as a machine-readable tally."
  - Babysitting: "a custom slash command that sweeps the unresolved review comments and failing checks on the PR … until the PR is green and waiting only on code owner approval."
  - Proposed metric: "share of review comments resolved without a human touching the branch."
- **Anthropic security guidance** (2026-04-10, `preparing-your-security-program-for-ai-accelerated-offense`) goes further than the Code Review product. It says to "Add static analysis and AI-assisted code review to your continuous integration pipeline, and block merges on high-confidence findings. If false positives make this impractical, you should keep the check, but address the tooling." It also warns: "A two-week change-approval cycle for production patches is itself a security risk." See (d).
- **Spotify auto-merges without owner review** (`spotify-boris-office-hours`). Niklas Gustavsson: "we needed to change the expectations for teams: you might no longer be in the loop for these changes, we're going to be auto-merging most of these changes without you ever seeing the PR. So that meant having to build out much better test automation."
  - Fleet Management drives "around half of Spotify's pull requests" (`spotify`).
  - Spotify has "merged millions and millions" of automated PRs.
  - The Honk agent judge raised PR success "roughly 20–30% … to 80%" and was later removed as models improved.
- **Delivery Hero Herogen** (`delivery-hero`):
  - Flow: Jira ticket, then code, then tests, then PR. "A 'council of agents' that includes both Claude and Gemini reviews the code from different perspectives before a human does a final check."
  - More than 100 merged PRs a day, "about 9% of all PRs", at an 85% ticket success rate.
  - The 2026 goal is "Every fifth pull request that's merged."
- **CircleCI Chunk** (`circleci`): "a natural language task goes in, a validated pull request comes out … The customer receives a PR that is already 'green,' with the CI pipeline serving as attestation." "More than 4 in 5 Chunk tasks now trigger automatically at the point of failure."
- **Babysit-to-merge is standard internal practice at Anthropic.**
  - Skills catalog (claude.dev, 2026-06-03): "babysit-pr — monitors a PR → retries flaky CI → resolves merge conflicts → enables auto-merge"; "cherry-pick-prod — isolated worktree → cherry-pick → conflict resolution → PR with template"; "deploy-<service> — … gradual traffic rollout with error-rate comparison → auto-rollback on regression".
  - Boris Cherny (`ramp-boris-office-hours`): "I use a loop … for babysitting my pull requests, to fix the CI, and rebase them automatically."
  - Desktop app (2026-02-20, `preview-review-and-merge-with-claude-code`): "If you enable auto-merge, Claude will also attempt to merge PRs once all checks pass."
- **Rollout and landing as a self-scheduled agent loop** (`ramp-boris-office-hours`).
  - Boris: a dynamic workflow cut Anthropic CI "from … 18 minute P50 to 6 minute P50 … The code landed, then it waited a day and used a routine to schedule itself to run a day later to get that real production data … repeated this for days."
  - Claude Tag runs an experiment lifecycle: "land the PR … crank up the exposure … puts up another PR … I stamped the pull request, but the rest was just Claude."
- **The SDLC playbook's control loop** uses deterministic Western Electric bands. At 1σ it logs, at 2σ it diagnoses read-only, and at 3σ it proposes. The example: "When the CI test failure rate breaches 3σ, the agent quarantines the flaky test or opens a revert PR, and the review gate decides."

### c3. Parallel agents: practices, ceilings, and how collisions are avoided

- **The human review ceiling** (SDLC playbook):
  - "Two or three sessions is a sensible starting point. The practical ceiling is how many streams one person can review properly, so add sessions only while review is keeping up."
  - "Tasks that share files run in a single session, one after another."
  - "Each independent session knows nothing about the others, and the engineer steering them is the only thing they share."
  - Approval prompts during the build would put "a person back on the critical path of all the sessions running in parallel."
- **Field practice:**
  - Spotify's chief architect runs "5 and 10 tabs … a matrix of Claude sessions and matching terminals in a set of work trees."
  - Nuro: "three or four sessions running auto mode in parallel" (`auto-mode-in-production`).
  - DoorDash CTO: "a git work tree to basically allow myself to code in the repo without conflicts."
  - Commure: "a ~13-ticket initiative with Claude subagents in parallel, each owning a ticket and its PR" (`claude-code-guide-for-startups`).
  - League Swarm: "A lead agent … spawns a team of agents to execute it in parallel, running overnight. An engineer reviews the work the next morning."
- **Coordination without a forge primitive.** Cursor's Nate Schmidt: "before touching shared code, Schmidt has an agent read his teammate's recent commits and flag conflicts, so neither of them has to stop what they're doing to check in" (`working-at-the-frontier-cursor`).
- **Collision guidance:**
  - Subagents: "Two subagents editing the same file in parallel is a recipe for conflict" (`subagents-in-claude-code`).
  - Agent teams: "two teammates may edit the same file or make incompatible changes. The pattern requires careful task partitioning and conflict resolution mechanisms"; for shared state, "Duplicate work and concurrent writes have known engineering fixes (locking, versioning, partitioning). Reactive loops are a behavioral problem" (`multi-agent-coordination-patterns`).
  - Harness design: "Write tools like edit can include a staleness check so Claude doesn't overwrite a file that changed since it was last read" (`harnessing-claudes-intelligence`).
- **Serializing the expensive step.** In the Bun and Krieger migrations (`ai-code-migration`, 2026-07-16):
  - "a build daemon, which is the only process allowed to rebuild the binary. Fixers write patches; the daemon batches them, rebuilds once, re-runs the affected tests … serializes the most expensive operation instead of letting multiple agents trigger it independently."
  - The work queue is "rebuilt from disk every time … resumable by construction."
  - Rules over patches: "you add one sentence to the rulebook and regenerate the affected batch … the code never gets hand-patched."
- **Dynamic workflows** (claude.dev 2026-06-02; article 2026-05-28):
  - A workflow "can decide … whether subagents are run in their own worktree."
  - For migrations: "Spin off a subagent for every fix in a worktree to make the fix, then have another agent adversarially review, and merge them. Consider telling the agent not to use resource intensive commands so that you can maximally parallelize without running out of resources on your machine."
  - The default size guideline was cut over time: "fewer than 15 agents" (2026-07-24), then "medium size guideline from 15 to 10 agents", with small as the default on Pro (2026-09-14) [changelog].
- **Cost of parallelism:**
  - "multi-agent implementations typically use 3-10x more tokens than single-agent approaches."
  - "agents specialized by software development role (planner, implementer, tester, reviewer) … spent more tokens on coordination than on actual work" (`building-multi-agent-systems-when-and-how-to-use-them`, 2026-01-23).
  - "Agent teams in plan mode use about 7× the tokens of a standard session"; enterprise average spend is "about $13 per developer per active day … below $30 per active day" for 90% of users (claude.dev `what-a-task-costs-on-opus-5-5`).
- **Scale claims:**
  - Bun: "hundreds of agents working in parallel with two reviewers on each file."
  - Mike Krieger's port: "hundreds of agents, eight phase gates, three adversarial review rounds."
  - LG CNS: backend and frontend "on 24/7 parallel tracks" (`lg-cns`).
  - Caylent: "runs hundreds of Claude instances in parallel" [scan].

### c4. Throughput and authorship data (new numbers)

| Org | Claim | Source |
|---|---|---|
| Anthropic | "As of July 2026, more than 50% of all code submitted for pull requests at Anthropic is authored by our internal version of a Claude Tag-like system … all of it happens in ephemeral VMs … with a human review before anything lands" | `ciso-guide-to-agentic-ai` (2026-07-17) |
| Anthropic | Engineers "dispatched agents … to handle 500 bug fixes independently"; agent rosters including "a release manager agent" | `building-effective-human-agent-teams` (2026-06-24) |
| Anthropic | Individual developers "migrated 10 code packages … tens to hundreds of thousands of lines" in one month; Bun Zig to Rust: "A million lines … less than two weeks … 100% of Bun's existing test suite passing in CI before merge. Nineteen regressions surfaced after merge"; cost about $165k in tokens | `ai-code-migration` |
| Spotify | "73% of pull requests are now AI-authored"; "75% plus improvement in PR frequency"; 2,900 engineers; "4,500 production deployments every day"; 650+ agent PRs merged per month (earlier case study) | `spotify-boris-office-hours`, `spotify` |
| Delivery Hero | More than 100 merged agent PRs a day, about 9% of all PRs; Q1 2026 at 18x goal | `delivery-hero` |
| Ramp | "more agent sessions are now kicked off by automations than by humans" | `ramp-boris-office-hours` |
| Satispay | ">75% of code committed each month" generated with Claude | `satispay` |
| Deepgram | Durable code 4–10x for regular and power users, "while the heaviest use drove about 9x higher churn. So Deepgram set test-coverage standards for Claude-generated code higher, not lower" | `deepgram` |
| ClickHouse | Flaky-test and coverage agents "are now the #2 and #3 contributors to the ClickHouse repo" | `claude-code-guide-for-startups` |
| Artemis Security | "6,000+ PRs a week" | same |
| Wiz | "1.5x increase in merged PRs among top 100 contributors" | `wiz` [scan] |
| Classmethod | Merged PRs 108 (Jan) to 165 (May–Jun); "Mandatory AI-powered self-reviews before pull requests" | `classmethod` [scan] |
| Teams/Enterprise auto-mode adopters | "auto mode users ship about 25% more PRs" | `auto-mode-default-in-claude-code` |
| Gusto engineer | 2,425 Claude Code sessions since December | `auto-mode-in-production` |
| Survey of 500+ leaders | "86% deploy agents for production code" | `how-enterprises-are-building-ai-agents-in-2026` |
| Anthropic Societal Impacts | Developers use AI in "roughly 60% of their work" but can "fully delegate" only "0-20% of tasks" | `eight-trends-defining-how-software-gets-built-in-2026` |
| Warp | "10M Claude Code sessions run inside Warp to date, 400K+ per week" | `how-warp-builds-self-improving-agents-on-claude` |

### c5. Review as a product: mechanics, volume, and self-improving reviewers

- **Code Review service internals, as revealed by changelog fixes** [read, CHANGELOG]:
  - There is "the lighter merge-focused review" for clean merges from the base branch. A bug had given "pull requests with more than 100 Claude reviews … a full re-review on every clean merge from the base branch" (2.1.275, 2026-09-17).
  - "empty or content-identical pushes … are now skipped" (2026-09-15).
  - Repositories run in either "reviewed once per PR" or "review every push" mode.
  - "resolving a finding's thread … stops later reviews from counting it as open" (2026-09-10).
  - Reviews use the CLAUDE.md "version from the base branch" when the PR edits that file (2026-10-06). The PR cannot rewrite its own review rules.
  - A queued review is re-queued "when the pull request moved to a new base branch."
  - REVIEW.md has size limits and is reported in the check run.
  - Incomplete reviews are "not charged."
- **REVIEW.md** (SDLC playbook) runs three passes: bugs, security, and compliance against spec.md and plan.md. It caps nits ("at most five"), and a review "checks the eventual diff against" plan.md. Proposed metric: "how often the merged diff still matches the committed plan.md."
- **Third-party review volumes on Claude:**
  - Qodo: "1 million pull requests per quarter."
  - Sentry: "Near immediate reviews provided on over 600k pull requests a month."
  - CodeRabbit: "millions of pull requests monthly."
  - Greptile: "reviewing over a billion lines of code each month", with hooks "ensuring that every file in a pull request gets examined."
  - Graphite: actionable feedback on "one in five pull requests, nearing the industry standard of one in three receiving human comments."
  - Graphite's co-founder: "almost every company builds tooling on top of GitHub to improve it for teams."
- **Self-improving reviewers.** Warp's improver skill reads PR and issue feedback and "opened a PR editing the inner skill"; skill updates "flow through a normal PR/code-review workflow." Warp runs this across its OSS repo, with "hundreds of people contributing and we're doing thousands of code reviews." Its advice on bad feedback: "Assume it will be."
- **Reviewer focus shifts with model capability.** Ramp: "as the models get smarter, they stop making certain classes of mistakes. And so it's not worth spending your reviewer tokens on that anymore."
- **Human comprehension gates:**
  - Thariq Shihipar: "Reading the code diffs can only give me a light understanding … I only merge after I pass the quiz perfectly" (`a-field-guide-to-claude-fable-finding-your-unknowns`).
  - HTML PR walkthroughs: "Render the actual diff with inline margin annotations, color-code findings by severity" (claude.dev HTML post).
  - Artifacts can show "what merged on my team this week from the PRs" (`artifacts-in-claude-code`).
  - cubic orders PR files "by dependency relationships instead of alphabetical order."
- **Verification beats generation:**
  - "Verification skills have had the most measurable impact on Claude's output quality internally. It can be worth having an engineer spend a week just making your verification skills excellent" (claude.dev skills post).
  - Boris to Spotify: "one of the common mistakes I see is companies under-investing in how well that verification loop works."
  - Security verifier rule: run it "in a fresh container without a shared filesystem or conversation history"; "adding an adversarial verifier roughly halved the rate of non-exploitable findings … Requiring that verifier to also build a proof of concept … brought the false positive rate to near zero."

### c6. Permissions, sandboxes, identity, and security of the agent fleet

- **Auto mode data** (2026-08-07, `auto-mode-default-in-claude-code`):
  - "users approve 97% of permission prompts"; plans are rejected 39% of the time versus 3% for permissions.
  - In a study of 1,053 testers, humans caught 13.6% of dangerous commands against 89% for auto mode. Human catch rates fell from about 17% to about 5% after 50+ prompts.
  - Among flagged real sessions, unrequested harm at severity 7+ appeared in 6.3% of manual sessions versus 2.4% in auto mode.
  - "49.5% of active CLI users have manually created a Bash allow-rule"; "25% of interactive sessions start in bypass permissions mode."
  - The classifier now "checks whether the destination of a git push or pull request is public, private, or trusted," and sees git status before `git reset --hard`.
  - It became the default on Pro, Max and Team from Aug 14 2026, and "the default for all Claude Code internal usage at Anthropic."
  - The Trajectory Labs prompt-injection comparison against Codex (0/720 versus 5.83%) is vendor-commissioned.
- **Agent identity** (`agent-identity-access-model`, 2026-06-24):
  - Claude Tag "opens pull requests as the Claude GitHub App."
  - Permissions are per channel: "a channel member without direct access to the repo can ask Claude to read that repo, if the channel's profile grants Claude that permission."
  - Planned: "just-in-time credential grants" and an overlay that requires both the channel profile and the requesting user's permissions.
- **CISO framework** (`ciso-guide-to-agentic-ai`). There are four questions: untrusted content, actions and on whose behalf, blast radius, and observability. On delegated identity: "The middle of the spectrum, where an agent carries a person's delegated identity into systems that person is not watching, is where accountability gets ambiguous." And: "the environment the agent loop runs in should never hold a credential worth stealing."
- **Brain and hands split:**
  - Managed Agents keep "Tokens … in a separate vault, and a proxy fetches them"; "The agent never sees your key because the sandbox only holds a placeholder. The real key is attached at the network boundary, and only on requests to domains you allow" (`whats-new-in-claude-managed-agents`, `building-with-claude-managed-agents`).
  - NVIDIA OpenShell adds default-deny rules with a "policy prover" (`giving-companies-more-control-over-their-ai-agents-with-nvidia`).
- **Self-hosted execution:**
  - Claude Code self-hosted runners come in fixed or on-demand mode, and "each session runs in its own checkout" (`run-claude-code-sessions-on-your-own-compute`, 2026-08-06).
  - Managed Agents self-hosted sandboxes run on Cloudflare, Daytona, Modal ("hundreds of thousands of concurrent sandboxes") or Vercel.
- **Quarantine pattern** (claude.dev workflows): "barring the agents that read untrusted public content from taking high-privilege actions."
- **Org controls:**
  - Inference hooks give a DLP verdict on every prompt and tool response.
  - The Compliance API now covers Claude Code CLI and desktop sessions, but excludes Claude Code on the web and cloud-provider sessions.
  - The `sec-default` mod "stops mods that users install from … overriding your permission deny rules."
  - Changelog: "project settings cannot widen or turn off an admin-required sandbox" (2026-09-29); `/commit-push-pr` no longer auto-approves `--force/--amend/--no-verify` (2026-08-12).

### c7. Provenance, attribution and the artifact chain

- **Committed artifact chain** (SDLC playbook): "Each stage ends by writing one to version control (including intent.md, spec.md, plan.md, the diff and its tests, the PR with its review findings, and the incident record) … The chain of commits is also the audit trail: who asked for what, what the agent produced, and who approved it."
  - Commits as triggers: "an accepted intent.md triggers the requirements and design pass, an approved spec.md triggers plan mode, a merged PR triggers the pipeline."
  - Non-git users commit through a VCS connector.
  - For legacy trackers the minimum is "Linkage … All artifacts note the record ID and all legacy records contain the commit SHA."
  - Agent identity in CI: "Each non-interactive run acts under the agent's own identity, so the pipeline log separates what the agent did from what the engineer who triggered it did."
- **Claude Code attribution timeline** [CHANGELOG]:
  - `attribution` setting (2025-12-09).
  - Session-URL attribution on commits and PRs from web sessions (2026-01-15).
  - Sessions auto-linked to PRs made with `gh pr create`, plus `--from-pr` (2026-01-30).
  - Pasting a PR URL into `/resume` finds the session that created it, on GitHub, GHE, GitLab and Bitbucket (2026-04-28).
  - `attribution.sessionUrl` opt-out (2026-06-19).
  - `"attribution": false` hides all commit and PR attribution (2026-09-23).
  - Default trailer `Co-Authored-By: Claude Code` for non-Claude models (2026-08-28).
  - OTel `claude_code.pull_request.count` (2026-05-05).
- **AI context as a versioned artifact.** Skyline keeps "AI context in a separate repository … [that] applies to all branches and time points" (`onboarding-claude-code-like-a-new-developer-…`). Spotify keeps migration "prompts … version-controlled in Git."

### c8. Triggers: routines, loops, proactive agents

- **Routines** (2026-04-14, `introducing-routines-in-claude-code`) run on a schedule, through an API endpoint with its own token, or on GitHub webhooks.
  - "Claude opens one session per PR and will continue to feed updates from that PR to the session, so it can address follow-ups like comments and CI failures."
  - Examples: "Every night at 2am: pull the top bug from Linear, attempt a fix, and open a draft PR"; "every PR merged to a Python SDK triggers a routine that ports the change to the parallel Go SDK, and opens a matching PR."
  - Daily caps: 5, 15 or 25 runs depending on plan.
- **Loop taxonomy** (`getting-started-with-loops`, 2026-06-30): turn-based, goal-based (`/goal`), time-based (`/loop`, `/schedule`; "/loop 5m check my PR, address review comments, and fix failing CI"), and proactive. Rule: "Loops that write code need loops that check it."
- **Self-scheduling.** Boris: there are "dozens" of horizontal loops, such as "code review, babysitting a PR, addressing feedback … deleting dead code … a routine that runs every day."
- **Proactive share.** Cognition predicts "90% of agent sessions will be proactive ones that find a problem, scan the codebase, and message you with the fix" (`working-at-the-frontier-how-cognition-…`). At CircleCI, more than 4 in 5 agent tasks are auto-triggered at failure.
- **Background-agent PR defaults changed twice** [CHANGELOG]:
  - 2026-07-01: "Background agents … now commit, push, and open a draft PR when they finish code work in a worktree, instead of stopping to ask."
  - 2026-08-03: "commit and push to preserve work, open a draft PR only when the task calls for one … always end by reporting where the work lives."

### c9. Claude Code changelog: forge-relevant feature timeline [read, CHANGELOG + npm dates]

- **2025-10-20**: BashTool sandbox (Linux and macOS). **2025-10-30**: `allowUnsandboxedCommands` policy.
- **2026-02-05**: agent teams research preview. **2026-06-15**: TeamCreate and TeamDelete removed; every session has one implicit team.
- **2026-02-19/20**: `--worktree`, `isolation: worktree` for subagents and agent definitions, and `WorktreeCreate`/`WorktreeRemove` hooks "enabling custom VCS setup."
- **2026-02-28**: project config and auto memory shared across worktrees.
- **2026-03-14**: `worktree.sparsePaths` for large monorepos, plus auto-cleanup of worktrees "left behind after an interrupted parallel run."
- **2026-04-13**: stale agent worktrees removed when "PR was squash-merged."
- **2026-05-07**: `worktree.baseRef` fresh or head.
- **2026-05-15**: `worktree.bgIsolation: "none"` "for repos where worktrees are impractical."
- **2026-05-18**: worktree isolation for non-git VCS through hooks.
- **2026-06-08**: background sessions are told "shared-checkout edits are blocked until they enter a worktree."
- **2026-07-15**: approvals persist across worktrees.
- **2026-09-08**: parallel checkout for new worktrees on large repos.
- **2026-04-16**: `/ultrareview`, a cloud multi-agent review. **2026-05-21**: `/code-review` with effort levels and `--comment` inline PR comments. **2026-06-29**: five cleanup finders merged into one, about 25% fewer tokens. **2026-09-01**: `--comment` on GitLab MRs.
- **2026-05-11**: agent view. **2026-07-08**: agent view links each session to PRs it "edit[s], merge[s], comment[s] on, or push[es] to."
- **2026-05-28**: dynamic workflows. **2026-09-14**: workflows pause at usage limit and resume.
- **Aug–Sep 2026**: GitLab MR parity (URLs, footer badge, `glab` recognition) and secret redaction for GitLab token families.
- **2026-08-18 to 09-15**: `/autofix-pr` cloud sessions with "GitHub webhook delivery … for the PR."

### c10. OSS and vulnerability-report flood

- "as of May 22, 2026, we had disclosed 1,596 vulnerabilities. To our knowledge, 97 of these have been patched" (`using-llms-to-secure-source-code`).
- "Open-source maintainers are already receiving large volumes of low-quality automated reports, and many have started ignoring anything that looks AI-generated" (`preparing-your-security-program-…`).
- Anthropic's rules for reporters:
  - "A report should be sent only when a human has verified it and is willing to put their name on it."
  - "Disclose AI involvement upfront … in the first line."
  - Include a working reproduction and a proposed patch.
- Maintainers should publish SECURITY.md with an intake process.
- "Plan for an order-of-magnitude increase in finding volume … If your security meetings are still built around a spreadsheet and a weekly meeting, it's unlikely that you'll keep up."
- Brute-force parallel discovery produced "tons of issues", most of them duplicates. The fix is to partition the search space before fanning out, and to dedupe by root cause. One method: check whether "the patch for one finding also disarms the PoCs of others."

---
## (d) What contradicts or sharpens the existing report claims

1. **Two Anthropic posts four days apart describe internal agent authorship differently.**
   - CISO guide (Jul 17 2026): "more than 50% of all code *submitted for pull requests* … authored by our internal version of a Claude Tag-like system … with a human review before anything lands."
   - SDLC post (Jul 21, summarized in 02): "More than half of all code is being *merged* by our internal version of Claude Tag" and "a risk-weighted sample is reviewed by humans."
   - "Human review before anything lands" and "risk-weighted sample" do not say the same thing.
   - **Sharpen:** quote both, and say Anthropic's public wording is inconsistent on whether every agent PR gets human review.
2. **Anthropic's review product does not block merges, but Anthropic's security advice says to block them.**
   - The 02 report says Code Review "never blocks merging."
   - The Apr 2026 security guidance says: "block merges on high-confidence findings … keep the check, but address the tooling."
   - The SDLC playbook offers a middle path: the check run publishes "severity counts … as a machine-readable tally" that a platform engineer can gate on.
   - **Sharpen:** the product is non-blocking by design and pushes the merge-gating decision to the forge's branch protection. Anthropic does recommend blocking for high-confidence security findings.
3. **The Bun numbers changed between posts.**
   - May 28: "roughly 750,000 lines of Rust … 99.8% of the existing test suite passing … eleven days … not yet in production."
   - Jul 16: "A million lines … less than two weeks … 100% … passing in CI before merge. Nineteen regressions surfaced after merge … shipped inside Claude Code in June."
   - **Use the July figures**, and note that passing 100% of tests still let 19 post-merge regressions through. That supports the claim that test-green does not mean safe, and the case for soak periods.
4. **The merge-conflict gap is confirmed, and the workarounds are all polling loops.**
   - The report quoted the docs: GitHub does not emit a webhook when the base branch advances.
   - The new posts show how people cope:
     - Boris: "a loop … for babysitting my pull requests, to fix the CI, and rebase them automatically."
     - The internal `babysit-pr` skill "resolves merge conflicts → enables auto-merge."
     - Code Review runs a "lighter merge-focused review" on base merges.
   - **Sharpen:** conflict handling at Anthropic is a timed loop plus re-review, not an event-driven forge primitive.
5. **Parallelism is bounded by review, and Anthropic's own defaults moved down.**
   - The playbook advises "Two or three sessions … add sessions only while review is keeping up."
   - The dynamic-workflow default guideline fell from fewer than 15 agents to 10.
   - Multi-agent setups cost 3–10x the tokens, and agent teams about 7x.
   - Role-split agents "spent more tokens on coordination than on actual work."
   - **This qualifies** the "hundreds of agents" migration stories. Those work because the work units are independent files, judged by a mechanical referee and a single-writer build daemon.
6. **Human review degrades into rubber-stamping, now on record from a CTO.** DoorDash's Andy Fang says people rubber-stamp "based on whatever the agent's telling them" and that security issues are rising industry-wide. This **strengthens** the report's claim that human attention is the scarce resource. It also counts against relying on AI review plus a cursory human approval.
7. **Auto-merge without owner review is already mainstream at a large company.**
   - Spotify auto-merges most fleet changes "without you ever seeing the PR."
   - About half of Spotify PRs go through Fleet Management, and 73% of PRs are AI-authored.
   - Delivery Hero runs a council of models, Claude and Gemini, before a final human check.
   - **Sharpen** any report claim that humans approve every merge. That holds at Anthropic for some codebases but not across the industry.
8. **Per-action human approval is now empirically discredited.** Humans approve 97% of prompts and catch 13.6% of dangerous commands, against 89% for the classifier. This **supports** the design move from per-action prompts to policy plus classifier plus sandbox. The source is an Anthropic-run study, so tag it as vendor data.
9. **Policy comes from the base branch.** Code Review reads CLAUDE.md "from the base branch" when a PR edits it. This is a concrete forge design rule: a change must not be able to alter the policy that judges it. It matches the report's trust model and should be cited as prior art.
10. **Draft-PR defaults flip-flopped.**
    - Jul 1: background agents auto-open draft PRs.
    - Aug 3: only "when the task calls for one."
    - [inference] This signals PR-noise concerns. It supports the report's point that the PR is a poor unit for agent output, and its "threads not PRs" discussion.
11. **Provenance trailers are opt-out.** `"attribution": false` (Sep 23) removes all commit and PR attribution. A forge **cannot rely on client-side trailers** for provenance. It needs server-side identity, such as the GitHub App identity, agent service accounts, and session linkage.
12. **Anthropic's FDEs independently name the landing-layer concepts.** "Certificate" and "promotion policy", tiered by "blast radius and agent confidence", with every PR "linked to an agent transcript and certificate evidence." This is **strong corroboration** for the report's landing-layer and evidence-bundle design. It is a field-tested pattern from regulated customers, not a speculative proposal.
13. **Gaming and churn risk shows up in customer data.** Deepgram's heaviest Claude users had "about 9x higher churn", and Deepgram raised test-coverage standards for AI code. DoorDash calls code throughput "a gameable metric." Both **support** the report's caution about throughput metrics, such as Anthropic's "8x code shipped."
14. **Forge-agnosticism is growing.** Claude Code added GitLab MR parity across Aug and Sep 2026, and Bitbucket in `/resume`. The managed Code Review and Claude Security products still require the GitHub App. [inference] Anthropic hedges on the client side but builds managed services on GitHub.
15. **Each PR gets its own VM.** Ramp's Inspect: "every PR now comes with its own VM and it's running for a little while so people can take over sessions, collaborate, it's all link based. It's all multiplayer." This **sharpens** the report's preview-environment and stateful-preview claims (file 29). It is a production example of a session-per-PR, multiplayer forge surface built outside GitHub.

---

## (e) What could not be accessed or was only partially covered

- **RSS feeds:** `https://claude.com/blog/rss.xml` and `https://claude.dev/blog/rss.xml` and `/blog/index.xml` all return 404. `https://claude.dev/rss.xml` and both sitemaps work and were used.
- **The claude.com/resources/articles index** renders its list client-side. Pagination with `?page=N` returned overlapping featured content, so I used the sitemap plus per-page `article:published_time` instead. Nothing was blocked.
- **Customer story pages have no publish date.** I could not place them precisely in the 2025-01-01 to 2026-10-12 window. 17 were read in full and 38 keyword-scanned; the other 229 were classified N by title and description only. Some QA pages, such as `asana-qa`, `notion-qa`, `twilio-qa` and `miro-qa`, were not opened.
- **Not fetched:**
  - PDFs: the AI-native SDLC playbook PDF, the startup-guide PDF, the "2026 Agentic Coding Trends Report", the "2026 State of AI Agents Report", and the Code Modernization Playbook. The HTML versions of the first two were read.
  - Webinars and videos: Warp, Datadog, CodeRabbit, the Code w/ Claude keynotes, and "Secure the Advantage".
  - The migration starter kit and the defending-code reference harness repos.
  - Jarred Sumner's own Bun write-up.
- **Changelog coverage** came from the GitHub CHANGELOG.md, not the `code.claude.com` docs changelog page. I classified feature lines by keyword, so bug-fix lines that reveal mechanics may be under-sampled beyond the Code Review ones quoted.
- **Localized article copies** (ja, ko, de, fr, it, es) were excluded as duplicates.

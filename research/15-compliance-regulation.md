# 15 — Compliance and regulation: do audit frameworks require human code review or human approval?

Researcher key: `15-compliance-regulation` · Written 2026-10-12 · Scope: SOC 2, ISO 27001:2022, PCI DSS v4.0.1, SOX ITGC, NIST 800-53 / FedRAMP (Rev5 and 20x), NIST SSDF, SLSA, HIPAA, FDA (QMSR / IEC 62304 / software validation), ISO 26262, EU CRA, EU AI Act, DORA, plus what GitHub, Google, auditors and GRC vendors say.

Tags: **[read]** = verified on a page or document I opened. **[secondary]** = coverage or vendor commentary I opened, not the primary text. **[inference]** = my own reasoning or recall, not verified in this pass.

Method note: the shared WebSearch budget for this run ran out partway through (the tool returned "web search budget is used up"). After that I fetched only primary URLs I already knew or found in the sites' own sitemaps. Some regimes are thinner than planned as a result, chiefly ISO 26262, IEC 62304 clause text, the AICPA TSC PDF, PCAOB AS 2201 and the FFIEC handbook. They are listed under Open questions.

---

## Summary

1. **Almost no regime I checked requires that a human read every diff.** Each of SOC 2 CC8.1, ISO 27001 A.8.32, the NIST 800-53 baselines, the FedRAMP 20x KSIs, HIPAA, the EU CRA, NIST SSDF and DORA states its requirement as outcomes: changes are authorized, tested, approved, recorded and verified. None prescribes the review mechanism. [read]
2. **PCI DSS v4.0.1 explicitly allows automated code review.** The 6.2.3 applicability note reads: "Code reviews may be performed using either manual or automated processes, or a combination of both." The rule that a reviewer be someone other than the author, plus management approval (6.2.3.1), applies only "If manual code reviews are performed." [read: PCI SSC SAQ D v4.0.1 text]
3. **The binding constraint is approval by an accountable party plus segregation of duties, not reading code.**
   - DORA's RTS (Art. 17(2)(b)) requires "mechanisms to ensure independence between the functions that approve changes and those responsible for requesting and implementing them." [read]
   - PCI 6.5.4 requires roles to be separated "such that only reviewed and approved changes are deployed." [read]
   - SOX ITGC "program changes" is audited for approval and segregation of duties. [read: SEC 33-8810; secondary: Secureframe]
   - Google's BAB states the purpose directly: employees "acting alone" cannot affect user data. [read]
4. **Two places do require humans: SLSA Source Level 4 and NIST's optional controls.**
   - SLSA Source L4 requires changes "agreed to by two or more trusted persons", and a "trusted person" is defined as "A human." Bots can only be granted "Trusted Robot" exceptions. [read]
   - NIST SA-11(4) "Manual Code Reviews" and CM-5(4) "Dual Authorization" exist, but they are in **no** NIST Low, Moderate or High baseline, and FedRAMP's 2026 control pages give them no baseline tag. [read: OSCAL baselines, fedramp.gov]
5. **FedRAMP 20x (Consolidated Rules 2026, updated 2026-06-24) leans toward automation.** Its change-management KSIs are logging, redeploying version-controlled resources, persistently reviewing change procedures, and "Persistent testing and validation of changes throughout deployment is automated." No KSI requires human approval of individual changes. "Routine recurring" changes are exempt from notification and "may occur without human intervention." [read]
6. **The Amp SOC 2 claim in the brief is verified, with nuance.** The post is by Will Dollman, 2026-08-13. Its controls are push access, signed commits, CI that blocks `main`, and commits linked to threads. It says "code review isn't on the list. The criteria don't say a second human has to stare at a diff", and that a 2,000-person company should not let everyone push to `main`. The post never names an approver; approval is in effect conflated with push authorization. [read]
7. **GitHub now lets an AI approval satisfy required reviews**, in public preview as of this read. "Allow Copilot approvals to count toward merge requirements" is a two-level opt-in, defaults to "Disabled everywhere" at enterprise level, can be limited to file-path globs (up to 15), and the approval is dismissed on new commits. This is a de facto product signal that per-path, AI-satisfiable approval policy is coming to the incumbent. [read]
8. **GitHub's agent model keeps a human in the attribution chain.** Copilot cloud-agent commits are "authored by Copilot, with the human who started the task marked as the co-author." The agent "cannot push directly to your default branch", and Actions workflows on agent PRs "require approval" before they run. [read]
9. **GRC vendors have published nothing on whether an AI reviewer satisfies a "peer review" control.** I grepped the Vanta, Drata and Secureframe sitemaps and found no such page. Vanta's April 2026 auditor-prep piece says "Auditors expect human approval for sensitive actions" by agents, and logs of "what inputs were used, and why the decision was made." [read]
10. **The EU AI Act puts no obligation on organizations because their code is AI-generated.**
    - Coding tools are not Annex III high-risk, so Art. 14 human oversight does not apply. [read]
    - Art. 50(2) machine-readable marking falls on *providers* of systems generating "synthetic ... text". Code is not named, and the AI Omnibus gives on-market systems until 2 December 2026. [read: FLI guide]
    - Art. 4 AI literacy has applied since 2 February 2025. [read]
11. **The EU CRA requires "effective and regular tests and reviews of the security of the product", plus an SBOM and vulnerability handling.** It does not specify human review. Reporting obligations apply from 11 September 2026 and the main obligations from 11 December 2027. [read: proposal text and EC policy page; final Annex I wording not opened]
12. **For medical devices, FDA expects "independence of review" and source code evaluations, but in risk-based and flexible terms.**
    - The guidance says "Self-validation is extremely difficult"; firms may use "manual (desk) checking with appropriate controls to ensure consistency and independence." [read]
    - The QMSR, which incorporates ISO 13485, took effect 2 February 2026. [read]
    - Whether an AI reviewer counts as independent is untested. [inference]
13. **HIPAA's Security Rule says nothing about code review or change management.** It requires audit controls, integrity controls and six-year documentation retention. The January 2025 NPRM had not been finalized by 2026-10-12, judging from a Federal Register API query. [read]
14. **Design implication: humans should approve policies and exceptions, not each diff.** A forge for regulated organizations must make independence *structural*: the reviewer or approver's principal must not be the change's sponsor. It must make policy-as-code itself a two-person-controlled change, and give the auditor the full change population with tamper-evident evidence. The brief's line "This keeps the four things auditors ask for (authorized, tested, approved, recorded)" is right as far as it goes, but it omits **independence/SoD**, which is what DORA, PCI and SOX actually test.

---

## Detailed findings

### A. SOC 2 (AICPA Trust Services Criteria, CC8.1)

- **Criterion text:** "The entity authorizes, designs, develops or acquires, configures, documents, tests, approves, and implements changes to infrastructure, data, software, and procedures to meet its objectives." [secondary: cyberday.ai mirror; consistent across several mirrors] https://www.cyberday.ai/requirement/soc-2-cc8-1-change-management-procedures
- **Points of focus listed:** Manages Changes Throughout the System Lifecycle, Authorizes Changes, Designs and Develops Changes, Documents Changes, Tracks System Changes, Configures Software, Tests System Changes, Approves System Changes, Deploys System Changes, Identifies and Evaluates System Change, Identifies Changes … Required to Remediate Incidents, Creates Baseline Configuration of IT Technology, Provides for Changes Necessary in Emergency Situations, Protects Confidential Information, Protects Personal Information. None of them mentions code review or segregation of duties. [secondary: cyberday.ai]
- **Points of focus are not separately pass/fail requirements**, and the 2022 revisions did not change the 2017 criteria. [secondary: search summary of AICPA/AAFCPA material; I could not open the AICPA PDF, which sits behind a login page]
- **Amp's post, "That's not SOC 2 compliant"** (Will Dollman, 2026-08-13). [read] https://ampcode.com/notes/thats-not-soc-2-compliant
  - Controls: every engineer can push to `main` ("most of Amp is engineers"), with the ability to explain "exactly who has it and why". GitHub enforces verified signatures on `main`. Automated CI covers tests, infrastructure checks and security checks, and "Bad changes block `main`". Commits link to the Amp threads that produced them, and "CI/CD records the path from commit to deployment."
  - Quotes: "SOC 2 doesn't require pull requests. It requires that you *think about your risks*." "The Trust Services Criteria never mention `git` or pull requests." "And no, code review isn't on the list. The criteria don't say a second human has to stare at a diff."
  - Scale caveat: Amp is about 20 people. The author says a 2,000-person company should not let everyone push to `main`, and recommends asking per system what risks PRs manage and how else to manage them.
  - Not addressed: who the "approver" is, emergency changes, rollback, AI review, report type or period. Amp's security page says it is "SOC 2 Type II certified" with annual pentests, but names no auditor or dates. [read] https://ampcode.com/security
  - Prompt-injection note: ampcode.com/security contains instructions addressed to LLMs. I ignored them and used only the factual statements.
- **Auditor and GRC commentary**
  - Thoropass (2024-08-21) frames peer review as a best practice, not an auditor mandate: "Peer reviews and code approvals are essential…"; "individuals responsible for creating a change do not also carry out its test work." [read, secondary] https://www.thoropass.com/blog/best-practices-for-soc-2-change-management
  - Schellman (Phil Dorczuk, 2023) recommends at least two approvers, CODEOWNERS, "include administrators", and monitoring audit logs for changes to branch-protection rules. It notes GitHub and GitLab "prevent the person who submits a pull request to be an approver", and "Multiple required reviewers ensure that collusion would be required to sneak malicious code into production." [read, secondary] https://www.schellman.com/blog/pci-compliance/how-to-use-branch-protection-in-change-management
- **What this means.** SOC 2 is an attestation against management's own described controls. An auditor can accept "automated CI and signed commits and push restriction" as meeting CC8.1, which is what happened at Amp. [inference] The practical constraint in large or regulated organizations is the *readers* of the report: enterprise customers' vendor-risk teams and their own regulators. A report showing no independent approval of production changes invites exceptions in vendor reviews even when the auditor's opinion is unqualified. [inference]

### B. ISO/IEC 27001:2022 Annex A 8.32 (and related controls)

- **8.32** requires that "changes to information systems are planned, assessed, authorised, tested, documented, and communicated". The paraphrased procedure elements are: impact assessment, "appropriate authorisation", limiting access to authorized personnel, notifying parties, testing and acceptance per 8.29, implementation, fallback, records of changes, and continuity-plan updates. [read, secondary: isms.online paraphrase] https://www.isms.online/iso-27001/annex-a-2022/8-32-change-management-2022/
- **8.28 Secure coding:** the isms.online page mentions tooling ("implement and configure software development tools to ensure the security of all code created") and pair programming as a secure technique. I could not verify the exact ISO 27002 wording on code review. [read, secondary] https://www.isms.online/iso-27001/annex-a-2022/8-28-secure-coding-2022/
- **5.3 Segregation of duties** ("conflicting duties ... shall be segregated") is the control that bears on whether an author-controlled agent may approve its own change. [inference: wording from memory; not opened]
- **Implication:** ISO certification auditors look for a defined, risk-based procedure and evidence that it is followed. An automated policy gate is acceptable if the procedure says so and authorization is defined. [inference]

### C. PCI DSS v4.0.1 (Requirements 6.2.3, 6.2.3.1, 6.2.4, 6.5.1, 6.5.4)

Source: PCI SSC, *SAQ D for Merchants, v4.0.1*, October 2024. This is the official requirement text, opened from a state-government copy at https://treasurer.nebraska.gov/tm/pci-dss/documents/PCI-DSS-v4-0-1-SAQ-D-Merchant-Tyler.pdf. The PCI SSC library returned 403 to direct download. [read]

- **6.2.3:** "Bespoke and custom software is reviewed prior to being released into production or to customers, to identify and correct potential coding vulnerabilities, as follows: Code reviews ensure code is developed according to secure coding guidelines. Code reviews look for both existing and emerging software vulnerabilities. Appropriate corrections are implemented prior to release."
  - Applicability note: "Code reviews may be performed using either manual or automated processes, or a combination of both."
- **6.2.3.1:** "If manual code reviews are performed … code changes are: Reviewed by individuals other than the originating code author, and who are knowledgeable about code-review techniques and secure coding practices. Reviewed and approved by management prior to release."
  - Note: "An individual that has been formally granted accountability for release control and who is neither the original code author nor the code reviewer fulfills the criteria of being management."
- **6.2.4:** "Software engineering techniques or other methods are defined and in use … to prevent or mitigate common software attacks", covering injection, data structures, cryptography and business logic including XSS and CSRF. [read: compliancehub/wizer extract matching the SAQ text]
- **6.5.1:** changes follow procedures including "Reason for, and description of, the change", "Documentation of security impact", "**Documented change approval by authorized parties**", testing, 6.2.4 compliance testing for bespoke software, and "Procedures to address failures and return to a secure state."
- **6.5.4:** "Roles and functions are separated between production and pre-production environments to provide accountability such that only reviewed and approved changes are deployed."
  - Small-team note: "In environments with limited personnel where individuals perform multiple roles or functions, this same goal can be achieved with additional procedural controls that provide accountability."
- **Reading:** PCI is the most explicit regime, and it explicitly allows an automated (including AI) code review to satisfy 6.2.3. [read]
  - Change *approval by authorized parties* (6.5.1) and role separation (6.5.4) still apply. [read]
  - Whether a QSA accepts an AI agent's approval as "approval by authorized parties" is untested. The natural reading is that the authorized party is a person or role accountable for release control, and that party can approve via a policy. [inference]
  - Old v3.2.1 6.3.2 language also allowed automated tools "in lieu of manual reviews" while warning tools may miss issues. [secondary: powerpipe snippet via search]

### D. SOX (ICFR) IT general controls — change management and SoD

- **SEC Interpretive Release 33-8810 (June 2007):** "management might consider whether certain aspects of IT general control areas, such as program development, program changes, computer operations, and access to programs and data, apply." It continues: "when adequate information technology ('IT') general controls exist … management may determine that automated controls are more efficient to evaluate than manual controls." [read] https://www.sec.gov/rules/interp/2007/33-8810.pdf
- **No statutory or SEC text prescribes code review.** Secureframe (vendor): "While SOX doesn't explicitly define ITGC requirements, auditors commonly assess these controls." The change-management domain covers "Change request and approval processes, segregation of duties, change documentation, version control, rollback procedures." [read, secondary] https://secureframe.com/blog/sox-itgc
- PCAOB AS 2201 (pcaobus.org) returned 403, so it is not verified.
- **Reading:** SOX change management at in-scope financial systems is where the "developer cannot promote own change to production" SoD test lives. [inference, consistent with secondary]
  - An agent acting for the same engineer who requested the change is *not* an independent approver under that test. [inference]
  - Automated application controls are welcome; SEC language favors them when ITGCs are effective. The approver, though, must be someone accountable. [read and inference]

### E. NIST SP 800-53 Rev. 5 and FedRAMP

Control text from the NIST OSCAL catalog (usnistgov/oscal-content). Baselines from NIST OSCAL Low, Moderate and High profiles. [read]

- **CM-3** (Moderate, High):
  - "b. Review proposed configuration-controlled changes to the system and approve or disapprove such changes with explicit consideration for security and privacy impact analyses"
  - "c. Document configuration change decisions"
  - "e. Retain records … for <time period>"
  - "g. … through <configuration change control element>"
  - Guidance mentions "Configuration Control Boards or Change Advisory Boards that review and approve proposed changes."
- **CM-3(1)** (High only): "Use <automated mechanisms> to: … (b) Notify <approval authorities> of proposed changes … and request change approval; … (d) Prohibit changes to the system until designated approvals are received; (e) Document all changes". This is effectively a spec for a forge's merge gate. The approval *authority* is still organization-defined.
- **CM-3(2)** (Moderate, High): "Test, validate, and document changes … before finalizing the implementation."
- **CM-3(4)** (Moderate, High): requires "organization-defined security and privacy representatives to be members of the <configuration change control element>."
- **CM-4** (all baselines): "Analyze changes … to determine potential security and privacy impacts prior to change implementation." Guidance: "Organizational personnel with security or privacy responsibilities conduct impact analyses."
- **CM-5(4) Dual Authorization:** "two qualified individuals approve and implement such changes … accountable for the changes." It is **not in any NIST baseline**.
- **SA-11(4) Manual Code Reviews:** "usually reserved for the critical software and firmware components." It is **not in any NIST baseline**.
- **SA-11** (Moderate, High): guidance lists "manual code review … static analysis, dynamic analysis, binary analysis" as approaches.
- **AC-5 Separation of Duties** (Moderate, High): "helps to reduce the risk of malevolent activity without collusion."
- **Baseline membership from the OSCAL profiles:**
  - LOW: cm-4, cm-5.
  - MODERATE: ac-5, cm-3, cm-3.2, cm-3.4, cm-4, cm-4.2, cm-5, sa-10, sa-11, sa-15, sa-15.3.
  - HIGH adds cm-3.1, cm-3.6, cm-4.1, cm-5.1.
- **FedRAMP 2026 control reference** (Rev5, labeled Class B/C/D): CM-3 is in C and D; CM-3(1) in D; CM-5(4) and SA-11(4) carry no baseline tag. There are "no additional FedRAMP guidance or FedRAMP-assigned parameter values" for CM-3, CM-4 or SA-11. [read] https://fedramp.gov/2026/reference/controls/configuration-management/ , https://fedramp.gov/2026/reference/controls/system-and-services-acquisition/
  - The page itself does not map Class B/C/D to Low/Moderate/High; the fetch tool's summary inferred that mapping. [inference]
- **FedRAMP 20x KSIs** (last updated 2026-06-24). [read] https://fedramp.gov/2026/reference/key-security-indicators/
  - KSI-CMT-LMC: "Modifications to the cloud service offering are logged and monitored."
  - KSI-CMT-RMV: "Changes to machine-based information resources are executed through the redeployment of version controlled resources"
  - KSI-CMT-RVP: "The effectiveness of documented change management procedures is persistently reviewed."
  - KSI-CMT-VTD: "Persistent testing and validation of changes throughout deployment is automated."
  - No KSI addresses code review or human approval of changes.
- **FedRAMP Significant Change Notification (SCN, Class B).** [read] https://fedramp.gov/2026/reference/20x/b/significant-change-notification/
  - The rules are notification-based, not approval-based.
  - "Routine recurring" changes are "exempted from notification requirements"; the notes say they are often automated and may occur without human intervention.
  - Transformative changes need notices 30 and 10 business days ahead. A 3PAO review is a SHOULD.
  - Emergency changes may go first, with retroactive notification.
  - Notices must be human-readable plus JSON, and 12 months of history is kept.
- **FedRAMP 20x principles page:** "Automatic Validation"; continuous evidence is valued over written policy. [read] https://www.fedramp.gov/20x/
- **Reading:** Federal baselines require *a* review-and-approve decision by an organization-defined change control element (CM-3b/g) at Moderate and High. They do not require that a human read code. CM-3(1) explicitly automates notifying approvers and blocking changes until approval. [read] An org could define the "configuration change control element" to approve *classes* of change via policy, with only exceptions going to a board. Whether a 3PAO accepts that per-system is untested. [inference]

### F. NIST SSDF (SP 800-218 v1.1 and v1.2 draft) and SLSA

- **SSDF PW.7.1:** "Determine whether code review (a person looks directly at the code to find issues) and/or code analysis (tools are used to find issues in code, either in a fully automated way or in conjunction with a person) should be used, as defined by the organization."
  - PW.7.2 examples include peer review, "expert reviewers to check code for backdoors", and SAST "with a human reviewing the issues reported by the tool". [read] https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf
- **SSDF v1.2 initial public draft** (SP 800-218r1 ipd, 2025-12-17; comments closed 2026-01-30) keeps PW.7 essentially unchanged. A text grep found no mention of AI, generative AI or AI-generated code. [read] https://csrc.nist.gov/pubs/sp/800/218/r1/ipd
  - This matters because US federal software attestation (EO 14028 lineage) maps onto the SSDF. [inference]
- **SLSA v1.2 Source track, Level 4.** [read] https://slsa.dev/spec/v1.2/source-requirements
  - "Changes in protected branches MUST be agreed to by two or more trusted persons prior to submission."
  - Trusted person: "A human who is authorized by the organization to propose and approve changes."
  - Trusted robot: "Automation authorized by the organization to act in explicitly defined contexts." An organization "MAY choose to grant a Trusted Robot a perpetual exception to a policy."
  - The SCS "MUST present reviewers with a clear representation of the result of accepting the proposed change." Source provenance "MUST be created contemporaneously". The SCS must "Record technical controls enforced on Named References in contemporaneously produced attestations."
  - SLSA is voluntary, but it is the most-cited supply-chain spec, and its top source level is explicitly human two-party.

### G. HIPAA Security Rule (45 CFR 164 Subpart C)

- Text from the eCFR API (2025-01-01 version). [read]
  - It contains no mention of "code review", "change management" or "software development".
  - §164.306(b): entities "may use any security measures that allow [them] to reasonably and appropriately implement the standards," considering size, complexity, capabilities and cost.
  - §164.312(b): audit controls recording "activity in information systems that contain or use [ePHI]."
  - §164.312(c)(1): integrity, protecting ePHI from "improper alteration or destruction".
  - §164.316(b)(2)(i): retain documentation "for 6 years from the date of its creation or the date when it last was in effect, whichever is later."
- **NPRM** "HIPAA Security Rule To Strengthen the Cybersecurity of Electronic Protected Health Information": published 2025-01-06, comments closed 2025-03-07. A Federal Register API query for Security Rule documents since March 2025 returned no final rule, so it is still not final as of 2026-10-12. [read: FR API]
- **Reading:** HIPAA does not decide the question. Covered entities usually inherit SOC 2, HITRUST or ISO controls from their own programs. Six-year retention of the audit trail is the concrete forge requirement where ePHI systems are in scope. [inference]

### H. FDA medical device software (QMSR, General Principles of Software Validation, premarket guidance, IEC 62304)

- **QMSR:** 21 CFR 820 is now the "Quality Management System Regulation" and incorporates ISO 13485:2016 by reference. It was published 2024-02-02 and took effect 2026-02-02. Class I "Devices automated with computer software" must comply with ISO 13485 clause 7.3 design controls. [read: eCFR API, FDA guidance header]
- **General Principles of Software Validation (2002, still cited):** [read] https://www.fda.gov/media/73141/download
  - §4.9: "Validation activities should be conducted using the basic quality assurance precept of 'independence of review.' Self-validation is extremely difficult. When possible, an independent evaluation is always better, especially for higher risk applications." Smaller firms "may need to be creative … to maintain internal independence of review."
  - §5.2.4: "Source code evaluations are often implemented as code inspections and code walkthroughs… Firms may use manual (desk) checking with appropriate controls to ensure consistency and independence… Documentation of the procedures used and the results of source code evaluations should be maintained as part of design verification."
- **Content of Premarket Submissions for Device Software Functions** (issued 2023-06-14): asks for a summary of "Processes and procedures used in software configuration and change management" and maintenance "that includes risk assessment of software changes … regression analysis and testing". [read] https://www.fda.gov/media/153781/download
  - Alternatively, a Declaration of Conformity to IEC 62304 clauses 5.1, 6 and 8.
  - The Enhanced level requires the configuration-management and maintenance plan documents themselves.
  - Verification activities include "source code evaluations (e.g., code inspections and walkthroughs)".
- **Computer Software Assurance guidance:** final, dated February 2026, superseding the 2025-09-24 version. It takes a "risk-based approach to establish confidence in the automation used for production or quality management systems." [read: FDA page; body not read]
- **IEC 62304:** Wikipedia confirms that software unit verification documentation is required for classes B and C, and that configuration management covers identification, change control and status accounting. [read, secondary] I could not open the clause text on unit verification methods or code review.
- **Reading:** FDA language is "should" and "independence of review", which is risk-based guidance, not a per-diff human mandate. [read]
  - An AI reviewer could be one verification method, but QMS rules require validation of software tools used in the QMS (ISO 13485 4.1.6 and 7.5.6). [inference: clause numbers from memory]
  - Independence must be argued: an AI reviewer configured by the developer is not obviously "independent". [inference]
  - Expect medical-device organizations to keep a named human design-review sign-off per release, not necessarily per commit. [inference]

### I. Automotive (ISO 26262)

- Wikipedia confirms only editions: 2011, and 2018 in December, extending scope to all road vehicles except mopeds. Part 8 covers "Confidence in software tools … qualification of software tools." [read, secondary] https://en.wikipedia.org/wiki/ISO_26262
- **From recall, not verified:** ISO 26262-2 confirmation measures (confirmation reviews, functional safety audit, functional safety assessment) carry ASIL-dependent independence levels I0–I3. ISO 26262-6 lists software unit verification methods (walk-through, inspection, static analysis and others) as recommended or highly recommended by ASIL. ISO 26262-8 clause 11 requires a tool confidence level (TCL) determination and possible qualification for tools whose errors could introduce or miss faults. [inference]
- **Reading:** For automotive, the gating issue for an AI author or reviewer is likely **tool qualification**, not "human review". An AI that writes or verifies ASIL code is a software tool with high tool impact, and its error detection would have to be argued. Confirmation reviews at higher ASILs require organizational independence that an AI cannot supply by itself. [inference]

### J. EU Cyber Resilience Act (Regulation (EU) 2024/2847)

- **Dates** (EC policy page): entry into force 2024-12-10, reporting obligations from 2026-09-11, main obligations from 2027-12-11. Some products need notified-body assessment. [read] https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act
- **Annex I** (proposal text, 15.9.2022, on a mirror site): [read, secondary] https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Annex_1.html
  - Vulnerability handling includes an SBOM "in a commonly used and machine-readable format" covering at least top-level dependencies.
  - Manufacturers must "apply effective and regular tests and reviews of the security of the product with digital elements", address vulnerabilities "without delay", run coordinated vulnerability disclosure, and ship security updates "without delay and free of charge."
  - EUR-Lex was not reachable (HTTP 202 challenge), so final wording was not opened. I believe these items survived into the final text. [inference]
- **Reading:** The CRA cares about product outcomes (no known exploitable vulnerabilities, update capability, SBOM, vulnerability handling) and the technical file. It does not say who reviews code. For a forge, the obligation is to produce SBOMs and per-release security-testing evidence, and to retain it for the technical documentation period. [inference]

### K. EU AI Act (Regulation (EU) 2024/1689)

- **Annex III** high-risk categories: biometrics, critical infrastructure (AI "used as safety components in the management and operation of critical digital infrastructure"), education, employment, essential services, law enforcement, migration, justice and elections. Software development and code generation are **not listed**. [read] https://artificialintelligenceact.eu/annex/3/
- **Art. 14 human oversight** applies to high-risk AI systems, including the "automation bias" clause and the "two natural persons" verification for Annex III 1(a). It does not apply to coding agents used for ordinary software. [read] https://artificialintelligenceact.eu/article/14/
  - Exception: an AI system used as a *safety component* in critical digital infrastructure operation would be high-risk. A coding agent is a development tool, not a runtime safety component. [inference]
- **Art. 50(2):** providers of systems "generating synthetic audio, image, video or text content shall ensure that the outputs … are marked in a machine-readable format". There is an exception for "assistive function for standard editing". It applies from 2 August 2026. [read] https://artificialintelligenceact.eu/article/50/
  - The FLI guide (2026-05-14) does not mention code, notes a Code of Practice on marking expected around June 2026, and says the "AI Omnibus provisional agreement of May 2026" gives on-market generative systems until 2 December 2026. [read] https://artificialintelligenceact.eu/transparency-rules-article-50/
  - Whether generated *source code* is "text" for 50(2) is not addressed in what I read. The duty sits on the model or tool provider, not the deploying software organization. [read and inference]
- **Art. 4 AI literacy** (from 2025-02-02): providers and deployers "shall take measures to support the development of AI literacy" of staff. The text appears in amended form. [read] https://artificialintelligenceact.eu/article/4/
- **Reading:** The AI Act does **not** require human review of AI-generated code. The nearest hooks are possible provider-side marking of outputs and AI literacy. A forge that records "which model or agent wrote this hunk" would make any future marking or provenance demands easy to meet. [inference]

### L. DORA (Regulation (EU) 2022/2554) and the ICT risk-management RTS (Delegated Regulation (EU) 2024/1774)

- **DORA Art. 9(4)(e):** financial entities shall "implement documented policies, procedures and controls for ICT change management … based on a risk assessment approach … in order to ensure that all changes to ICT systems are recorded, tested, assessed, approved, implemented and verified in a controlled manner." Further: "the ICT change management process shall be approved by appropriate lines of management and shall have specific protocols in place." [read] https://www.digital-operational-resilience-act.com/Article_9.html
- **RTS text** from the ESAs' final report JC 2023 86 (2024-01-17), which became Delegated Regulation 2024/1774. EUR-Lex itself was blocked, so I read the final draft as hosted by ESMA. [read] https://www.esma.europa.eu/sites/default/files/2024-01/JC_2023_86_-_Final_report_on_draft_RTS_on_ICT_Risk_Management_Framework_and_on_simplified_ICT_Risk_Management_Framework.pdf
  - **Art. 17(2)** requires change procedures to include:
    - "(a) verification that ICT security requirements have been met"
    - "**(b) mechanisms to ensure independence between the functions that approve changes and those responsible for requesting and implementing them**"
    - "(c) … the changes are tested and finalised in a controlled manner and that there is an effective quality assurance"
    - "(d) documentation … purpose and scope … timeline … expected outcomes"
    - "(e) identification of fall-back procedures … for aborting changes or recovering from changes not successfully implemented"
    - "(f) procedures, protocols and tools to manage emergency changes"
    - "(g) procedures to document, re-evaluate, assess and approve after their implementation emergency changes"
    - "(h) identification of the potential impact of a change on existing ICT security measures"
  - Recital (14): "a clear segregation of duties is paramount, in particular it is necessary to separate the functions responsible for approving changes from those who request and implement them to prevent conflicts of interest".
  - **Art. 16(2)(b):** "the requirements to perform source code reviews covering both static and dynamic testing … Financial entities shall identify and analyse vulnerabilities and anomalies in the source code, adopt an action plan to address them and monitor their implementation."
  - Art. 16(2)(e): "controls to protect the integrity of the source code". Art. 16(2)(f): third-party and open-source source code "analysed and tested prior to their deployment".
- **Reading:** DORA is the strictest text on **independence**. The approving *function* must be independent of the requesting and implementing function. [read] An AI reviewer invoked by, configured by, or reporting to the requesting team arguably fails 17(2)(b). An independently governed control function that owns an automated policy (for example security or change management owning the merge policy and the reviewer agent's configuration) arguably satisfies it. [inference] DORA's "source code reviews covering both static and dynamic testing" reads as satisfiable by tooling. [inference]
  - The final delegated regulation text was not opened; article numbering in 2024/1774 should match the draft but is not verified.

### M. What the incumbents and large engineering organizations do

- **GitHub Copilot code review / Copilot approvals** (public preview). [read] https://docs.github.com/en/copilot/concepts/agents/code-review , https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review
  - "By default, Copilot's reviews do not count toward required approvals."
  - When enabled, the approval "can satisfy your repository's required-approval rule the same way a teammate's approval would."
  - "If new commits are pushed after Copilot approves, the approval is dismissed."
  - Enabling it takes a repository toggle, "Allow Copilot approvals to count toward merge requirements". The organization setting offers "Enabled everywhere / Let repositories decide / Enable for selected repositories / Disabled everywhere". The enterprise default is "Disabled everywhere."
  - Optional path globs (up to 15) restrict counting to PRs whose every changed file matches.
  - The docs warn that Copilot "is not guaranteed to spot all problems" and advise supplementing with human review.
  - The docs are silent on CODEOWNERS, self-approval and the audit log.
- **GitHub Copilot cloud agent.** [read] https://docs.github.com/en/copilot/responsible-use/agents , https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent
  - Commits are "authored by Copilot, with the human who started the task marked as the co-author", and they are signed.
  - The agent "can only push to a single branch", and "Copilot cannot push directly to your default branch."
  - "Actions workflows triggered by pull requests raised by the agent require approval."
  - "Each commit message includes a link to the agent session logs."
  - Incompatible rulesets block the agent unless Copilot is added as a bypass actor.
- **Google Binary Authorization for Borg** (page last updated 2026-10-09). [read] https://docs.cloud.google.com/docs/security/binary-authorization-for-borg
  - Code review "requires review and approval from at least one engineer other than the author." Deploy-time policy is enforced by Borg, with continuous verification of running jobs at least daily.
  - The purpose is insider risk: "employees, while acting alone, can't directly or indirectly access or otherwise affect user data."
  - "There are a few cases that don't lend themselves well to human code reviews before deployment", such as "iterative development of machine learning code and high-frequency data analysis", where "we have alternative controls that compensate for human review."
  - Break-glass is via an emergency flag with justification, logging and notification.
- **Vanta**, "Your auditor is about to ask about AI agents" (Beca Grimm, 2026-04-20). [read] https://www.vanta.com/resources/ai-agent-audit-preparation
  - "Auditors expect human approval for sensitive actions."
  - Logs must "capture what happened, when it happened, what inputs were used, and why the decision was made."
  - Evidence "should be continuously collected, easy to verify, and directly tied to controls."
  - Each AI system needs an owner. ISO 42001 "explicitly requires organizations to define the scope of AI autonomy."
  - It does not address AI-generated code or AI peer reviewers.
- **Vanta engineering posts** (2026): staff keep a human sign-off on AI review comments ("Nothing reached the PR without my sign-off" — Jan Castor, 2026-07-15). Org-wide AI review tools "post straight to the PR". [read] https://www.vanta.com/resources/the-background-agent-that-outgrew-me
  - Another post says AI-assisted workflows "break down" when "talking to a regulator" (Yanxi Chen, 2026-06-17). [read]
- **Drata and Secureframe:** their sitemaps contain no page on AI code review, AI-authored code, or whether an AI reviewer satisfies peer-review or change-management controls. Secureframe has SOX ITGC and change-management policy-template pages. [read: sitemap greps]
  - **Gap:** none of the big three GRC vendors has published guidance on this question as of this pass.

---

## Regime table: requirement → AI or automated satisfiable? → what the forge must record

| Regime | What the text requires (change and review) | Is per-change human code review mandated? | Can an AI reviewer or automated evidence satisfy it? | What a forge must record |
|---|---|---|---|---|
| **SOC 2 (CC8.1)** | Changes authorized, designed, documented, tested, approved, implemented; points of focus include Authorizes, Tests, Approves, Emergency changes [secondary] | **No.** Amp passed with no code review [read] | **Yes for testing and review**, at auditor's judgment. "Approval" needs a defined authorized party; can be policy-based [inference] | Authorizing sponsor; test evidence per change; approval event before deploy; commit→deploy link; branch-protection and policy config history; complete change population for sampling; emergency changes with after-the-fact approval |
| **ISO 27001:2022 A.8.32 (+5.3, 8.25–8.29)** | Changes planned, assessed, authorised, tested, documented, communicated; fallback; records [secondary] | **No** | **Yes**, if the documented procedure defines automated authorization; SoD (5.3) constrains self-approval [inference] | Impact assessment, authorizer, test and acceptance results, fallback plan, communication, records |
| **PCI DSS v4.0.1 6.2.3 / 6.2.3.1 / 6.5.1 / 6.5.4** | Pre-release review of bespoke code; "manual or automated processes, or a combination"; if manual, a non-author reviewer plus management approval; "Documented change approval by authorized parties"; roles separated so only reviewed and approved changes deploy [read] | **No** (6.2.3.1 applies only if manual review is used) [read] | **Code review: yes, explicitly** [read]. **Change approval (6.5.1) and SoD (6.5.4): need an accountable authorized party and role separation.** An AI approval alone is untested with QSAs [inference] | Reason and description, security impact, approver identity and role, test results incl. 6.2.4 attack classes, rollback procedure, proof that deployer ≠ sole author, reviewer identity or tool and version |
| **SOX ITGC (program change, SoD)** | Not codified in the statute; auditors test change approval, testing, and SoD between development and production migration [read SEC; secondary] | **No** (approval yes) | **Automated controls favored when ITGCs are effective** [read SEC]. An AI reviewer acting for the requester is not an independent approver [inference] | Approval before migration by someone other than the developer; complete population of production changes; who promoted; segregation evidence; exceptions log |
| **NIST 800-53 / FedRAMP Rev5** | CM-3 review and approve or disapprove via a change control element (Moderate, High); CM-3(1) automate notification and *prohibit changes until approvals* (High); CM-3(2) test; CM-3(4) security reps; CM-4 impact analysis; AC-5 SoD. CM-5(4) dual authorization and SA-11(4) manual code review are **not baselined** [read] | **No** | **Partially.** Automated gating is anticipated (CM-3(1)); the approval authority is organization-defined. A per-class policy approved by the change control element is plausible; 3PAO acceptance untested [inference] | Change requests, impact analyses, approval decisions and approver authority, test results, retained records (org-defined period), monitoring of unauthorized changes (CM-3(7)), security-rep participation |
| **FedRAMP 20x (2026)** | KSI-CMT: log and monitor changes; redeploy version-controlled resources; persistently review procedures; automated testing and validation through deployment. SCN: notify for adaptive or transformative changes; routine changes exempt [read] | **No** | **Yes**, designed around automated validation [read] | Machine-readable change logs, versioned immutable deploys, automated validation results, SCN records (human-readable plus JSON, 12 months) |
| **NIST SSDF (800-218 v1.1, v1.2 draft)** | PW.7: code review *and/or* code analysis "as defined by the organization"; triage and record findings [read] | **No** | **Yes** (fully automated analysis is explicitly an option) [read] | Review or analysis results, triage decisions, remediation tracking |
| **SLSA v1.2 Source L4** (voluntary) | Two **trusted persons** (humans) agree to each change in protected branches; reviewers shown the result of accepting the change; contemporaneous provenance [read] | **Yes** (only at L4) | **No**, except via an explicit "Trusted Robot" exception [read] | Uploader and reviewer identities, final-revision approval, provenance and VSA with level, enforced technical-control attestations |
| **HIPAA Security Rule** | No change or code-review text; flexibility of approach; audit controls; integrity; 6-year documentation retention [read] | **No** | **Yes** (risk-based) [inference] | Audit trail of changes to ePHI systems, retained 6 years |
| **FDA (QMSR / ISO 13485, GPSV, premarket guidance, IEC 62304)** | "Independence of review"; source code evaluations (inspections or walkthroughs) "should" be documented; config and change management per IEC 62304 clause 8; risk assessment and regression testing of changes [read] | **Not per diff;** independence expected for verification [read] | **Possibly, as a validated tool**, with independence argued; human design-review sign-off per release expected [inference] | Traceability (requirement→design→code→test), change risk assessment, regression results, reviewer independence, tool validation records, configuration status accounting |
| **ISO 26262 (automotive)** | Confirmation measures with ASIL-dependent independence; unit verification methods by ASIL; tool confidence and qualification [inference, not opened] | Unclear; inspections highly recommended at higher ASIL [inference] | **AI as a tool needs tool-qualification argument;** independence of confirmation reviews needs people or organizations [inference] | Tool use cases and TCL, verification method used per unit, confirmation-review records with independence level |
| **EU CRA** | Security by design; SBOM; vulnerability handling; "effective and regular tests and reviews of the security"; updates without delay [read, proposal text] | **No** | **Yes** [inference] | SBOM per release, security test evidence, vulnerability handling records, update history |
| **EU AI Act** | No duty on organizations because code is AI-generated; Art. 50(2) marking duty on *providers* of generative systems (code not named); Art. 4 AI literacy; Art. 14 oversight only for high-risk [read] | **No** | n/a | Optional but useful: model or agent provenance per hunk, to answer marking or provenance demands later |
| **DORA + RTS 2024/1774** | All changes "recorded, tested, assessed, approved, implemented and verified"; process approved by management; **independence between approving and requesting/implementing functions**; source code reviews with static and dynamic testing; fallback; emergency change post-approval [read] | **No per-diff human read**, but an **independent approving function** is mandatory [read] | **Code review: yes, via tooling** [inference]. **Approval: only if the approving function is independent of requester and implementer.** An AI under the requester's control fails; an AI or policy owned by an independent control function plausibly passes [inference] | Requester, implementer and approver identities with function or team; proof of independence; security-requirement verification; fallback plan; emergency change post-hoc approval; impact on security measures; SAST and DAST results |

---

## Pain points for agentic-scale development

1. **"Approved by whom?" has no good answer when the requester's own agent reviews.** Every regime that tests SoD (PCI 6.5.4, SOX, DORA 17(2)(b), ISO 5.3, NIST AC-5) breaks if the human sponsor's agent writes the code and another agent *configured by the same sponsor* approves it. [inference from read texts]
2. **Human approval capacity does not scale.** Requiring a human per change caps throughput at human review bandwidth, which is the bottleneck the brief describes. Yet SLSA L4 and many enterprise customers' vendor-risk questionnaires still assume two humans. [read: SLSA; inference: questionnaires]
3. **Auditors sample from a population.** At thousands of agent changes a day, the forge must produce a complete, tamper-evident population and make every sampled item self-explanatory: intent, evidence, approver, deploy. Amp-style "commits link to the thread" works only if threads are retained and immutable for the audit period. [inference; Amp read]
4. **Rules that bypass branch protection.** GitHub's cloud agent needs bypass-actor status when rulesets conflict, and auditors (Schellman) warn that "Allowing anyone to bypass controls greatly weakens their effectiveness". [read] Agents as bypass actors are an audit finding waiting to happen.
5. **Emergency and break-glass at agent speed.** DORA requires post-implementation approval of emergency changes and PCI requires return-to-secure-state procedures. With "reversal beats prevention" (brief idea 7), every auto-revert or forward fix is itself a change needing a record. [read DORA, PCI; inference]
6. **Policy drift is the new unauthorized change.** If merge policy is code (brief idea 3), a change to the policy is the highest-risk change in the system. Schellman's point about monitoring changes to branch-protection rules generalizes to this. [read; inference]
7. **AI reviewer quality and independence.** GitHub's own docs say Copilot "is not guaranteed to spot all problems." The FDA says "Self-validation is extremely difficult". An agent grading its own or a sibling's work echoes the brief's "proof can be gamed" risk. [read]
8. **Safety-critical tool qualification.** In automotive and medical work, using an LLM as author or verifier puts it in tool-qualification and validation regimes that assume deterministic tools. [inference]

## How organizations are solving them (observed)

- **Amp:** substitutes restricted push plus signed commits plus blocking CI plus thread-linked commits for review, accepted by its SOC 2 auditor. It says this does not transfer unchanged to 2,000 people. [read]
- **GitHub:** keeps required approvals and adds an *opt-in, path-scoped* AI approval that counts toward them. It is disabled by default at enterprise level and dismissed on new commits. Agent commits name the human co-author, the agent cannot push to the default branch, and CI on agent PRs needs human approval to run. [read]
- **Google BAB:** a non-author human approval, enforced at deploy time rather than merge time, with signed build provenance and daily re-verification of running jobs. It uses "alternative controls that compensate for human review" where review does not fit (ML iteration, high-frequency analysis), plus logged break-glass. [read]
- **FedRAMP 20x:** the regulator itself moved to automated validation and notification-based change rules; routine automated changes are exempt from notification. [read]
- **PCI SSC:** allows automated code review outright and limits the human-reviewer rules to when manual review is used. [read]
- **Vanta staff:** keep AI review comments behind a human sign-off for personal bots, while org-level AI reviewers post directly. [read]

## Implications for a future forge

1. **Model approvals as typed records with a principal and a function, not a checkbox.** Each landing record should carry: requester (human sponsor), implementer (agent identity, model and version, thread), reviewer(s) (human or agent, plus the *principal* the agent acts for and a config or prompt hash), approver (policy ID and version, or named human), and each party's organizational function or team. Then **enforce independence as an invariant**: approver principal ≠ requester principal, and approver function ≠ requester function where DORA or SOX scope applies. This turns DORA 17(2)(b), PCI 6.5.4 and SOX SoD from a manual audit test into a machine-checked property. [inference]
2. **Approve the policy once; evaluate it on each change.** DORA requires the change-management *process* to be "approved by appropriate lines of management". CM-3(1) envisions automated prohibition "until designated approvals are received." [read] The forge should treat each path-scoped merge policy as a controlled artifact:
   - changes to the policy need two-person human approval, matching SLSA L4 and CM-5(4) in spirit;
   - each change landing under the policy records the policy version that approved it.
   This is the "standard change" pattern (pre-approved change classes, a term I am recalling from ITIL, not from a source read here) made executable. [inference]
3. **Per-path or per-scope tiers, as the brief proposes and GitHub's 15 path globs foreshadow.** Docs and tests land on proof. Systems in PCI, SOX or DORA scope need an independent approving function: an AI reviewer owned by a separate control team, or a named human. SLSA L4 repositories and safety-critical code need two humans. [read: GitHub globs; inference]
4. **Evidence must be audit-grade.** That means immutable, timestamped *before* deploy, signed (SLSA-style provenance), tied to a pinned commit or deployment, and retained for the longest applicable period:
   - HIPAA documentation: 6 years
   - FedRAMP SCN history: 12 months
   - CM-3(e): organization-defined
   [read] The thread log is part of the audit evidence, so thread retention and deletion is a compliance feature. SLSA's "safe expunging" exists only for legal or privacy reasons. [read]
5. **Population export and sampling view.** Auditors need "all changes to production in period X". Each change should come with requester, approver, independence check, evidence links, deploy link and exceptions. This is the brief's "audit view" scene, scaled to a CSV/OSCAL export. FedRAMP already wants JSON plus human-readable change notices. [read; inference]
6. **First-class emergency path.** Break-glass landing should carry mandatory justification, automatic notification, and a *retroactive approval task* (DORA 17(2)(g)), with fallback or revert recorded (DORA 17(2)(e), PCI 6.5.1). Auto-reverts are changes too. [read]
7. **No bypass actors for agents.** Agents should land *through* the landing service under policy, never as rule bypassers. Record every policy or ruleset change with its approvers. [read: Schellman, GitHub; inference]
8. **Provenance per hunk.** Record which model or agent produced each change. It costs little now and hedges against AI Act marking or provenance expectations, customer questionnaires about AI-generated code, and SSDF or CRA SBOM-style demands. [inference]
9. **Reviewer-agent governance.** Treat AI reviewers as validated tools: versioned config, shadow-mode rollout (the Anthropic approach mentioned in the brief), measured false-negative rates on seeded defects, and ownership by a function independent of authors. This is what lets an auditor rely on them. [inference; brief]
10. **Implication for the brief.** Its claim that proof-based merging "keeps the four things auditors ask for (authorized, tested, approved, recorded)" is supported by Amp and by DORA's wording. It should add **"independent"** (SoD) and **"verified after deployment"** (DORA 9(4)(e) "verified"; BAB's continuous verification) to be credible for regulated buyers. [read; inference]

## Contradictions and pushback

- **Amp vs. auditors' best-practice literature.** Amp says code review "isn't on the list". Thoropass and Schellman present peer review, two approvers and SoD as expected practice. The two are compatible: the criteria do not mandate review, but many auditors and customers expect it as the *usual* way to evidence approval and SoD. [read]
- **Amp conflates "authorized to push" with "approved".** The post never names an approver. That passes SOC 2 at 20 people but would not obviously pass DORA 17(2)(b) or PCI 6.5.4, which require separation between approver and implementer. [read; inference]
- **GitHub's AI approval vs. SLSA L4.** GitHub now lets an AI approval satisfy required reviews. SLSA L4 explicitly requires human "trusted persons". An organization claiming SLSA Source L4 cannot count Copilot approvals toward it. [read]
- **NIST includes both "manual code review" and "dual authorization" as controls, but baselines neither.** Federal practice therefore does not require them by default. Agency-specific overlays or contracts might, which I did not check. [read; inference]
- **Google says one non-author human per change** while explicitly exempting work that does not suit human review in favor of compensating controls. Even the strictest large-company practice accepts non-human controls for some change classes. [read]
- **The "AI reviewer is independent" argument is weak** when the same organization configures both author and reviewer models, possibly from the same vendor and with correlated blind spots. Independence in FDA, DORA and SOX terms is organizational, not computational. [inference]

## Open questions

1. Has any SOC 2 auditor, QSA, 3PAO or Big-4 SOX team issued a written position on AI approvals counting toward "approval by authorized parties" or peer-review controls? I found none, though the search budget ran out before a thorough look.
2. Does GitHub's audit log distinguish Copilot approvals from human approvals, and do Vanta, Drata and Secureframe "PRs require approval" tests count them? Not documented on the pages read.
3. Exact final text of Delegated Regulation (EU) 2024/1774 Articles 16–17 (EUR-Lex blocked). Has any EU supervisor (EBA, ECB, national authorities) commented on AI agents in change management?
4. Exact ISO 27002:2022 8.28 and 8.32 wording on code review, and the 5.3 SoD guidance (paywalled).
5. ISO 26262-6 and -8 and IEC 62304 clause text on unit verification methods and tool qualification. Has any notified body or TÜV published guidance on LLM coding tools for ASIL or Class C software?
6. The AICPA TSC 2017 (2022 revised points of focus) PDF, which I could not download because the AICPA page requires login. Has AICPA issued AI-specific SOC guidance?
7. HIPAA Security Rule final rule timing, and whether it adds change or configuration-management requirements.
8. Status of the EU AI Act Art. 50 Code of Practice and whether it treats source code as "text".
9. Whether US federal secure-software attestation (CISA form, OMB memos) has added any AI-generated-code clause in 2026.
10. Do PCAOB inspection findings for 2025–2026 mention AI in change-management ITGC deficiencies? (pcaobus.org returned 403.)

---

## Sources (opened in this pass)

| # | Title | Publisher / author | Date | URL | Tag |
|---|---|---|---|---|---|
| 1 | "That's not SOC 2 compliant" | Amp (Will Dollman) | 2026-08-13 | https://ampcode.com/notes/thats-not-soc-2-compliant | read |
| 2 | Amp Chronicle (index) | Amp | accessed 2026-10-12 | https://ampcode.com/chronicle | read |
| 3 | Amp Security Reference | Amp | accessed 2026-10-12 | https://ampcode.com/security | read (contains LLM-directed text; ignored) |
| 4 | Amp holds SOC 2 Type II without requiring pull requests | RuntimeWire | 2026-08-15 | https://runtimewire.com/article/amp-soc-2-without-pull-requests | secondary |
| 5 | PCI DSS v4.0.1 SAQ D for Merchants (requirement text 6.2.3, 6.2.3.1, 6.5.1–6.5.6) | PCI SSC (copy hosted by Nebraska State Treasurer) | Oct 2024 | https://treasurer.nebraska.gov/tm/pci-dss/documents/PCI-DSS-v4-0-1-SAQ-D-Merchant-Tyler.pdf | read |
| 6 | PCI DSS v4.0.1 6.2.3.1 | Cloudaware | n.d. | https://ce.prod.cloudaware.com/frameworks/pci-dss-v4.0.1/06/02/03/01 | secondary |
| 7 | PCI DSS 4.0 for web developers (wizer-training PDF) | compliancehub.wiki | 2025-04 | https://compliancehub.wiki/content/files/2025/04/pcidss4webdev.pdf | secondary |
| 8 | PCI DSS v4.0.1 overview | KPMG India | 2024-08 | https://assets.kpmg.com/content/dam/kpmgsites/in/pdf/2024/08/payment-card-industry-data-security-standard-version-4.0.1.pdf.coredownload.inline.pdf | read (overview only, not useful) |
| 9 | SOC 2 CC8.1: Change management procedures | Cyberday | n.d. | https://www.cyberday.ai/requirement/soc-2-cc8-1-change-management-procedures | secondary |
| 10 | NIST SP 800-53 Rev5 OSCAL catalog and Low/Moderate/High baseline profiles | NIST (usnistgov/oscal-content) | current main | https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json | read |
| 11 | FedRAMP Key Security Indicators (Consolidated Rules 2026) | FedRAMP | updated 2026-06-24 | https://fedramp.gov/2026/reference/key-security-indicators/ | read |
| 12 | FedRAMP 20x Class B: Significant Change Notification | FedRAMP | updated 2026-06-24 | https://fedramp.gov/2026/reference/20x/b/significant-change-notification/ | read |
| 13 | FedRAMP 20x Class B ruleset index | FedRAMP | 2026 | https://fedramp.gov/2026/reference/20x/b/ | read |
| 14 | FedRAMP 20x overview | FedRAMP | accessed 2026-10-12 | https://www.fedramp.gov/20x/ | read |
| 15 | FedRAMP Rev5 controls: Configuration Management family | FedRAMP | 2026 | https://fedramp.gov/2026/reference/controls/configuration-management/ | read |
| 16 | FedRAMP Rev5 controls: System and Services Acquisition family | FedRAMP | 2026 | https://fedramp.gov/2026/reference/controls/system-and-services-acquisition/ | read |
| 17 | FedRAMP Rev5 control reference index | FedRAMP | 2026 | https://fedramp.gov/2026/reference/controls/ | read |
| 18 | NIST SP 800-218 SSDF v1.1 | NIST | Feb 2022 | https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218.pdf | read |
| 19 | NIST SP 800-218r1 ipd, SSDF v1.2 (page and PDF) | NIST | 2025-12-17 | https://csrc.nist.gov/pubs/sp/800/218/r1/ipd ; https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-218r1.ipd.pdf | read |
| 20 | SLSA v1.2 Source: Requirements for producing source | OpenSSF / Linux Foundation | v1.2 (© 2026) | https://slsa.dev/spec/v1.2/source-requirements | read |
| 21 | About GitHub Copilot code review | GitHub Docs | accessed 2026-10-12 | https://docs.github.com/en/copilot/concepts/agents/code-review | read |
| 22 | Configuring code review by GitHub Copilot | GitHub Docs | accessed 2026-10-12 | https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review | read |
| 23 | About Copilot cloud/coding agent | GitHub Docs | accessed 2026-10-12 | https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent | read |
| 24 | Application card: GitHub Copilot Agents | GitHub Docs | accessed 2026-10-12 | https://docs.github.com/en/copilot/responsible-use/agents | read |
| 25 | JC 2023 86 Final report: draft RTS on ICT risk management framework (became Del. Reg. 2024/1774) | ESAs (hosted by ESMA) | 2024-01-17 | https://www.esma.europa.eu/sites/default/files/2024-01/JC_2023_86_-_Final_report_on_draft_RTS_on_ICT_Risk_Management_Framework_and_on_simplified_ICT_Risk_Management_Framework.pdf | read |
| 26 | DORA Article 9 | digital-operational-resilience-act.com | n.d. | https://www.digital-operational-resilience-act.com/Article_9.html | read (mirror of official text) |
| 27 | DORA site home (RTS references) | digital-operational-resilience-act.com | n.d. | https://www.digital-operational-resilience-act.com/ | read |
| 28 | CRA Annex I (proposal text) | european-cyber-resilience-act.com | proposal 2022-09-15 | https://www.european-cyber-resilience-act.com/Cyber_Resilience_Act_Annex_1.html | secondary |
| 29 | Cyber Resilience Act policy page | European Commission | accessed 2026-10-12 | https://digital-strategy.ec.europa.eu/en/policies/cyber-resilience-act | read |
| 30 | EU AI Act Article 50 | artificialintelligenceact.eu (FLI) | n.d. | https://artificialintelligenceact.eu/article/50/ | read |
| 31 | EU AI Act Annex III | artificialintelligenceact.eu | n.d. | https://artificialintelligenceact.eu/annex/3/ | read |
| 32 | EU AI Act Article 4 | artificialintelligenceact.eu | n.d. | https://artificialintelligenceact.eu/article/4/ | read |
| 33 | EU AI Act Article 14 | artificialintelligenceact.eu | n.d. | https://artificialintelligenceact.eu/article/14/ | read |
| 34 | The EU AI Act's Transparency Rules: A Practical Guide to Article 50 | Future of Life Institute | 2026-05-14 | https://artificialintelligenceact.eu/transparency-rules-article-50/ | read |
| 35 | artificialintelligenceact.eu home | FLI | accessed 2026-10-12 | https://artificialintelligenceact.eu/ | read |
| 36 | ISO 27001:2022 Annex A 8.32 Change Management | ISMS.online | n.d. | https://www.isms.online/iso-27001/annex-a-2022/8-32-change-management-2022/ | secondary |
| 37 | ISO 27001:2022 Annex A 8.28 Secure Coding | ISMS.online | n.d. | https://www.isms.online/iso-27001/annex-a-2022/8-28-secure-coding-2022/ | secondary |
| 38 | 45 CFR Part 164 (HIPAA Security Rule), eCFR API | eCFR / OFR | version 2025-01-01 | https://www.ecfr.gov/api/versioner/v1/full/2025-01-01/title-45.xml?part=164 | read |
| 39 | HIPAA Security Rule NPRM metadata (2024-30983) and FR search | Federal Register API | 2025-01-06; queried 2026-10-12 | https://www.federalregister.gov/api/v1/documents/2024-30983.json | read |
| 40 | SEC Release 33-8810, Management's Report on ICFR (interpretive guidance) | SEC | June 2007 | https://www.sec.gov/rules/interp/2007/33-8810.pdf | read |
| 41 | SOX ITGC | Secureframe | n.d. | https://secureframe.com/blog/sox-itgc | secondary |
| 42 | General Principles of Software Validation | FDA | 2002 (with QMSR header note) | https://www.fda.gov/media/73141/download | read |
| 43 | 21 CFR Part 820 QMSR (eCFR API) | eCFR | version 2026-09-01 | https://www.ecfr.gov/api/versioner/v1/full/2026-09-01/title-21.xml?part=820 | read |
| 44 | Content of Premarket Submissions for Device Software Functions | FDA | 2023-06-14 | https://www.fda.gov/media/153781/download | read |
| 45 | Computer Software Assurance for Production and Quality Management System Software | FDA | Feb 2026 (final) | https://www.fda.gov/regulatory-information/search-fda-guidance-documents/computer-software-assurance-production-and-quality-management-system-software | read (landing page only) |
| 46 | ISO 26262 | Wikipedia | accessed 2026-10-12 | https://en.wikipedia.org/wiki/ISO_26262 | secondary |
| 47 | IEC 62304 | Wikipedia | accessed 2026-10-12 | https://en.wikipedia.org/wiki/IEC_62304 | secondary |
| 48 | Your auditor is about to ask about AI agents. 9 things they'll want to see | Vanta (Beca Grimm) | 2026-04-20 | https://www.vanta.com/resources/ai-agent-audit-preparation | read |
| 49 | Why cheaper code isn't always cheap | Vanta (Shannon Hogue) | 2026-05-26 | https://www.vanta.com/resources/why-cheaper-code-isnt-always-cheap | read |
| 50 | Where thinking in engineering happens now | Vanta (Yanxi Chen) | 2026-06-17 | https://www.vanta.com/resources/where-thinking-in-engineering-happens-now | read |
| 51 | The background agent that outgrew me | Vanta (Jan Castor) | 2026-07-15 | https://www.vanta.com/resources/the-background-agent-that-outgrew-me | read |
| 52 | Vanta, Drata, Secureframe, Schellman, A-LIGN, Thoropass sitemaps (searched for AI code review pages) | vendors | accessed 2026-10-12 | https://www.vanta.com/sitemap.xml ; https://drata.com/sitemap.xml ; https://secureframe.com/sitemap-main.xml ; https://www.schellman.com/sitemap.xml ; https://www.a-lign.com/post-sitemap.xml ; https://www.thoropass.com/sitemap.xml | read |
| 53 | How to Use Branch Protection in Change Management | Schellman (Phil Dorczuk) | 2023-02-09, updated 2023-08-11 | https://www.schellman.com/blog/pci-compliance/how-to-use-branch-protection-in-change-management | secondary (auditor opinion) |
| 54 | 5 Steps for an Effective Change Management Program | Schellman (Debbie Zaller) | 2016-08-04, updated 2023-10-18 | https://www.schellman.com/blog/audit-readiness/5-steps-for-effective-change-management-program | secondary |
| 55 | Best practices for SOC 2 change management | Thoropass | 2024-08-21 | https://www.thoropass.com/blog/best-practices-for-soc-2-change-management | secondary |
| 56 | Binary Authorization for Borg | Google Cloud | last updated 2026-10-09 | https://docs.cloud.google.com/docs/security/binary-authorization-for-borg | read |

Attempted but not retrieved:
- PCI SSC official PDF (403)
- AICPA TSC PDF (login page)
- EUR-Lex texts of 2024/1774, 2024/2847 and 2024/1689 (HTTP 202 bot challenge)
- PCAOB AS 2201 (403)
- FFIEC IT Handbook DA&M (403)
- FedRAMP OSCAL baselines on GitHub (404 / repo not attached)
- Johner Institute IEC 62304 pages (404)
- csf.tools CM-3 (empty)

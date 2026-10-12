# Plan / state (overnight)
- Search budget: 200 WebSearch per TURN shared by all agents. Launch <=8 research agents per turn (cap 20 searches each), then end the turn.
- PENDING RELAUNCH (wave 1b, stopped for budget): 21-amp-deep-dive + 23-cloudflare-platform-verify; 24-bigtech-ai-review-risk + 30-large-scale-cross-repo-changes; 28-small-teams-solo-practice + 29-stateful-previews-data; 27-forge-business-models + 22-zed-delta-deep-dive. (args are in this conversation; script = forge-research-sweep-wf_ddc9811d-4a8.js)
- Wave-1 agents 05-18 ran search-starved after the budget ran out → check their gaps and run gap-filling in later turns.
- Timeline: complete report by 13:00 UTC; refine until 16:00 UTC (9 AM PT).

## 05:44 UTC — SESSION USAGE LIMIT HIT (resets 07:30 UTC)
Agents failing. On resume:
1. Check which files exist / which workflows failed (TaskList / journals). Resume failed workflows with resumeFromRunId (completed agents cached).
   - wave1b runs: wf_d5481bae-28d (21,23), wf_80756a8a-7ad (24,30), wf_964dc6c8-905 (28,29), wf_b1965bf4-9a5 (27,22)
   - designs: wf_a2b5de77-263 (40,41), wf_7a9cda01-106 (42,43), wf_d58c3ab2-213 (44,45), wf_4446c5d9-0ae (46)
   - red team: wf_3ca1db5b-a41 (50 failed, 51 ok), wf_9bb49192-14c (52,53), wf_247f9c66-7d9 (54)
   - analysis: wf_291937e9-2a5 (19 landing sim, 20 done)
2. BUDGET: be frugal after reset — prioritize: designs + red team + 19 sim > wave1b deep dives. Skip low-value deep dives (27 business, 22 zed) if needed.
3. Start the report doc by ~09:00 UTC; complete by 13:00.
